import assert from 'node:assert/strict'
import test from 'node:test'
import { Match } from '../src/game/match.js'
import { createWorld } from '../src/game/world.js'

function setup(task) {
  const match = new Match({ teamSize: 2, bots: 4 })
  const p = match.players.get('local')
  const item = [...match.loot.values()].find((i) => i.task === task)
  Object.assign(p, { x: item.x, y: item.y, z: item.z, air: 'ground' })
  match.interact(p)
  assert.equal(p.contract?.task, task)
  assert.equal(item.removed, true)
  return { match, p, item }
}
for (const map of ['ridge', 'floodline'])
  test(`${map} deploys the four mission types`, () => {
    const tasks = new Set(
      createWorld(map, 173)
        .pickups.filter((i) => i.type === 'contract')
        .map((i) => i.task),
    )
    assert.deepEqual(
      tasks,
      new Set(['recon', 'scavenge', 'bounty', 'recovery']),
    )
  })
test('bounty on an enemy pays the living squad once on a teammate elimination', () => {
  const { match, p } = setup('bounty')
  const ally = match.players.get('bot1'),
    target = match.players.get(p.contract.target)
  assert.notEqual(target.team, p.team)
  const balance = p.cash
  match.eliminate(target, ally)
  match.eliminate(target, ally)
  assert.equal(p.cash, balance + 3200)
  assert.equal(p.contract, null)
  assert.equal(ally.contracts, 1)
})
for (const reason of ['expired', 'poached', 'disconnected'])
  test(`no bounty payment when ${reason}`, () => {
    const { match, p } = setup('bounty'),
      target = match.players.get(p.contract.target),
      balance = p.cash
    if (reason === 'disconnected') match.removePlayer(target.id)
    else if (reason === 'expired') {
      match.time = p.contract.end
      match.eliminate(target, match.players.get('bot1'))
    } else match.eliminate(target, null, 'gas')
    match.updateContract(p, 1 / 30)
    assert.equal(p.contract, null)
    assert.equal(p.cash, balance)
    assert.equal(p.contracts, 0)
  })
test('recovery requires the assigned cache and a grounded, same-level return', () => {
  const { match, p, item } = setup('recovery'),
    c = p.contract,
    cache = match.loot.get(c.cache)
  match.updateContract(p, 1 / 30)
  assert.equal(c.progress, 0)
  Object.assign(p, { x: cache.x, y: cache.y, z: cache.z })
  match.interact(p)
  assert.equal(c.progress, 1)
  assert.equal(c.x, item.x)
  Object.assign(p, { x: item.x, z: item.z, y: item.y + 8 })
  match.updateContract(p, 1 / 30)
  assert.equal(c.progress, 1)
  Object.assign(p, { y: item.y, air: 'chute' })
  match.updateContract(p, 1 / 30)
  assert.equal(c.progress, 1)
  p.air = 'ground'
  const balance = p.cash
  match.updateContract(p, 1 / 30)
  assert.equal(p.contract, null)
  assert.equal(p.cash, balance + 2600)
})
test('intercepted recovery cache clears the marker instead of leaving a dead objective', () => {
  const { match, p } = setup('recovery'),
    cache = match.loot.get(p.contract.cache)
  const rival = match.players.get('bot3')
  Object.assign(rival, { x: cache.x, y: cache.y, z: cache.z, air: 'ground' })
  match.interact(rival)
  assert.equal(cache.opened, true)
  match.updateContract(p, 1 / 30)
  assert.equal(p.contract, null)
  assert.equal(p.contracts, 0)
})
