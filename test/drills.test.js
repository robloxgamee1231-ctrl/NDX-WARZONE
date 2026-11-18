import test from 'node:test'
import assert from 'node:assert/strict'
import { DRILLS, drillAllowsTarget } from '../src/game/training.js'
import { Match } from '../src/game/match.js'
import { eyeHeight, moveState } from '../src/game/movement.js'
import { distance } from '../src/game/world.js'

const dt = 1 / 30
const targeted = (m, id) => m.world.targets.find((t) => t.id === id)
const setup = (weapon = 'raven') => {
  const m = new Match({
    mode: 'training-range',
    players: [{ id: 't', name: 'Range Tester', weapon }],
  })
  return { m, p: m.players.get('t') }
}

function step(m, seconds, input) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    m.command('t', input ?? {})
    m.step(dt)
  }
}

function shootAt(m, p, t) {
  const yaw = Math.atan2(p.x - t.x, p.z - t.z)
  const pitch = Math.atan2(t.y - p.y - eyeHeight(p), distance(p, t))
  m.command(p.id, { yaw, pitch, aim: true, fire: true })
  m.step(dt)
  step(m, 0.14, { yaw, pitch, aim: true })
}

test('drills validate their format and only start alive on the practice ground', () => {
  const { m, p } = setup()
  assert.equal(m.drill('nonexistent', 'steel'), false)
  assert.equal(m.drill(p.id, { toString: null }), false)
  assert.equal(m.drill(p.id, '__proto__'), false)
  assert.equal(m.drill(p.id, 'cancel'), false)
  p.grounded = false
  assert.equal(m.drill(p.id, 'steel'), false)
  p.grounded = true
  assert.ok(m.drill(p.id, 'steel'))
  assert.equal(m.drill(p.id, 'steel'), false)
  assert.equal(
    new Match({ mode: 'battle-royale', bots: 0 }).drill('local', 'steel'),
    false,
  )
})

test('countdown locks movement and firing but preserves camera look', () => {
  const { m, p } = setup()
  assert.ok(m.drill(p.id, 'steel'))
  const initial = { ...p }
  step(m, 1, {
    z: 1,
    x: 0.5,
    yaw: 0.85,
    pitch: 0.12,
    fire: true,
    crouch: true,
    jump: true,
    plate: true,
  })
  assert.equal(p.x, initial.x)
  assert.equal(p.z, initial.z)
  assert.equal(p.shots, 0)
  assert.equal(p.plateActive, false)
  assert.ok(Math.abs(p.yaw - 0.85) < 0.001)
  assert.equal(p.pitch, 0.12)
  assert.equal(m.training.state, 'countdown')
  const prepared = m.events.find((e) => e.type === 'drillReady')
  assert.equal(prepared.kind, 'steel')
  step(m, 2.2)
  assert.equal(m.training.state, 'active')
  assert.equal(m.events.filter((e) => e.type === 'drillStart').length, 1)
})

test('Steel Sequence counts misses only once, locks inactive plates, and grants a scored qualification', () => {
  const { m, p } = setup()
  m.drill(p.id, 'steel')
  step(m, 3.15)
  assert.equal(m.training.stage, 0)
  const [first, wrong] = DRILLS.steel.targets
  assert.ok(drillAllowsTarget(m, targeted(m, first)))
  assert.equal(drillAllowsTarget(m, targeted(m, wrong)), false)
  shootAt(m, p, targeted(m, wrong))
  assert.equal(m.training.shots, 1)
  assert.equal(m.training.hits, 0)
  for (const [i, id] of DRILLS.steel.targets.entries()) {
    for (let attempt = 0; m.training.stage === i && attempt < 4; attempt++)
      shootAt(m, p, targeted(m, id))
    assert.equal(m.training.stage, i + 1)
  }
  assert.equal(m.training.state, 'passed')
  assert.equal(m.training.grade, 'GOLD')
  assert.equal(m.training.hits, DRILLS.steel.targets.length)
  assert.ok(m.training.shots > m.training.hits)
  assert.equal(
    m.events.find((e) => e.type === 'drillDone').drill.time,
    m.training.time,
  )
})

test('the momentum circuit rejects skipped gates and passing beneath stacked concrete', () => {
  const { m, p } = setup()
  assert.ok(m.drill(p.id, 'course'))
  step(m, 3.2)
  const gates = DRILLS.course.gates
  function reach(gate, lift) {
    Object.assign(
      p,
      moveState(gate.x, m.world.height(gate.x, gate.z) + lift, gate.z),
    )
    m.step(dt)
  }
  reach(gates.at(-1), gates.at(-1).lift)
  assert.equal(m.training.stage, 0)
  reach(gates[0], 0)
  reach(gates[1], 0)
  reach(gates[2], -1)
  assert.equal(m.training.stage, 2)
  for (const g of gates.slice(2)) reach(g, g.lift)
  assert.equal(m.training.stage, gates.length)
  assert.equal(m.training.state, 'passed')
})

test('armor drill interrupts a held plate and requires all three pulses before qualifying', () => {
  const { m, p } = setup()
  assert.ok(m.drill(p.id, 'armor'))
  assert.equal(p.plates, 8)
  step(m, 3.01)
  step(m, 1.02)
  step(m, 0.42, { plate: true })
  assert.equal(m.training.stage, 1)
  assert.equal(p.plateBlocked, true)
  assert.equal(p.plates, 8)
  step(m, 1.35, { plate: true })
  assert.equal(p.armor, 68)
  step(m, 0.04)
  step(m, 1.17, { plate: true })
  assert.notEqual(m.training.state, 'passed')
  for (let i = 0; i < 700 && m.training.state === 'active'; i++) {
    step(m, dt, { plate: !p.plateBlocked })
  }
  assert.equal(m.training.state, 'passed')
  assert.equal(m.training.stage, 3)
  assert.equal(p.armor, 150)
  assert.ok(p.plates < 8)
})

test('expiration fails once and cancel restores unrestricted target practice', () => {
  const { m, p } = setup()
  m.drill(p.id, 'steel')
  step(m, 3.05)
  const inactive = targeted(m, DRILLS.steel.targets[2])
  assert.equal(drillAllowsTarget(m, inactive), false)
  m.time = m.training.end
  m.step(dt)
  assert.equal(m.training.state, 'failed')
  assert.equal(m.training.grade, 'UNQUALIFIED')
  m.step(dt)
  assert.equal(m.events.filter((e) => e.type === 'drillDone').length, 1)
  assert.ok(m.drill(p.id, 'cancel'))
  assert.ok(drillAllowsTarget(m, inactive))
  assert.equal(m.training, null)
})
