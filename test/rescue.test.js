import test from 'node:test'
import assert from 'node:assert/strict'
import { Match } from '../src/game/match.js'
import { moveState } from '../src/game/movement.js'
import { RESCUE, rescueTarget } from '../src/game/squad.js'
import { readActor } from '../src/game/wire.js'

const dt = 1 / 30
function scene() {
  const match = new Match({
    mode: 'battle-royale',
    seed: 173,
    bots: 0,
    teamSize: 2,
    players: [
      { id: 'first' },
      { id: 'second' },
      { id: 'hostile' },
      { id: 'foe-ally' },
    ],
  })
  const [first, second, hostile, enemyFriend] = match.players.values()
  for (const [p, x, z] of [
    [first, 19, 44],
    [second, 19, 45.3],
    [hostile, 37, 46],
    [enemyFriend, 44, 61],
  ])
    Object.assign(p, moveState(x, match.world.height(x, z), z))
  return { match, first, second, hostile, enemyFriend }
}

function time(match, seconds, input) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    if (input)
      for (const [id, payload] of Object.entries(input))
        match.command(id, payload)
    match.step(dt)
  }
}

test('BR takedowns preserve a temporary crawl state, do not count an elimination, and disable shooting', () => {
  const { match, first, hostile } = scene()
  const status = match.damage(first, 190, hostile)
  assert.ok(status.downed && first.downed && first.alive)
  assert.equal(first.bleedUntil, match.time + RESCUE.bleedSeconds)
  assert.equal(first.health, RESCUE.bleedHealth)
  assert.equal(hostile.kills, 0)
  const start = first.z
  time(match, 0.8, {
    first: {
      z: 1,
      fire: true,
      sprint: true,
      plate: true,
      tactical: true,
      jump: true,
    },
  })
  assert.ok(first.z < start - 0.5 && first.z > start - 1.45)
  assert.equal(first.stance, 'downed')
  assert.equal(first.shots, 0)
  assert.equal(first.plateActive, false)
  const snapshot = match.sharedWire().players.find((p) => p[0] === first.id)
  assert.ok(readActor(snapshot).downed)
})

test('revive needs a continuous hold; releasing early cancels the channel', () => {
  const { match, first, second, hostile } = scene()
  match.damage(first, 500, hostile)
  assert.equal(rescueTarget(match.players.values(), second, match.world), first)
  time(match, 1.6, { second: { revive: true } })
  assert.ok(first.reviveProgress > 0.25 && first.reviveProgress < 0.6)
  assert.equal(second.reviving, first.id)
  time(match, 0.1, { second: {} })
  assert.equal(first.reviveProgress, 0)
  assert.equal(second.reviving, null)
  time(match, RESCUE.allySeconds + 0.2, { second: { revive: true } })
  assert.equal(first.downed, false)
  assert.equal(first.health, RESCUE.recovery)
  assert.equal(first.armor, 0)
  assert.equal(second.revives, 1)
  assert.ok(
    match.events.some((e) => e.type === 'rescued' && e.target === first.id),
  )
})

test('the revive channel breaks if either operator takes damage and an enemy cannot steal a rescue', () => {
  const { match, first, second, hostile } = scene()
  match.damage(first, 500, hostile)
  time(match, 1, { second: { revive: true } })
  assert.ok(first.reviveProgress > 0.1)
  match.damage(second, 1, hostile)
  time(match, 0.21, { second: { revive: true } })
  assert.equal(first.reviveProgress, 0)
  time(match, 1, { second: { revive: true } })
  assert.ok(first.reviveProgress > 0.1)
  match.damage(first, 9, hostile)
  time(match, 0.24, { second: { revive: true } })
  assert.equal(first.reviveProgress, 0)
  Object.assign(hostile, moveState(first.x, first.y, first.z + 0.95))
  assert.equal(rescueTarget(match.players.values(), hostile, match.world), null)
})

test('simultaneous squad wipe finalizes downed members and awards the original attacker once', () => {
  const { match, first, second, hostile } = scene()
  match.damage(first, 500, hostile)
  match.damage(second, 500, hostile)
  assert.equal(second.alive, false)
  assert.equal(first.downed, true)
  match.step(dt)
  assert.equal(first.alive, false)
  assert.equal(hostile.kills, 2)
  assert.equal(first.deaths, 1)
  match.damage(first, 500, hostile)
  assert.equal(hostile.kills, 2)
})

test('a self-revive kit is consumed only on success and restores health without armor', () => {
  const m = new Match({
    mode: 'battle-royale',
    teamSize: 1,
    bots: 0,
    players: [{ id: 'a' }, { id: 'enemy' }],
  })
  const p = m.players.get('a'),
    enemy = m.players.get('enemy')
  Object.assign(p, moveState(0, m.world.height(0, 0), 0), { selfRevive: true })
  m.damage(p, 155, enemy)
  assert.equal(p.downed, true)
  time(m, 2.1, { a: { revive: true } })
  assert.ok(p.reviveProgress > 0.23 && p.selfRevive)
  time(m, 0.1, { a: {} })
  assert.ok(p.selfRevive)
  time(m, 6.4, { a: { revive: true } })
  assert.equal(p.downed, false)
  assert.equal(p.selfRevive, false)
  assert.equal(p.revives, 0)
  m.damage(p, 225, enemy)
  assert.equal(p.alive, false)
})
