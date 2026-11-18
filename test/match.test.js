import test from 'node:test'
import assert from 'node:assert/strict'
import { Match } from '../src/game/match.js'
import {
  cleanInput,
  EMPTY_INPUT,
  integrate,
  moveState,
} from '../src/game/movement.js'
import { createWorld, distance } from '../src/game/world.js'

const dt = 1 / 30
const input = (extra) => ({ ...EMPTY_INPUT, ...extra })
const steps = (n, fn) => {
  for (let i = 0; i < n; i++) fn(i)
}
const set = (m, p, x, z) =>
  Object.assign(p, { ...moveState(x, m.world.height(x, z), z), x, z })

test('sprint, tactical sprint, slide jump, and crouch alter momentum and pose', () => {
  const world = createWorld('range', 173),
    p = moveState(0, world.height(0, 13), 13)
  let t = 0
  const move = (n, opts) =>
    steps(n, (i) =>
      integrate(
        p,
        input(typeof opts === 'function' ? opts(i) : opts),
        world,
        dt,
        (t += dt),
      ),
    )
  move(11, { z: 1 })
  const run = Math.hypot(p.vx, p.vz)
  assert.ok(run > 4.8 && run < 5.6)
  move(12, { z: 1, sprint: true })
  assert.ok(Math.hypot(p.vx, p.vz) > 7.9)
  move(9, (i) => ({ z: 1, sprint: true, tactical: i === 0 }))
  assert.ok(p.tactical > 0 && Math.hypot(p.vx, p.vz) > 10)
  move(2, { z: 1, crouch: true })
  assert.equal(p.stance, 'slide')
  assert.ok(p.height < 1.4)
  move(1, { z: 1, jump: true, jumpHeld: true })
  assert.equal(p.stance, 'jump')
  assert.equal(p.slide, 0)
  assert.ok(p.vy > 6.5 && Math.hypot(p.vx, p.vz) > 10)
  move(48, { crouch: true })
  assert.ok(p.grounded)
  assert.equal(p.stance, 'crouch')
  assert.ok(p.height < 1.08)
})

test('movement collides with walls, mantles over cover, and climbs a roof ladder', () => {
  const world = createWorld('range', 173)
  const p = moveState(19, world.height(19, -6.8), -6.8)
  let t = 0
  const move = (n, i) =>
    steps(n, () => integrate(p, input(i), world, dt, (t += dt)))
  move(26, { z: 1 })
  assert.ok(p.z > -7.38, 'the obstacle stops ground movement')
  const y = p.y
  move(21, { z: 1, jumpHeld: true })
  assert.ok(p.y > y + 1.6, 'mantling raised the player onto the tall step')
  const l = world.ladders[0]
  Object.assign(p, moveState(l.x, l.y, l.z + 0.38))
  move(57, { z: 1, jumpHeld: true })
  assert.ok(p.y >= l.top - 0.12, 'ladder reaches the roof')
  assert.ok(p.z < l.z)
})

test('aircraft runs the route, jump exits, parachute can be deployed and cut, with a safe auto-open', () => {
  const m = new Match({ mode: 'battle-royale', teamSize: 1, bots: 4 }),
    p = m.players.get('local')
  const initial = p.x
  steps(80, () => m.step(dt))
  assert.equal(p.air, 'plane')
  assert.ok(p.x > initial + 80)
  m.command(p.id, { yaw: 0, jump: true, pitch: -0.54, z: 1 })
  m.step(dt)
  assert.equal(p.air, 'freefall')
  m.command(p.id, { yaw: 0, jump: true, pitch: -0.54, z: 1 })
  m.step(dt)
  assert.equal(p.air, 'chute')
  m.command(p.id, { yaw: 0, crouch: true, pitch: -0.54, z: 1 })
  m.step(dt)
  assert.equal(p.air, 'freefall')
  for (let i = 0; i < 470 && p.air !== 'ground'; i++) {
    m.command(p.id, { yaw: 0, pitch: -0.54, z: 0.35 })
    m.step(dt)
  }
  assert.equal(p.air, 'ground')
  assert.ok(p.grounded)
  assert.ok(p.y >= m.world.height(p.x, p.z) - 0.5)
  assert.ok(m.events.some((e) => e.actor === p.id && e.type === 'land'))
})

test('weapon fire hits live targets and a completed reload deducts from reserve ammo', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  const q = m.world.targets.find((q) => q.x === 0 && q.z === -9),
    pitch = Math.atan2(q.y - p.y - 1.55, distance(p, q))
  m.command(p.id, { yaw: 0, pitch, fire: true, aim: true })
  m.step(dt)
  assert.equal(p.shots, 1)
  assert.equal(p.ammo, 29)
  assert.equal(p.targets, 1)
  assert.equal(p.hits, 1)
  m.command(p.id, { yaw: 0, pitch, reload: true })
  m.step(dt)
  assert.ok(p.reloadEnd > m.time)
  steps(55, () => m.step(dt))
  assert.equal(p.ammo, 30)
  assert.equal(p.stock, 119)
  assert.equal(p.reloadEnd, 0)
})

test('gas moves the circle on schedule, ignores armor, and BR resolves a surviving squad', () => {
  const m = new Match({
    mode: 'battle-royale',
    bots: 1,
    teamSize: 1,
    seed: 173,
  })
  const p = m.players.get('local'),
    q = m.players.get('bot1')
  set(m, p, 0, 0)
  set(m, q, 370, 369)
  m.time = 69
  m.gas = m.gasAt(m.time)
  m.lastGasTick = m.time - 1
  m.step(dt)
  assert.equal(m.gas.state, 'closing')
  assert.ok(m.gas.r < 420)
  assert.ok(q.health < 100)
  assert.equal(q.armor, 50)
  const tc = m.gasAt(273)
  assert.equal(tc.state, 'final')
  assert.ok(tc.r < 2)
  m.damage(q, 500, p)
  m.step(dt)
  assert.equal(q.alive, false)
  assert.equal(p.kills, 1)
  assert.equal(m.result.team, p.team)
  assert.ok(m.events.some((e) => e.type === 'matchEnd'))
})

test('Resurgence respawns with a surviving teammate before the late circles', () => {
  const m = new Match({
    mode: 'resurgence',
    teamSize: 2,
    bots: 2,
    players: [{ id: 'one' }, { id: 'two' }],
  })
  const p = m.players.get('one'),
    ally = m.players.get('two'),
    enemy = m.players.get('bot1')
  set(m, p, -50, 40)
  set(m, ally, -58, 49)
  set(m, enemy, 280, 280)
  assert.equal(p.team, ally.team)
  m.damage(p, 500, enemy)
  assert.ok(p.respawnAt > m.time)
  assert.equal(p.alive, false)
  m.time = p.respawnAt
  m.step(dt)
  assert.equal(p.alive, true)
  assert.equal(p.air, 'freefall')
  set(m, p, -53, 40)
  m.time = 185
  m.gas = m.gasAt(m.time)
  m.damage(p, 500, enemy)
  assert.equal(p.alive, false)
  assert.equal(p.respawnAt, 0)
})

test('arena rules count eliminations, reset deaths, and finish at the score goal', () => {
  for (const [mode, goal] of [
    ['team-deathmatch', 25],
    ['free-for-all', 15],
  ]) {
    const m = new Match({
      mode,
      teamSize: 1,
      bots: 0,
      players: [{ id: 'alpha' }, { id: 'beta' }],
    })
    const a = m.players.get('alpha'),
      b = m.players.get('beta')
    assert.notEqual(a.team, b.team)
    for (let i = 0; i < goal; i++) {
      m.damage(b, 1000, a)
      assert.ok(b.respawnAt > m.time)
      if (i < goal - 1) m.respawn(b)
    }
    m.step(dt)
    assert.equal(a.kills, goal)
    assert.equal(b.deaths, goal)
    assert.equal(m.result.team, a.team)
    if (mode === 'team-deathmatch') assert.equal(m.result.scores[a.team], goal)
  }
})

test('recon contracts pay the reward for securing the objective', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  const c = [...m.loot.values()].find(
    (i) => i.type === 'contract' && i.task === 'recon',
  )
  set(m, p, c.x, c.z + 0.84)
  m.interact(p)
  assert.ok(c.removed)
  assert.equal(p.contract.goal, 8)
  set(m, p, p.contract.x, p.contract.z)
  steps(250, () => m.step(dt))
  assert.equal(p.contract, null)
  assert.equal(p.cash, 1900)
  assert.ok(m.events.some((e) => e.type === 'contractDone'))
})

test('100 operators fit in a match, form quads, and produce snapshots throughout deployment', () => {
  const m = new Match({
    mode: 'battle-royale',
    teamSize: 4,
    bots: 119,
    capacity: 100,
    seed: 173,
  })
  assert.equal(m.players.size, 100)
  assert.equal(m.initialTeams, 25)
  steps(900, () => m.step(dt))
  const snap = m.sharedWire()
  assert.equal(snap.players.length, 100)
  assert.ok(snap.time >= 29.9)
  assert.ok(
    [...m.players.values()].every((p) =>
      [p.x, p.y, p.z, p.health, p.armor].every(Number.isFinite),
    ),
  )
  assert.ok([...m.players.values()].some((p) => p.air === 'ground'))
})

test('client inputs are bounded and old sequences cannot replay interaction or movement', () => {
  assert.equal(cleanInput({ x: 289, pitch: NaN, fire: 'yes', z: -7 }).x, 1)
  assert.deepEqual(
    cleanInput({ x: 289, pitch: NaN, fire: 'yes', z: -7 }),
    input({ x: 1, z: -1 }),
  )
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  m.command(p.id, { z: 1, yaw: 0 }, 11)
  m.command(p.id, { x: 1, reload: true }, 10)
  m.step(dt)
  assert.equal(p.ack, 11)
  assert.equal(p.vx, 0)
  assert.ok(p.vz < 0)
  assert.equal(p.reloadEnd, 0)
})
