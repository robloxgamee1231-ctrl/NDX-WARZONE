import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARMOR_MAX,
  BASE_RESERVE,
  PLATE_SECONDS,
  SATCHEL_RESERVE,
} from '../src/config.js'
import {
  addPlates,
  armorState,
  damageVitals,
  equipSatchel,
  updatePlating,
} from '../src/game/armor.js'
import { Match } from '../src/game/match.js'

const dt = 1 / 30
function putAt(match, p, item, behind = 0.73) {
  Object.assign(p, {
    x: item.x,
    y: match.world.height(item.x, item.z + behind),
    z: item.z + behind,
    yaw: 0,
    pitch: 0,
    air: 'ground',
    stance: 'idle',
    grounded: true,
    vx: 0,
    vy: 0,
    vz: 0,
  })
}

test('holding inserts 50 points per plate, fills exactly three slots, and tracks reserves', () => {
  const p = { ...armorState(0, 5), health: 100 }
  const inserts = []
  for (let i = 0; i < 110; i++)
    updatePlating(p, true, true, dt, (event) => {
      if (event === 'plateInsert') inserts.push(p.armor)
    })
  assert.deepEqual(inserts, [50, 100, 150])
  assert.equal(p.armor, ARMOR_MAX)
  assert.equal(p.plates, 2)
  assert.equal(p.health, 100)
  assert.equal(p.plateActive, false)
  assert.equal(p.plateProgress, 0)
})

test('a partial armor slot caps at 150; release cancels without consuming the plate', () => {
  const p = { ...armorState(139, 2), health: 100 }
  updatePlating(p, true, true, 0.57)
  assert.equal(p.armor, 139)
  assert.equal(p.plates, 2)
  assert.ok(p.plateActive)
  updatePlating(p, false, true, dt)
  assert.equal(p.plateProgress, 0)
  assert.equal(p.plates, 2)
  updatePlating(p, true, true, PLATE_SECONDS)
  assert.equal(p.armor, 150)
  assert.equal(p.plates, 1)
})

test('damage interrupts insertion, blocks the held button until release, and breaks armor before health', () => {
  const p = { ...armorState(37, 2), health: 100 }
  updatePlating(p, true, true, 0.98)
  assert.deepEqual(damageVitals(p, 53), {
    absorbed: 37,
    broken: true,
    interrupted: true,
  })
  assert.equal(p.armor, 0)
  assert.equal(p.health, 84)
  assert.equal(p.plates, 2)
  assert.equal(p.plateProgress, 0)
  updatePlating(p, true, true, PLATE_SECONDS + 1)
  assert.equal(p.armor, 0)
  updatePlating(p, false, true, dt)
  updatePlating(p, true, true, PLATE_SECONDS)
  assert.equal(p.armor, 50)
  assert.equal(p.plates, 1)
  assert.deepEqual(damageVitals(p, 10, true), {
    absorbed: 0,
    broken: false,
    interrupted: false,
  })
  assert.equal(p.health, 74)
  assert.equal(p.armor, 50)
})

test('supply crates spill collectable plates, loose stacks respect capacity, and satchels expand it', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  const plate = [...m.loot.values()].find((i) => i.type === 'plate')
  const crate = [...m.loot.values()].find((i) => i.type === 'crate' && i.z > 0)
  const satchel = [...m.loot.values()].find((i) => i.type === 'satchel')
  putAt(m, p, plate)
  m.interact(p)
  assert.equal(p.plates, BASE_RESERVE)
  assert.equal(plate.removed, true)
  putAt(m, p, crate)
  m.interact(p)
  assert.equal(crate.opened, true)
  const dropped = [...m.loot.values()].filter((i) => i.id.startsWith('d'))
  assert.ok(dropped.some((i) => i.type === 'plate' && i.amount >= 1))
  assert.ok(dropped.some((i) => i.type === 'cash'))
  assert.equal(addPlates(p, 11), 0)
  putAt(m, p, satchel)
  m.interact(p)
  assert.equal(p.satchel, true)
  assert.equal(p.capacity, SATCHEL_RESERVE)
  assert.equal(equipSatchel(p), false)
  assert.equal(addPlates(p, 11), 3)
  assert.equal(p.plates, 8)
})

test('armor boxes are collectible equipment and can refill each squad member only once', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  const item = [...m.loot.values()].find((i) => i.type === 'box')
  putAt(m, p, item)
  m.interact(p)
  assert.equal(p.armorBox, true)
  assert.equal(item.removed, true)
  m.deployBox(p)
  assert.equal(p.armorBox, false)
  const box = [...m.loot.values()].find((i) => i.type === 'refill')
  assert.ok(box)
  assert.equal(box.team, p.team)
  assert.equal(box.usedBy.length, 0)
  putAt(m, p, box, 0.3)
  p.plates = 0
  assert.equal(m.nearbyLoot(p)?.id, box.id)
  m.interact(p)
  assert.equal(p.plates, BASE_RESERVE)
  assert.deepEqual(box.usedBy, [p.id])
  p.plates = 0
  assert.notEqual(m.nearbyLoot(p)?.id, box.id)
  const ally = m.addPlayer({ id: 'ally' })
  ally.team = p.team
  ally.plates = 1
  putAt(m, ally, box, 0.32)
  m.interact(ally)
  assert.equal(ally.plates, BASE_RESERVE)
  assert.deepEqual(box.usedBy, [p.id, ally.id])
  const enemy = m.addPlayer({ id: 'enemy' })
  putAt(m, enemy, box, 0.3)
  assert.notEqual(m.nearbyLoot(enemy)?.id, box.id)
})

test('buy stations reject out-of-range purchases and charge only successful transactions', () => {
  const m = new Match({ mode: 'training-range' }),
    p = m.players.get('local')
  const station = [...m.loot.values()].find((i) => i.type === 'station')
  p.cash = 2900
  assert.equal(m.purchase(p.id, 'satchel'), false)
  assert.equal(p.cash, 2900)
  putAt(m, p, station)
  m.interact(p)
  assert.equal(p.shopId, station.id)
  assert.ok(m.events.some((e) => e.type === 'shop' && e.actor === p.id))
  assert.equal(m.purchase(p.id, 'satchel'), true)
  assert.equal(p.capacity, 8)
  assert.equal(p.cash, 1100)
  assert.equal(m.purchase(p.id, 'satchel'), false)
  assert.equal(p.cash, 1100)
  assert.equal(m.purchase(p.id, 'plate'), true)
  assert.equal(p.plates, 5)
  assert.equal(p.cash, 600)
  p.x += 11
  assert.equal(m.purchase(p.id, 'plate'), false)
  assert.equal(p.plates, 5)
  assert.equal(p.cash, 600)
})
