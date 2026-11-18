import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { parseGlb } from '../tools/check-models.mjs'
import { GUN_LADDER, TAG_SECONDS } from '../src/game/arcade.js'
import { Match } from '../src/game/match.js'
import { moveState } from '../src/game/movement.js'
import { readActor } from '../src/game/wire.js'
import { walkSample } from '../src/game/bot-navigation.js'
import { createWorld, rayWorld } from '../src/game/world.js'

const tick = 1 / 30
const match = (mode) =>
  new Match({
    mode,
    seed: 177,
    bots: 0,
    players: [
      {
        id: 'a',
        loadout: {
          primary: 'viper',
          attachments: { feed: 'extended' },
          operator: 'nomad',
        },
      },
      { id: 'b' },
    ],
  })
const at = (p, x, z, y = 0, yaw = 0) =>
  Object.assign(p, moveState(x, y, z, 'ground', yaw))

test('Gun Game advances all seven tiers, keeps progress on respawn, and cannot switch around the ladder', () => {
  const m = match('gun-game'),
    a = m.players.get('a'),
    b = m.players.get('b')
  assert.equal(m.world.map.id, 'neon-district')
  assert.deepEqual(
    [a.weapon, a.gunStage, a.ammo, a.operator],
    ['raven', 0, 30, 'nomad'],
  )
  m.command('a', { sidearm: true, yaw: a.yaw, pitch: 0 }, 1)
  m.step(tick)
  assert.equal(a.weapon, 'raven')
  for (const [stage, weapon] of GUN_LADDER.entries()) {
    assert.equal(a.weapon, weapon)
    m.eliminate(b, a)
    assert.equal(a.gunStage, stage + 1)
    if (stage === 2) {
      m.eliminate(a, b)
      assert.equal(a.streak, 0)
      m.respawn(a)
      assert.equal(a.weapon, GUN_LADDER[stage + 1])
    }
    m.respawn(b)
    m.checkEnd()
    if (stage + 1 < GUN_LADDER.length) assert.equal(m.result, null)
  }
  assert.equal(m.result.team, a.team)
  const actor = readActor(m.sharedWire().players[0])
  assert.equal(actor.gunStage, GUN_LADDER.length)
  assert.equal(actor.kills, 7)
})

test('Gun Game timeout can draw; it does not award a winner for an empty roster', () => {
  const m = match('gun-game')
  m.time = m.mode.duration
  m.checkEnd()
  assert.equal(m.result.team, null)
  const empty = match('free-for-all')
  empty.removePlayer('a')
  empty.removePlayer('b')
  empty.time = empty.mode.duration
  empty.checkEnd()
  assert.equal(empty.result.team, null)
})

test('Kill Confirmed only scores enemy tags, denies friendly tags, expires tags and wires updates', () => {
  const m = match('kill-confirmed'),
    a = m.players.get('a'),
    b = m.players.get('b')
  at(a, -26, 0)
  at(b, -23, 0)
  m.eliminate(b, a)
  assert.equal(m.scores[a.team], 0, 'kills alone never score')
  const first = [...m.tags.values()][0]
  assert.equal(first.endAt, TAG_SECONDS)
  assert.equal(first.team, b.team)
  assert.equal(
    m.nearbyLoot(a)?.type === 'tag',
    false,
    'tag is walk-to-collect, not interact',
  )
  at(a, first.x + 0.1, first.z)
  m.step(tick)
  assert.deepEqual([a.confirms, a.denies, m.scores[a.team]], [1, 0, 1])
  assert.ok(first.removed)
  assert.ok(m.lootSince(0).some((x) => x.id === first.id && x.removed))
  m.step(tick)
  assert.equal(m.scores[a.team], 1, 'no duplicate collection')
  m.respawn(b)
  at(b, 0, 5)
  m.eliminate(a, b)
  m.respawn(a)
  at(a, first.x, first.z)
  m.step(tick)
  assert.deepEqual([a.denies, m.scores[b.team]], [1, 0])
  m.eliminate(b, a)
  const expired = [...m.tags.values()][0]
  m.time += TAG_SECONDS + 0.1
  at(a, expired.x, expired.z)
  m.step(tick)
  assert.ok(expired.removed)
  assert.equal(a.confirms, 1)
  m.respawn(b)
  at(b, -23, 0)
  at(a, -25.2, 0)
  m.scores[a.team] = m.mode.goal - 1
  m.eliminate(b, a)
  at(a, -23, 0)
  m.step(tick)
  assert.equal(m.result.team, a.team)
  assert.equal(readActor(m.sharedWire().players[0]).confirms, 2)
})

test('District walls block hits and tags on a higher deck are not collected from below', () => {
  const m = match('kill-confirmed'),
    a = m.players.get('a'),
    b = m.players.get('b')
  at(a, 0, -10, 0)
  at(b, 0, -10, 3.44)
  m.eliminate(b, a)
  m.step(tick)
  assert.equal(a.confirms, 0)
  assert.ok(m.tags.size)
  assert.ok(
    rayWorld(m.world, { x: -33, z: -13, y: 1.6 }, { x: 1, y: 0, z: 0 }, 26) < 5,
  )
})

test('District has open spawn nodes, named Domination zones, and two usable skybridge stairs', () => {
  const world = createWorld('neon-district', 17)
  assert.equal(world.spawns.length, 18)
  assert.ok(world.spawns.every((p) => walkSample(world, p.x, p.z)))
  assert.ok(
    world.spawns.some((p) => p.x < -31) && world.spawns.some((p) => p.x > 31),
  )
  assert.deepEqual(
    world.relayPoints.map((r) => r.title),
    ['Aster Concourse', 'District Crossing', 'Ember Concourse'],
  )
  for (const sign of [-1, 1]) {
    const m = match('gun-game'),
      b = m.players.get('b'),
      yaw = (sign * Math.PI) / 2
    at(b, sign * 17.03, -9.9, 0, yaw)
    for (let i = 0; i < 73; i++) {
      m.command('b', { yaw, z: 1 })
      m.step(tick)
    }
    assert.ok(Math.abs(b.x) < 7)
    assert.ok(Math.abs(b.y - 3.44) < 0.02)
  }
})

test('District asset has embedded JPEGs and all compressed views decode through the shipped WASM decoder', async () => {
  const bytes = await readFile(
    new URL('../public/models/maps/neon-district.glb', import.meta.url),
  )
  const json = parseGlb(bytes),
    header = 28 + bytes.readUInt32LE(12)
  assert.match(json.asset.generator, /glTF/)
  assert.ok(json.images.length >= 6)
  assert.ok(
    json.images.every((img) => img.mimeType === 'image/jpeg' && !img.uri),
  )
  assert.equal(MeshoptDecoder.supported, true)
  await MeshoptDecoder.ready
  let views = 0
  for (const view of json.bufferViews) {
    const c = view.extensions?.EXT_meshopt_compression
    if (!c) continue
    const result = new Uint8Array(c.byteStride * c.count)
    const packed = bytes.subarray(
      header + c.byteOffset,
      header + c.byteOffset + c.byteLength,
    )
    assert.equal(packed.length, c.byteLength)
    MeshoptDecoder.decodeGltfBuffer(
      result,
      c.count,
      c.byteStride,
      packed,
      c.mode,
      c.filter,
    )
    assert.ok(
      result.some((x) => x !== 0),
      'decoded geometry cannot be empty',
    )
    views++
  }
  assert.ok(
    views >= 90,
    `Expected compressed sector geometry, found ${views} views`,
  )
})
