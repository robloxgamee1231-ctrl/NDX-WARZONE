import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { attachRoomServer } from '../server/rooms.js'

async function fixture(t, opts = {}) {
  const server = http.createServer((_req, res) => res.end('OK'))
  const rooms = attachRoomServer(server, opts)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    rooms.close()
    if (server.listening) await new Promise((r) => server.close(r))
  })
  return async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
    const inbox = [],
      listeners = new Set()
    ws.on('message', (data) => {
      const d = JSON.parse(data)
      inbox.push(d)
      for (const wake of listeners) wake()
    })
    await once(ws, 'open')
    const wait = (kind, filter = () => true) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          listeners.delete(check)
          reject(
            new Error(
              `Missing ${kind} message. Got: ${inbox.map((x) => x.kind).slice(-10)}`,
            ),
          )
        }, 6000)
        function check() {
          const i = inbox.findIndex((x) => x.kind === kind && filter(x))
          if (i >= 0) {
            clearTimeout(t)
            listeners.delete(check)
            resolve(inbox.splice(i, 1)[0])
          }
        }
        listeners.add(check)
        check()
      })
    return {
      send: (v) => ws.send(JSON.stringify(v)),
      wait,
      close: () => ws.close(),
    }
  }
}

test('private room supports creation, joining, host-only starts, shared state and input acknowledgments', async (t) => {
  const open = await fixture(t)
  const host = await open(),
    guest = await open()
  host.send({
    op: 'create',
    name: 'Mako',
    mode: 'free-for-all',
    teamSize: 1,
    fill: false,
    capacity: 100,
  })
  const welcome = await host.wait('welcome')
  const room = await host.wait('lobby')
  assert.match(room.code, /^[A-Z2-9]{5}$/)
  assert.equal(room.cap, 100)
  assert.equal(room.host, welcome.id)
  host.send({ op: 'start' })
  assert.match((await host.wait('error')).message, /more operators/)
  guest.send({
    op: 'join',
    code: room.code.toLowerCase(),
    name: 'Ro<o>k',
    weapon: 'viper',
  })
  const guestId = (await guest.wait('welcome')).id
  const roster = await host.wait('lobby', (l) => l.players.length === 2)
  assert.equal(roster.players.find((p) => p.id === guestId).name, 'Rook')
  guest.send({ op: 'start' })
  host.send({ op: 'start' })
  const [a, b] = await Promise.all([host.wait('begin'), guest.wait('begin')])
  assert.equal(a.room, b.room)
  assert.equal(a.mode, 'free-for-all')
  assert.equal(a.seed, b.seed)
  assert.deepEqual(
    (await host.wait('state')).players.map((p) => p[0]),
    [welcome.id, guestId],
  )
  const first = (await guest.wait('self')).self
  assert.equal(first.weapon, 'viper')
  assert.equal(first.ammo, 36)
  guest.send({
    op: 'input',
    seq: 1,
    input: { yaw: first.yaw, pitch: 0, z: 1, sprint: true },
  })
  const updated = (await guest.wait('self', (s) => s.self.ack === 1)).self
  assert.ok(Math.hypot(updated.x - first.x, updated.z - first.z) > 0)
  host.close()
  const after = await guest.wait('state', (s) => s.players.length === 1)
  assert.equal(after.players[0][0], guestId)
})

test('public quick matchmaking pools compatible players and starts with a bot-filled roster', async (t) => {
  const open = await fixture(t, { quickWait: 300, capacity: 16, onlineBots: 8 })
  const one = await open(),
    two = await open()
  one.send({ op: 'quick', mode: 'battle-royale', name: 'One', teamSize: 2 })
  two.send({ op: 'quick', mode: 'battle-royale', name: 'Two', teamSize: 2 })
  const [a, b] = await Promise.all([one.wait('begin'), two.wait('begin')])
  assert.equal(a.room, b.room)
  assert.equal(a.private, false)
  assert.equal(a.teamSize, 2)
  const state = await one.wait('state')
  assert.equal(state.players.length, 9)
  assert.ok(state.players.some((p) => p[20] === 1))
})

test('private rooms enforce configured capacity and do not add players after deployment', async (t) => {
  const open = await fixture(t, { capacity: 2 })
  const a = await open(),
    b = await open(),
    c = await open()
  a.send({
    op: 'create',
    mode: 'battle-royale',
    teamSize: 4,
    capacity: 100,
    fill: true,
  })
  const l = await a.wait('lobby')
  assert.equal(l.cap, 2)
  assert.equal(l.teamSize, 1)
  b.send({ op: 'join', code: l.code })
  await b.wait('welcome')
  c.send({ op: 'join', code: l.code })
  assert.match((await c.wait('error')).message, /full/)
  a.send({ op: 'start' })
  await b.wait('begin')
  c.send({ op: 'join', code: l.code })
  assert.match((await c.wait('error')).message, /already deployed/)
})

test('Garrison rooms synchronize control relays and enforce opposing sides with two humans', async (t) => {
  const open = await fixture(t)
  const host = await open(),
    guest = await open()
  host.send({
    op: 'create',
    mode: 'garrison',
    name: 'Relay One',
    fill: false,
    teamSize: 4,
    loadout: {
      primary: 'viper',
      attachments: { feed: 'extended' },
      operator: 'warden',
      tactical: 'pulse',
    },
  })
  await host.wait('welcome')
  const { code } = await host.wait('lobby')
  guest.send({ op: 'join', code, name: 'Relay Two' })
  await guest.wait('welcome')
  await host.wait('lobby', (l) => l.players.length === 2)
  host.send({ op: 'start' })
  const [beginA, beginB] = await Promise.all([
    host.wait('begin'),
    guest.wait('begin'),
  ])
  assert.equal(beginA.mode, 'garrison')
  assert.equal(beginB.seed, beginA.seed)
  const s = await host.wait('state')
  assert.equal(s.players.length, 2)
  assert.deepEqual(
    s.players.map((p) => p[2]),
    [0, 1],
  )
  assert.deepEqual(
    s.control.relays.map((r) => r.id),
    ['A', 'B', 'C'],
  )
  const self = (await host.wait('self')).self
  assert.equal(self.loadout.primary, 'viper')
  assert.equal(self.ammo, 45)
  assert.equal(self.tacticalType, 'pulse')
  host.send({ op: 'input', seq: 1, input: { yaw: self.yaw, sidearm: true } })
  const next = (await host.wait('self', (x) => x.self.ack === 1)).self
  assert.equal(next.weapon, 'spectre')
  assert.equal(next.ammo, 12)
})

test('room pings are squad-private, including when aircraft passengers mark from the map', async (t) => {
  const open = await fixture(t, { capacity: 12 })
  const [host, ally, opponent] = await Promise.all([open(), open(), open()])
  host.send({
    op: 'create',
    mode: 'battle-royale',
    name: 'Leader',
    fill: false,
    teamSize: 2,
  })
  const { id } = await host.wait('welcome')
  const { code } = await host.wait('lobby')
  ally.send({ op: 'join', code, name: 'Wing' })
  await ally.wait('welcome')
  opponent.send({ op: 'join', code, name: 'Rival' })
  await opponent.wait('welcome')
  await host.wait('lobby', (l) => l.players.length === 3)
  host.send({ op: 'start' })
  await Promise.all([
    host.wait('begin'),
    ally.wait('begin'),
    opponent.wait('begin'),
  ])
  assert.equal((await host.wait('self')).self.air, 'plane')
  host.send({ op: 'ping', point: { kind: 'danger', x: 33, z: -20 } })
  const other = await ally.wait('self', (d) =>
    d.self.pings.some((p) => p.id === id),
  )
  assert.equal(other.self.pings[0].kind, 'danger')
  const rival = await opponent.wait(
    'self',
    (d) => d.self.inField >= other.self.inField,
  )
  assert.deepEqual(rival.self.pings, [])
  assert.equal(
    rival.events.some((e) => e.type === 'ping'),
    false,
  )
  host.send({ op: 'ping', point: { kind: 'clear' } })
  const blank = await ally.wait(
    'self',
    (d) => d.self.inField > other.self.inField && d.self.pings.length === 0,
  )
  assert.deepEqual(blank.self.pings, [])
})

test('private hosts choose a compatible battlefield and NPC rules that every peer receives', async (t) => {
  const open = await fixture(t),
    host = await open(),
    guest = await open()
  host.send({
    op: 'create',
    mode: 'garrison',
    map: 'relay-works',
    difficulty: 'elite',
    fill: true,
    loadout: { primary: 'mistral', finish: 'orchid', operator: 'tidewatch' },
  })
  await host.wait('welcome')
  const lobby = await host.wait('lobby')
  assert.equal(lobby.map, 'relay-works')
  assert.equal(lobby.difficulty, 'elite')
  guest.send({
    op: 'join',
    code: lobby.code,
    map: 'floodline',
    difficulty: 'recruit',
  })
  await guest.wait('welcome')
  await host.wait('lobby', (l) => l.players.length === 2)
  host.send({ op: 'start' })
  const [a, b] = await Promise.all([host.wait('begin'), guest.wait('begin')])
  for (const info of [a, b])
    assert.deepEqual(
      [info.mode, info.map, info.difficulty],
      ['garrison', 'relay-works', 'elite'],
    )
  assert.equal(a.seed, b.seed)
  const state = await guest.wait('state')
  assert.deepEqual(
    state.control.relays.map((r) => r.title),
    ['North Yard', 'Turbine Hall', 'South Bay'],
  )
  assert.equal(state.players.length, 10)
  const { self } = await host.wait('self')
  assert.deepEqual(
    [self.weapon, self.loadout.finish, self.operator],
    ['mistral', 'orchid', 'tidewatch'],
  )
})

test('public matchmaking groups peers by battlefield and does not let clients choose NPC skill', async (t) => {
  const open = await fixture(t, { quickWait: 5000 })
  const one = await open(),
    two = await open(),
    three = await open()
  one.send({
    op: 'quick',
    mode: 'resurgence',
    map: 'floodline',
    teamSize: 3,
    difficulty: 'elite',
  })
  await one.wait('welcome')
  const a = await one.wait('lobby')
  two.send({ op: 'quick', mode: 'resurgence', map: 'ridge', teamSize: 3 })
  await two.wait('welcome')
  const b = await two.wait('lobby')
  assert.notEqual(a.code, b.code)
  three.send({
    op: 'quick',
    mode: 'resurgence',
    map: 'floodline',
    teamSize: 3,
    difficulty: 'recruit',
  })
  await three.wait('welcome')
  const c = await three.wait('lobby')
  assert.equal(a.code, c.code)
  assert.notEqual(a.map, b.map)
  assert.equal(c.difficulty, 'standard')
})
