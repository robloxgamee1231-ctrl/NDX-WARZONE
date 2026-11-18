import test from 'node:test'
import assert from 'node:assert/strict'
import { WEAPONS } from '../src/config.js'
import { Match, nearbyLoot } from '../src/game/match.js'
import {
  applyPreset,
  equippedSpec,
  normalizeLoadout,
  replacePrimary,
  resolveWeapon,
  swapWeapon,
} from '../src/game/loadout.js'
import { moveState } from '../src/game/movement.js'
import {
  crateHeight,
  claimResupply,
  updateReinforcements,
} from '../src/game/reinforcements.js'
import {
  MASK_CAPACITY,
  PING_SECONDS,
  insideSmoke,
  obscured,
  setSquadPing,
  tacticalWire,
  trimTactics,
  useTactical,
} from '../src/game/tactics.js'

const dt = 1 / 30
const ground = (m, p, x, z, yaw = 0) =>
  Object.assign(p, moveState(x, m.world.height(x, z), z, 'ground', yaw))
const train = (loadout = {}) =>
  new Match({ mode: 'training-range', players: [{ id: 'p', loadout }] })
const arena = (loadout = {}) =>
  new Match({
    mode: 'battle-royale',
    teamSize: 2,
    bots: 0,
    players: [{ id: 'one', loadout }, { id: 'ally' }, { id: 'foe' }],
  })

test('loadout normalization rejects unknown keys and extended magazines trade reload time for capacity', () => {
  const sanitized = normalizeLoadout({
    primary: 'spectre',
    tactical: { toString: null },
    operator: '__proto__',
    attachments: { stock: 'bogus', feed: 'extended', optic: 'scope' },
  })
  assert.equal(sanitized.primary, 'raven')
  assert.equal(sanitized.tactical, 'smoke')
  assert.equal(sanitized.operator, 'auto')
  assert.deepEqual(sanitized.attachments, {
    optic: 'scope',
    stock: 'standard',
    feed: 'extended',
  })
  const a = resolveWeapon('raven', sanitized.attachments)
  assert.equal(a.mag, 38)
  assert.ok(a.reload > WEAPONS.raven.reload)
  assert.ok(a.aimSpread < 1)
  assert.ok(a.speed < 1)
  assert.equal(a.damage, WEAPONS.raven.damage)
  assert.equal(a, resolveWeapon('raven', { ...sanitized.attachments }))
  assert.equal(resolveWeapon('spectre', sanitized.attachments), WEAPONS.spectre)
})

test('weapons preserve each slot’s exact ammo and cancel a reload on a real swap', () => {
  const m = train({ primary: 'viper', attachments: { feed: 'fast' } })
  const p = m.players.get('p')
  assert.equal(p.ammo, 30)
  p.ammo = 2
  p.stock = 36
  m.startReload(p)
  assert.ok(p.reloadEnd > m.time)
  m.command(p.id, { sidearm: true })
  m.step(dt)
  assert.equal(p.weapon, 'spectre')
  assert.equal(p.ammo, 12)
  assert.equal(p.reloadEnd, 0)
  assert.equal(swapWeapon(p, m.time + 0.2), false)
  p.ammo = 7
  p.stock = 23
  m.time += 0.3
  m.command(p.id, { primary: true })
  m.step(dt)
  assert.deepEqual([p.weapon, p.ammo, p.stock], ['viper', 2, 36])
  assert.deepEqual(p.kit[1], { id: 'spectre', ammo: 7, stock: 23 })
})

test('floor pickups replace only the primary and do not mint ammunition on repeated exchanges', () => {
  const m = train({ primary: 'raven' })
  const p = m.players.get('p')
  p.ammo = 3
  p.stock = 17
  assert.ok(swapWeapon(p, m.time))
  p.ammo = 1
  const item = { weapon: 'kestrel', loaded: 3, reserve: 4 }
  assert.ok(replacePrimary(p, item))
  assert.equal(p.weapon, 'kestrel')
  assert.equal(p.ammo, 3)
  assert.deepEqual(item, { weapon: 'raven', loaded: 3, reserve: 17 })
  assert.ok(replacePrimary(p, item))
  assert.equal(p.weapon, 'raven')
  assert.equal(p.ammo, 3)
  assert.equal(p.stock, 17)
  assert.equal(p.kit[1].ammo, 1)
})

test('a deployed attachment spec is used on the authoritative reload path', () => {
  const m = train({ attachments: { feed: 'extended' } })
  const p = m.players.get('p')
  p.ammo = 29
  p.stock = 5
  m.startReload(p)
  const spec = equippedSpec(p)
  assert.equal(p.reloadEnd, spec.reload)
  m.time = p.reloadEnd
  m.step(dt)
  assert.equal(p.ammo, 34)
  assert.equal(p.stock, 0)
})

test('smoke is delayed, bounded, vertically limited, and expired by match time', () => {
  const m = train()
  const p = m.players.get('p')
  assert.ok(useTactical(m, p))
  assert.equal(p.tacticalCharges, 1)
  assert.equal(useTactical(m, p), false)
  const [field] = m.fields
  assert.equal(insideSmoke(m.fields, m.time, field), false)
  m.time = field.starts + 0.05
  assert.equal(insideSmoke(m.fields, m.time, field), true)
  assert.equal(
    insideSmoke(m.fields, m.time, { ...field, y: field.y + 12 }),
    false,
  )
  const outside = { x: field.x - 12, y: field.y, z: field.z }
  assert.ok(
    obscured(m.fields, m.time, outside, { ...outside, x: field.x + 12 }),
  )
  assert.equal(
    obscured(m.fields, m.time, outside, { ...outside, z: field.z + 40 }),
    false,
  )
  m.time = field.until + 0.02
  trimTactics(m)
  assert.deepEqual(m.fields, [])
})

test('recon is shared only with squad members and expires or clears after the contact dies', () => {
  const m = arena({ tactical: 'pulse' })
  const p = m.players.get('one'),
    ally = m.players.get('ally'),
    foe = m.players.get('foe')
  ground(m, p, 0, 0)
  ground(m, ally, 8, 1)
  ground(m, foe, 0, 21)
  assert.ok(useTactical(m, p))
  assert.deepEqual(tacticalWire(m, p).contacts, [foe.id])
  assert.deepEqual(tacticalWire(m, ally).contacts, [foe.id])
  assert.deepEqual(tacticalWire(m, foe).contacts, [])
  foe.alive = false
  trimTactics(m)
  assert.deepEqual(tacticalWire(m, ally).contacts, [])
})

test('stim heals only health, resets the tactical sprint cooldown, and cannot be spent at full health without cooldown', () => {
  const m = train({ tactical: 'stim' })
  const p = m.players.get('p')
  assert.equal(useTactical(m, p), false)
  p.tacCooldown = 4
  p.health = 71
  p.armor = 12
  assert.ok(useTactical(m, p))
  assert.equal(p.health, 100)
  assert.equal(p.armor, 12)
  assert.equal(p.tacticalCharges, 0)
  assert.equal(p.tacCooldown, 0)
})

test('gas filters consume only the absorbed portion of a gas tick and leave armor untouched', () => {
  const m = arena()
  const p = m.players.get('one')
  p.mask = MASK_CAPACITY
  m.damage(p, 28, null, 'gas')
  assert.deepEqual([p.mask, p.health, p.armor], [7, 100, 50])
  m.damage(p, 11, null, 'gas')
  assert.deepEqual([p.mask, p.health, p.armor], [0, 96, 50])
  assert.ok(
    m.events.some((e) => e.type === 'notice' && e.text.includes('depleted')),
  )
})

test('a squad has one waypoint per caller, each validated, rate-limited, and time-bounded', () => {
  const m = arena()
  const p = m.players.get('one'),
    ally = m.players.get('ally'),
    foe = m.players.get('foe')
  assert.equal(setSquadPing(m, p, { kind: 'move', x: Infinity, z: 1 }), false)
  assert.equal(setSquadPing(m, p, { kind: 'move', x: 0, z: 2000 }), false)
  assert.equal(setSquadPing(m, p, { kind: 'opponent', x: 0, z: 0 }), false)
  assert.equal(
    setSquadPing(m, p, { kind: 'look' }),
    false,
    'aircraft uses map clicks',
  )
  assert.ok(m.ping(p.id, { kind: 'danger', x: 12.345, z: 21.349 }))
  const mark = tacticalWire(m, p).pings[0]
  assert.deepEqual([mark.kind, mark.x, mark.z], ['danger', 12.3, 21.3])
  assert.deepEqual(tacticalWire(m, ally).pings, [mark])
  assert.deepEqual(tacticalWire(m, foe).pings, [])
  assert.equal(m.ping(p.id, { kind: 'move', x: 6, z: 6 }), false)
  m.time += 0.74
  assert.ok(m.ping(p.id, { kind: 'clear' }))
  assert.equal(m.pings.size, 0)
  m.time += 0.4
  assert.ok(m.ping(p.id, { kind: 'move', x: 0, z: 0 }))
  m.time += PING_SECONDS + 1
  trimTactics(m)
  assert.deepEqual(tacticalWire(m, p).pings, [])
})

test('reinforcement drops are announced airborne, descend, then grant a bounded refit once per player', () => {
  const m = arena({
    primary: 'kestrel',
    tactical: 'stim',
    attachments: { feed: 'extended' },
  })
  m.time = 40
  updateReinforcements(m)
  const [item] = [...m.loot.values()].filter((x) => x.type === 'supply')
  const p = m.players.get('one')
  ground(m, p, item.x, item.z + 0.65)
  p.armor = 31
  p.health = 51
  assert.ok(crateHeight(item, m.time) > item.y + 60)
  assert.notEqual(nearbyLoot([item], p, m.world), item)
  assert.equal(claimResupply(m, p, item), false)
  m.time = item.landed + 0.01
  updateReinforcements(m)
  assert.equal(crateHeight(item, m.time), item.y)
  assert.equal(item.falling, false)
  assert.equal(nearbyLoot([item], p, m.world), item)
  p.ammo = 1
  p.stock = 0
  p.tacticalCharges = 0
  assert.ok(claimResupply(m, p, item))
  assert.deepEqual(
    [p.ammo, p.stock, p.tacticalCharges, p.armor, p.health],
    [18, 70, 1, 31, 51],
  )
  assert.equal(item.count, 3)
  assert.equal(claimResupply(m, p, item), false)
  assert.equal(nearbyLoot([item], p, m.world), null)
  assert.ok(m.lootSince(item.rev - 1).includes(item))
})

test('launch pads are deterministic by world seed and open a bounded ascent before parachute control', () => {
  const m = arena()
  const p = m.players.get('one')
  assert.ok(m.world.pads.length >= 5)
  const pad = m.world.pads[0]
  const height = pad.y
  ground(m, p, pad.x, pad.z, pad.yaw)
  m.command(p.id, { yaw: pad.yaw, interact: true })
  m.step(dt)
  assert.equal(p.air, 'freefall')
  assert.ok(p.vy > 30)
  const reference = p.launchReady
  for (let i = 0; i < 33; i++) {
    m.command(p.id, { yaw: pad.yaw, jump: true })
    m.step(dt)
  }
  assert.ok(p.y > height + 15)
  assert.equal(p.air, 'freefall')
  for (let i = 0; i < 12 && p.air !== 'chute'; i++) {
    m.command(p.id, { yaw: pad.yaw, jump: true })
    m.step(dt)
  }
  assert.equal(p.air, 'chute')
  assert.equal(p.launchReady, reference)
  assert.equal(m.events.filter((e) => e.type === 'launch').length, 1)
})

test('preset refits reset only ammunition and combat equipment, not cash, health, or plate state', () => {
  const m = train({ tactical: 'pulse' })
  const p = m.players.get('p')
  Object.assign(p, {
    ammo: 4,
    stock: 0,
    heals: 2,
    armor: 98,
    health: 23,
    plateProgress: 0.4,
    cash: 1320,
  })
  applyPreset(p)
  assert.deepEqual(
    [
      p.ammo,
      p.stock,
      p.tacticalCharges,
      p.armor,
      p.health,
      p.plateProgress,
      p.cash,
    ],
    [30, 120, 2, 98, 23, 0.4, 1320],
  )
})
