import { applyPreset } from './loadout.js'
import { clamp, distance } from './world.js'

const SCHEDULE = [40, 107, 174]
const CRATE_LIFE = 76
const FALL_SECONDS = 11.7
const CRATE_SLOTS = 4
const ALTITUDE = 71

export function reinforcements() {
  return { next: 0, pending: [] }
}

function landingPoint(match, index) {
  const { gas, world } = match
  const area = gas?.nr > 1 ? { x: gas.nx, z: gas.nz, r: gas.nr } : gas
  const direction = (match.seed % 51) * 0.123 + index * 2.399963
  const radial = Math.min(area.r * 0.52, index === 0 ? 62 : 42)
  const x = area.x + Math.cos(direction) * radial
  const z = area.z + Math.sin(direction) * radial
  const point = match.safePoint(x, z)
  return { ...point, y: world.height(point.x, point.z) }
}

export function updateReinforcements(match) {
  const state = match.reinforcements
  if (!state || match.result) return
  const takeoff = SCHEDULE[state.next]
  if (takeoff !== undefined && match.time >= takeoff) {
    const point = landingPoint(match, state.next)
    const y = Math.round(point.y * 100) / 100
    const item = match.spawnLoot('supply', point.x, point.z, {
      y,
      started: match.time,
      landed: match.time + FALL_SECONDS,
      fall: ALTITUDE,
      falling: true,
      endAt: match.time + FALL_SECONDS + CRATE_LIFE,
      usedBy: [],
      count: CRATE_SLOTS,
      sequence: state.next + 1,
    })
    state.pending.push(item)
    state.next++
    match.event('resupplyIn', {
      x: item.x,
      y,
      z: item.z,
      sequence: item.sequence,
    })
  }
  const airborne = []
  for (const item of state.pending) {
    if (item.removed) continue
    if (match.time < item.landed) {
      airborne.push(item)
      continue
    }
    item.falling = false
    match.markLoot(item)
    match.event('resupplyLand', {
      x: item.x,
      y: item.y,
      z: item.z,
      sequence: item.sequence,
    })
  }
  state.pending = airborne
}

export function crateHeight(item, time) {
  const fall = clamp((item.landed - time) / FALL_SECONDS, 0, 1)
  return item.y + (item.falling ? item.fall * fall ** 1.11 : 0)
}

export function claimResupply(match, player, item) {
  if (
    !player.alive ||
    player.downed ||
    !item ||
    item.falling ||
    item.opened ||
    item.removed ||
    distance(item, player) > 2.72 ||
    Math.abs(item.y - player.y) > 1.9 ||
    item.usedBy.includes(player.id)
  )
    return false
  item.usedBy.push(player.id)
  item.count--
  if (!item.count) item.opened = true
  const oldReady = player.gearReady
  applyPreset(player)
  player.gearReady = Math.max(oldReady, match.time + 0.55)
  player.swapReady = match.time + 0.28
  match.markLoot(item)
  match.event('pickup', { actor: player.id, item: 'supply' })
  match.notice(
    player,
    'Preset restored · ammunition and tactical equipment refilled',
    'green',
  )
  return true
}
