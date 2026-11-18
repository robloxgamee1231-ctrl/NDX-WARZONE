import test from 'node:test'
import assert from 'node:assert/strict'
import { GARRISON } from '../src/game/control-config.js'
import {
  assignRelay,
  controlWire,
  createControl,
  updateControl,
} from '../src/game/control.js'
import { createWorld, distance } from '../src/game/world.js'
import { Match } from '../src/game/match.js'
import { moveState } from '../src/game/movement.js'

const tick = 1 / 30
const create = () => createControl(createWorld('yard', 173))
const at = (r, team, extra = {}) => ({
  id: `${team}-${r.id}`,
  team,
  alive: true,
  air: 'ground',
  grounded: true,
  x: r.x,
  y: r.y,
  z: r.z,
  ...extra,
})
function advance(state, players, seconds, events = [], offset = 0) {
  let winner
  for (let i = 0; i < Math.ceil(seconds / tick); i++) {
    winner = updateControl(
      state,
      players,
      offset + (i + 1) * tick,
      tick,
      (type, e) => events.push([type, e]),
    )
    if (winner !== undefined) break
  }
  return winner
}

test('Garrison spawns both teams in different lanes and exposes three stable playable relays', () => {
  const a = new Match({ mode: 'garrison', seed: 134, bots: 5 })
  const b = new Match({ mode: 'garrison', seed: 134, bots: 5 })
  assert.deepEqual(a.control.relays, b.control.relays)
  assert.deepEqual(
    a.control.relays.map((r) => r.id),
    ['A', 'B', 'C'],
  )
  assert.deepEqual(
    [...a.players.values()].map((x) => x.team),
    [0, 1, 0, 1, 0, 1],
  )
  for (const p of a.players.values())
    assert.ok(p.team === 0 ? p.x < -18 : p.x > 18, 'home spawns stay split')
  for (const r of a.control.relays) {
    const near = [...a.world.grid.nearby(r.x, r.z, r.radius)]
    assert.ok(
      near.every(
        (b) =>
          !(
            Math.abs(r.x - b.x) < b.w / 2 + 1 &&
            Math.abs(r.z - b.z) < b.d / 2 + 1 &&
            r.y < b.y + b.h - 0.2 &&
            r.y + 1.4 > b.y
          ),
      ),
    )
  }
  assert.equal(a.sharedWire().control.relays.length, 3)
})

test('one grounded operator claims only after a full capture interval and the team scores on ticks', () => {
  const state = create()
  const [r, second] = state.relays
  const ally = at(r, 0),
    options = []
  advance(state, [ally], 3.5, options)
  assert.equal(r.owner, null)
  assert.equal(r.claim, 0)
  assert.ok(r.progress > 0.82)
  advance(state, [ally], 0.55, options, 3.5)
  assert.equal(r.owner, 0)
  assert.equal(r.progress, 0)
  assert.equal(second.owner, null)
  assert.equal(ally.captures, 1)
  assert.equal(ally.objective, 75)
  assert.equal(options.filter((e) => e[0] === 'relayCaptured').length, 1)
  advance(state, [ally], 4, options, 4.05)
  assert.ok(state.points[0] >= 2)
  assert.equal(state.points[1], 0)
  assert.ok(ally.objective > 75)
})

test('a contest freezes progress and denies points even when the zone already belongs to one team', () => {
  const state = create()
  const r = state.relays[1]
  const one = at(r, 0),
    two = at(r, 1)
  r.owner = 0
  advance(state, [two], 0.91)
  const before = r.progress
  assert.ok(before > 0.2)
  advance(state, [one, two], 6)
  assert.ok(r.contested)
  assert.equal(r.progress, before)
  assert.equal(state.points[0], 0)
  assert.equal(r.owner, 0)
  advance(state, [two], 3.6)
  assert.equal(r.owner, 1)
  assert.equal(two.captures, 1)
})

test('downed, eliminated, parachuting, and airborne-above operators cannot take a relay', () => {
  const state = create()
  const r = state.relays[0]
  const actors = [
    at(r, 0, { id: 'downed', downed: true }),
    at(r, 0, { id: 'out', alive: false }),
    at(r, 0, { id: 'chute', air: 'chute' }),
    at(r, 0, { id: 'roof', y: r.y + 4.2 }),
  ]
  advance(state, actors, 14)
  assert.deepEqual(r.occupying, [0, 0])
  assert.equal(r.owner, null)
  assert.equal(r.progress, 0)
})

test('an unfinished claim decays when vacated, faster while defenders are present', () => {
  const state = create()
  const r = state.relays[1]
  const attacker = at(r, 1),
    defender = at(r, 0)
  r.owner = 0
  advance(state, [attacker], 2)
  assert.ok(r.progress > 0.45)
  advance(state, [], 1)
  const evacuated = r.progress
  assert.ok(evacuated < 0.32 && evacuated > 0)
  advance(state, [defender], 0.62)
  assert.equal(r.progress, 0)
  assert.equal(r.claim, null)
  assert.equal(r.owner, 0)
})

test('ownership across three relays ends a match at the goal, not at 25 eliminations', () => {
  const m = new Match({
    mode: 'garrison',
    bots: 0,
    players: [{ id: 'one' }, { id: 'two' }],
  })
  const p = m.players.get('one'),
    q = m.players.get('two')
  const r = m.control.relays[0]
  Object.assign(p, moveState(r.x, r.y, r.z), { kills: 29 })
  q.alive = false
  m.control.points[0] = GARRISON.goal - 1
  r.owner = 0
  for (let i = 0; i < 60 && !m.result; i++) m.step(tick)
  assert.equal(m.result.team, 0)
  assert.equal(m.result.scores[0], GARRISON.goal)
  assert.ok(p.objective > 0)
})

test('close contests extend the clock once; unresolved overtime ends as a draw', () => {
  const state = create(),
    log = []
  state.points = [48, 48]
  assert.equal(
    updateControl(state, [], GARRISON.duration, tick, (type) => log.push(type)),
    undefined,
  )
  assert.equal(state.overtime, true)
  assert.equal(
    updateControl(state, [], GARRISON.duration + 10, tick, (type) =>
      log.push(type),
    ),
    undefined,
  )
  assert.deepEqual(log, ['relayOvertime'])
  assert.equal(
    updateControl(state, [], GARRISON.duration + GARRISON.overtime, tick),
    null,
  )
})

test('relay assignment prefers contested locations but spreads out when allies occupy them', () => {
  const state = create()
  const [a, b, c] = state.relays
  a.owner = 0
  b.contested = true
  c.owner = 1
  const p = at(b, 0, { index: 0 })
  assert.equal(assignRelay(state, p, []).id, 'B')
  const allies = Array.from({ length: 6 }, (_, i) =>
    at(b, 0, { id: `peer-${i}` }),
  )
  assert.notEqual(assignRelay(state, p, allies).id, 'B')
})

test('a local bot match fights over relays and produces a valid final report', () => {
  const m = new Match({ mode: 'garrison', seed: 173 })
  const end = (GARRISON.duration + GARRISON.overtime + 1) * 30
  for (let i = 0; i < end && !m.result; i++) m.step(tick)
  const snaps = m.sharedWire()
  assert.ok(m.result)
  assert.ok(Object.values(m.result.scores).some((s) => s > 50))
  assert.ok(snaps.players.some((p) => p[24] > 0))
  const wire = controlWire(m.control)
  const relay = wire.relays[0]
  assert.equal(relay.progress, Math.round(relay.progress * 100) / 100)
  const layout = create().relays
  assert.ok(distance(layout[0], layout[1]) > 18)
})
