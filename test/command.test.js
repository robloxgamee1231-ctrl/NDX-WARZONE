import test from 'node:test'
import assert from 'node:assert/strict'
import { MODE, WEAPONS } from '../src/config.js'
import { BOT_PROFILES, botCanSee } from '../src/game/bot-ai.js'
import { BotNavigator, walkSample } from '../src/game/bot-navigation.js'
import { DIFFICULTIES, normalizeDifficulty } from '../src/game/difficulty.js'
import {
  FINISHES,
  OPERATORS,
  PRIMARY_IDS,
  normalizeLoadout,
  resolveWeapon,
} from '../src/game/loadout.js'
import { mapForMode, mapsForMode } from '../src/game/map-catalog.js'
import { canalCenter, FLOOD_CROSSINGS } from '../src/game/map-layouts.js'
import { Match } from '../src/game/match.js'
import {
  EMPTY_INPUT,
  eyeHeight,
  forward,
  integrate,
  moveState,
} from '../src/game/movement.js'
import { nearestStaff, talkToStaff } from '../src/game/support.js'
import { createWorld, distance, planeAt, rayWorld } from '../src/game/world.js'

const dt = 1 / 30
function walk(world, start, yaw, ticks) {
  const p = {
    ...moveState(
      start.x,
      world.height(start.x, start.z),
      start.z,
      'ground',
      yaw,
    ),
    weapon: 'raven',
  }
  let top = p.y
  for (let tick = 1; tick <= ticks; tick++) {
    integrate(p, { ...EMPTY_INPUT, yaw, z: 1 }, world, dt, tick * dt)
    top = Math.max(top, p.y)
  }
  return { final: p, top }
}
function at(world, p, x, z, yaw = 0) {
  Object.assign(p, moveState(x, world.height(x, z), z, 'ground', yaw))
  return p
}
function run(match, player, ticks, order = {}) {
  for (let i = 0; i < ticks; i++) {
    match.command(player.id, { yaw: player.yaw, pitch: player.pitch, ...order })
    match.step(dt)
  }
}

test('the battlefield catalog lists compatible maps and always falls back to the selected playlist', () => {
  assert.deepEqual(
    mapsForMode(MODE['battle-royale']).map((m) => m.id),
    ['ridge', 'floodline'],
  )
  assert.deepEqual(
    mapsForMode(MODE.garrison).map((m) => m.id),
    ['yard', 'relay-works'],
  )
  assert.deepEqual(
    mapsForMode(MODE['training-range']).map((m) => m.id),
    ['range'],
  )
  assert.deepEqual(mapsForMode(MODE['private-match']), [])
  assert.equal(mapForMode(MODE.garrison, 'floodline').id, 'yard')
  assert.equal(mapForMode(MODE.resurgence, '__proto__').id, 'ridge')
  assert.equal(mapForMode(MODE['training-range'], 'relay-works').id, 'range')
})

test('Relay Works uses fixed independent objective sites, usable spawns, and a walkable two-sided catwalk', () => {
  const m = new Match({
    mode: 'garrison',
    map: 'relay-works',
    bots: 5,
    seed: 990,
  })
  const w = m.world
  assert.equal(w.map.name, 'Relay Works')
  assert.deepEqual(
    m.control.relays.map((r) => r.title),
    ['North Yard', 'Turbine Hall', 'South Bay'],
  )
  for (const p of m.players.values()) {
    assert.ok(p.team === 0 ? p.x < -30 : p.x > 30)
    assert.equal(
      rayWorld(
        w,
        { x: p.x, y: p.y + eyeHeight(p), z: p.z },
        { ...forward(p.yaw), y: 0 },
        8,
      ),
      8,
      'every spawn has an open release lane',
    )
  }
  for (const r of m.control.relays) assert.ok(walkSample(w, r.x, r.z))
  for (const side of [-1, 1]) {
    const move = walk(
      w,
      { x: 5.1, z: 22 * side },
      side === 1 ? 0 : Math.PI,
      105,
    )
    assert.ok(Math.abs(move.final.z) < 12.8)
    assert.ok(move.top > w.height(0, 0) + 2.65)
    assert.equal(move.final.grounded, true)
  }
  const beneath = walk(w, { x: 10.3, z: 0 }, Math.PI / 2, 56)
  assert.ok(beneath.final.x < 2)
  assert.equal(beneath.top, w.height(0, 0))
})

test('each Floodline bridge can be crossed without jumping and the dry channel is open underneath', () => {
  const w = createWorld('floodline', 173)
  assert.equal(w.sites.length, 7)
  assert.ok(w.pads.length >= 5)
  for (const z of FLOOD_CROSSINGS) {
    const center = canalCenter(z)
    const above = walk(w, { x: center - 40, z }, -Math.PI / 2, 520)
    assert.ok(above.final.x > center + 37, `deck and approaches at ${z}`)
    assert.ok(above.top > 5)
    const below = walk(w, { x: center, z: z + 11 }, 0, 130)
    assert.ok(below.final.z < z - 8, `underpass at ${z}`)
    assert.ok(below.top < 1.65)
  }
})

test('Floodline uses its own seeded geometry, aircraft course, and bounded gas radius', () => {
  const m = new Match({
    mode: 'battle-royale',
    map: 'floodline',
    seed: 177,
    difficulty: 'elite',
    bots: 0,
  })
  const p = m.players.get('local')
  assert.deepEqual([p.x, p.y, p.z], [-285, 136, 236])
  assert.equal(m.difficulty, 'elite')
  assert.ok(m.gas.r > m.world.half && m.gas.r < 500)
  run(m, p, 164)
  const flight = planeAt(m.time, m.world)
  assert.ok(distance(flight, p) < 1e-5)
  assert.equal(p.air, 'plane')
  run(m, p, 1, { jump: true })
  assert.equal(p.air, 'freefall')
  assert.ok(p.y < flight.y - 4, 'jump from below the aircraft, not inside it')
  assert.ok(
    m.rings.every(
      (r) => Math.abs(r.nx) < m.world.half && Math.abs(r.nz) < m.world.half,
    ),
  )
})

test('bot difficulty is bounded and affects the time between spotting a threat and firing', () => {
  assert.equal(normalizeDifficulty('superbot'), 'standard')
  assert.equal(normalizeDifficulty('__proto__'), 'standard')
  assert.deepEqual(Object.keys(DIFFICULTIES), [
    'recruit',
    'standard',
    'veteran',
    'elite',
  ])
  function acquire(difficulty) {
    const m = new Match({
      mode: 'free-for-all',
      map: 'relay-works',
      bots: 1,
      difficulty,
    })
    const [p, bot] = [...m.players.values()]
    at(m.world, bot, -10, 0, -Math.PI / 2)
    at(m.world, p, 0, 0, Math.PI / 2)
    m.time = 4
    assert.ok(botCanSee(m, bot, p))
    assert.equal(
      m.botInput(bot, [p, bot]).fire,
      false,
      'give humans a reaction window',
    )
    assert.equal(bot.brain.target, p.id)
    return bot.brain.aimLock - m.time
  }
  assert.ok(acquire('recruit') > 0.52)
  assert.ok(acquire('elite') < 0.29)
  assert.ok(DIFFICULTIES.recruit.damage < DIFFICULTIES.elite.damage)
})

test('even an Elite NPC loses target lock through cover and smoke', () => {
  const m = new Match({
    mode: 'free-for-all',
    map: 'relay-works',
    bots: 6,
    difficulty: 'elite',
  })
  const p = m.players.get('local')
  const b = [...m.players.values()].find((actor) => actor.role === 'point')
  at(m.world, b, 0, -2, Math.PI)
  at(m.world, p, 0, 16)
  assert.equal(botCanSee(m, b, p), false, 'turbine hall wall is solid')
  at(m.world, b, -10, 0, -Math.PI / 2)
  at(m.world, p, 0, 0)
  m.time = 7.5
  assert.ok(botCanSee(m, b, p))
  m.botInput(b, [p, b])
  assert.equal(b.brain.target, p.id)
  b.burstLeft = 2
  m.fields.push({
    id: 'smoke-1',
    x: -5,
    y: 1.15,
    z: 0,
    r: 7.2,
    starts: 0,
    until: 18,
  })
  assert.equal(botCanSee(m, b, p), false)
  assert.equal(m.botInput(b, [p, b]).fire, false)
  assert.equal(b.brain.target, null)
  assert.equal(b.burstLeft, 0, 'do not track through smoke with queued rounds')
  assert.ok(
    b.brain.last.until > m.time,
    'approximate last contact is retained briefly',
  )
})

test('role variety is seeded and preserves a standard client-visible operator roster', () => {
  const m = new Match({ mode: 'garrison', map: 'relay-works', bots: 8 })
  const actors = [...m.players.values()].filter((p) => p.bot)
  assert.deepEqual(
    new Set(actors.map((p) => p.role)),
    new Set(Object.keys(BOT_PROFILES)),
  )
  for (const p of actors) {
    assert.equal(p.weapon, BOT_PROFILES[p.role].weapon)
    assert.equal(p.tacticalType, BOT_PROFILES[p.role].tactical)
  }
  assert.equal(m.sharedWire().players.length, actors.length + 1)
  assert.ok(m.world.staff.length > 0)
  assert.equal(
    m.sharedWire().players.some((p) => String(p[0]).startsWith('crew-')),
    false,
  )
})

test('bounded navigation finds a walkable detour around a hall prop and never steps through it', () => {
  const w = createWorld('relay-works'),
    navigator = new BotNavigator(w)
  const start = walkSample(w, -8.5, -8),
    goal = walkSample(w, -8.5, 0)
  assert.ok(start && goal)
  assert.equal(navigator.connects(start, goal), false)
  const route = navigator.search(start, goal)
  assert.ok(route.length >= 2)
  assert.ok(distance(route.at(-1), goal) < 1)
  let current = start
  for (const waypoint of route) {
    assert.ok(navigator.connects(current, waypoint))
    current = waypoint
  }
  assert.deepEqual(navigator.search({ ...start, y: start.y + 5 }, goal), [])
})

test('Coach Vale can open a drill board without blocking range fire or counting as an opponent', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  assert.equal(nearestStaff(m.world, p).name, 'Coach Vale')
  assert.ok(m.interact(p))
  assert.equal(m.events.at(-1).service, 'coach')
  assert.equal(p.services, 0)
  assert.equal(m.players.size, 1)
  assert.ok(m.drill(p.id, 'steel'))
  assert.equal(talkToStaff(m, p), false)
})

test('quartermasters fill empty reserves once without refilling magazines or spending cash', () => {
  const m = new Match({ mode: 'garrison', map: 'relay-works', bots: 0 }),
    p = m.players.get('local')
  const supply = m.world.staff.filter((n) => n.kind === 'supply')
  assert.equal(supply.length, 2)
  at(m.world, p, supply[0].x, supply[0].z + 1)
  const startCash = p.cash
  assert.equal(talkToStaff(m, p), false, 'full reserves do not spend your use')
  assert.equal(p.services, 0)
  m.time = 5
  p.ammo = 4
  p.stock = 5
  p.kit[1].stock = 1
  p.tacticalCharges = 0
  assert.ok(talkToStaff(m, p))
  assert.equal(p.ammo, 4)
  assert.equal(p.stock, WEAPONS.raven.stock)
  assert.equal(p.kit[1].stock, WEAPONS.spectre.stock)
  assert.equal(p.tacticalCharges, 2)
  assert.equal(p.cash, startCash)
  assert.equal(m.selfWire(p).services, p.services)
  assert.equal(p.services, 1)
  at(m.world, p, supply[1].x, supply[1].z + 1)
  m.time = 6
  p.stock = 0
  assert.equal(
    talkToStaff(m, p),
    false,
    'another quartermaster shares the same one-use budget',
  )
})

test('interact selects nearby loot ahead of distant staff and never talks through cover', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  m.loot.clear()
  const coach = nearestStaff(m.world, p)
  assert.ok(coach)
  const item = m.spawnLoot('ammo', p.x, p.z - 0.65)
  p.stock = 20
  assert.equal(nearestStaff(m.world, p, item), null)
  m.interact(p)
  assert.ok(item.removed)
  assert.ok(p.stock > 20)
  assert.ok(m.events.every((e) => e.type !== 'staff'))
  m.interact(p)
  assert.equal(m.events.at(-1).service, 'coach')

  const w = createWorld('relay-works', 173)
  const south = { ...p, ...moveState(0, 1.15, 8.8, 'ground', Math.PI) }
  const north = { ...coach, x: 0, y: 1.15, z: 11.4 }
  assert.ok(distance(south, north) < 3.18)
  assert.equal(nearestStaff({ ...w, staff: [north] }, south), null)
})

test('field aid requires safe proximity and never grants invulnerability, armor, or repeated heals', () => {
  const m = new Match({ mode: 'garrison', map: 'relay-works', bots: 0 }),
    p = m.players.get('local')
  const npc = m.world.staff.find((n) => n.kind === 'medic')
  p.health = 26
  p.armor = 30
  assert.equal(talkToStaff(m, p), false)
  at(m.world, p, npc.x, npc.z + 1)
  m.time = 1
  p.lastDamage = 0.1
  assert.equal(talkToStaff(m, p), false)
  m.time = 4
  assert.ok(talkToStaff(m, p))
  assert.equal(p.health, 68)
  assert.equal(p.armor, 30)
  m.time = 8
  assert.equal(talkToStaff(m, p), false)
  assert.equal(p.health, 68)
})

test('all six primary weapons and finishes normalize without XP, and cosmetics never change weapon stats', () => {
  assert.equal(PRIMARY_IDS.length, 6)
  assert.equal(Object.keys(FINISHES).length, 6)
  assert.equal(Object.keys(OPERATORS).length - 1, 6)
  for (const primary of PRIMARY_IDS) {
    const kit = normalizeLoadout({
      primary,
      finish: 'frost',
      operator: 'emberline',
    })
    const m = new Match({
      mode: 'training-range',
      players: [{ id: 'local', name: 'New account', loadout: kit }],
    })
    const p = m.players.get('local')
    assert.equal(p.weapon, primary)
    assert.equal(p.loadout.finish, 'frost')
    assert.equal(p.operator, 'emberline')
    assert.equal(p.ammo, resolveWeapon(primary, kit.attachments).mag)
  }
  assert.equal(
    normalizeLoadout({ finish: '__proto__', operator: 'internal' }).finish,
    'issue',
  )
  assert.equal(
    normalizeLoadout({ finish: '__proto__', operator: 'internal' }).operator,
    'auto',
  )
})

test('Mistral trigger tap yields a three-round burst, then pauses before another burst', () => {
  const m = new Match({
      mode: 'training-range',
      players: [{ id: 'local', weapon: 'mistral' }],
    }),
    p = m.players.get('local')
  run(m, p, 1, { fire: true })
  assert.equal(p.shots, 1)
  assert.equal(p.burstLeft, 2)
  run(m, p, 8)
  assert.equal(p.shots, 3)
  assert.equal(p.ammo, 24)
  assert.equal(p.burstLeft, 0)
  const ready = p.burstReady
  assert.ok(m.time < ready)
  run(m, p, 2, { fire: true })
  assert.equal(p.shots, 3)
  while (m.time + dt < ready) run(m, p, 1)
  run(m, p, 1, { fire: true })
  assert.equal(p.shots, 4)
})

test('swapping or loading cancels a pending burst and keeps magazines independent', () => {
  const m = new Match({
      mode: 'training-range',
      players: [{ id: 'local', weapon: 'mistral' }],
    }),
    p = m.players.get('local')
  run(m, p, 1, { fire: true })
  run(m, p, 1, { sidearm: true })
  assert.equal(p.weapon, 'spectre')
  assert.equal(p.burstLeft, 0)
  run(m, p, 15)
  assert.equal(p.shots, 1)
  assert.equal(p.ammo, 12)
  run(m, p, 1, { primary: true })
  assert.equal(p.ammo, 26)
  run(m, p, 10)
  run(m, p, 1, { fire: true })
  run(m, p, 1, { reload: true })
  assert.equal(p.burstLeft, 0)
  assert.ok(p.reloadEnd > m.time)
})

test('Harrier scatter spends one shell and applies one aggregated damage/hit transaction', () => {
  const m = new Match({
    mode: 'garrison',
    map: 'relay-works',
    bots: 0,
    players: [{ id: 'shooter', weapon: 'harrier' }, { id: 'rival' }],
  })
  const [p, q] = m.players.values()
  at(m.world, p, -3.1, 0, -Math.PI / 2)
  at(m.world, q, 0, 0, Math.PI / 2)
  const pitch = Math.atan2(q.height * 0.65 - eyeHeight(p), 3.1)
  m.fire(p, { ...EMPTY_INPUT, yaw: p.yaw, pitch, aim: true })
  assert.equal(p.shots, 1)
  assert.equal(p.ammo, 6)
  assert.equal(p.hits, 1)
  const events = m.events.filter((e) => e.type === 'hit')
  assert.equal(events.length, 1)
  assert.equal(events[0].target, q.id)
  assert.ok(
    q.armor + q.health <= 112,
    'close target catches most of the spread',
  )
  m.fire(p, { ...EMPTY_INPUT, yaw: p.yaw, pitch, aim: true })
  assert.equal(p.shots, 1, 'the next shell is not instant')
})

test('seeded Elite NPC teams can finish a Relay Works round with contested play and scoring on both sides', () => {
  const m = new Match({
    mode: 'garrison',
    map: 'relay-works',
    difficulty: 'elite',
    seed: 377,
    bots: 12,
    players: [],
  })
  for (const side of [0, 1]) {
    const roles = [...m.players.values()]
      .filter((p) => p.team === side)
      .map((p) => p.role)
    assert.deepEqual(
      new Set(roles),
      new Set(Object.keys(BOT_PROFILES)),
      'no role is reserved for a team',
    )
  }
  for (let i = 0; i < 30 * 343 && !m.result; i++) m.step(dt)
  assert.ok(m.result)
  assert.ok(Math.max(...m.scores) >= 180)
  assert.ok(Math.min(...m.scores) >= 30)
  assert.ok([...m.players.values()].some((p) => p.kills > 0))
})
