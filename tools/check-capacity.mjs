import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachRoomServer } from '../server/rooms.js'

const size = 100
const server = http.createServer((_, res) => res.end('capacity check'))
const service = attachRoomServer(server, { capacity: size })
server.listen(0, '127.0.0.1')
await once(server, 'listening')

async function client(index) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
  const info = { index, ws, snaps: 0, seq: 0, ack: 0 }
  ws.on('message', (message) => {
    const m = JSON.parse(message)
    if (m.kind === 'lobby') info.lobby = m
    if (m.kind === 'begin') info.begin = m
    if (m.kind === 'state') {
      info.snaps++
      info.players = m.players.length
      info.time = m.time
    }
    if (m.kind === 'self') {
      info.ack = m.self.ack
      info.yaw = m.self.yaw
    }
    if (m.kind === 'error') console.error(index, m.message)
  })
  await once(ws, 'open')
  return info
}
const emit = (c, data) => c.ws.send(JSON.stringify(data))
async function until(condition, description) {
  const end = Date.now() + 7500
  while (!condition()) {
    if (Date.now() > end)
      throw new Error(`Timed out waiting for ${description}`)
    await new Promise((resolve) => setTimeout(resolve, 15))
  }
}

let inputs
try {
  const host = await client(0)
  emit(host, {
    op: 'create',
    mode: 'battle-royale',
    teamSize: 4,
    capacity: size,
    fill: false,
    name: 'Host',
  })
  await until(() => host.lobby, 'lobby creation')
  const peers = [
    host,
    ...(await Promise.all(
      Array.from({ length: size - 1 }, (_, i) => client(i + 1)),
    )),
  ]
  for (const c of peers.slice(1))
    emit(c, { op: 'join', code: host.lobby.code, name: `Operator ${c.index}` })
  await until(() => host.lobby.players.length === size, 'full roster')
  emit(host, { op: 'start' })
  await until(
    () => peers.every((c) => c.begin && c.players === size),
    'initial match snapshots',
  )
  inputs = setInterval(() => {
    for (const c of peers)
      emit(c, {
        op: 'input',
        seq: ++c.seq,
        input: { yaw: c.yaw, z: 1, jump: c.seq === 4, sprint: true },
      })
  }, 34)
  await until(
    () => peers.every((c) => c.ack >= 35 && c.snaps >= 12),
    'sustained inputs and snapshots from all clients',
  )
  const room = service.rooms.get(host.lobby.code)
  assert.equal(room.match.players.size, size)
  assert.ok(peers.every((c) => c.players === size))
  console.log(
    `${size} connected clients · ${Math.min(...peers.map((c) => c.snaps))} minimum snapshots · ${Math.min(...peers.map((c) => c.ack))} minimum acknowledged inputs`,
  )
} finally {
  clearInterval(inputs)
  service.close()
  await new Promise((resolve) => server.close(resolve))
}
