import { HEALTH_MAX } from '../config.js'
import { TACTICALS } from './loadout.js'
import { aimVector, eyeHeight, forward } from './movement.js'
import { clamp, distance, rayWorld } from './world.js'

export const MASK_CAPACITY = 35
export const FIELD_DURATION = 12
export const FIELD_RADIUS = 7.2
export const PULSE_DURATION = 8
export const PULSE_RADIUS = 43
export const PING_SECONDS = 42
const REPEATED = 3.1
const PING_KIND = new Set(['move', 'danger'])
const round = (n) => Math.round(n * 10) / 10

export function reduceGas(p, amount) {
  const blocked = Math.min(p.mask || 0, amount)
  p.mask = Math.max(0, (p.mask || 0) - blocked)
  return amount - blocked
}

export function useTactical(match, p) {
  if (
    !p?.alive ||
    p.downed ||
    !p.grounded ||
    p.air !== 'ground' ||
    p.mantle ||
    p.climbing ||
    p.plateActive ||
    p.tacticalCharges < 1 ||
    p.gearReady > match.time
  )
    return false
  const type = p.tacticalType
  if (type === 'stim' && p.health >= HEALTH_MAX && p.tacCooldown <= 0.04)
    return false
  p.tacticalCharges--
  p.gearReady = match.time + (type === 'stim' ? 0.82 : 1.4)
  if (type === 'stim') {
    p.health = Math.min(HEALTH_MAX, p.health + 38)
    p.tacCooldown = 0
  } else if (type === 'smoke') {
    const f = forward(p.yaw)
    const from = { x: p.x, y: p.y + eyeHeight(p), z: p.z }
    const d = Math.max(
      0.9,
      rayWorld(match.world, from, { ...f, y: 0 }, 13) - 0.65,
    )
    const x = round(clamp(p.x + f.x * d, -match.world.half, match.world.half))
    const z = round(clamp(p.z + f.z * d, -match.world.half, match.world.half))
    const y = Math.max(p.y - 1.1, match.world.height(x, z))
    if (match.fields.length >= 24) match.fields.shift()
    match.fields.push({
      id: `smoke-${++match.fieldIndex}`,
      x,
      y,
      z,
      r: FIELD_RADIUS,
      starts: match.time + 0.35,
      until: match.time + FIELD_DURATION,
    })
  } else if (type === 'pulse') {
    const observations = match.contacts.get(p.team) ?? new Map()
    for (const q of match.players.values()) {
      if (
        !q.alive ||
        q.team === p.team ||
        q.air !== 'ground' ||
        distance(p, q) > PULSE_RADIUS
      )
        continue
      observations.set(q.id, match.time + PULSE_DURATION)
    }
    match.contacts.set(p.team, observations)
    match.event('pulse', {
      actor: p.id,
      team: p.team,
      x: round(p.x),
      z: round(p.z),
      contacts: observations.size,
    })
  }
  match.event('tactical', { actor: p.id, item: type })
  return true
}

export function restockTactical(p) {
  const max = TACTICALS[p.tacticalType]?.count ?? 0
  if (p.tacticalCharges >= max) return false
  p.tacticalCharges = max
  return true
}

export function activeField(field, time) {
  return field.starts <= time && field.until > time
}

export function insideSmoke(fields, time, point) {
  return fields.some(
    (f) =>
      activeField(f, time) &&
      Math.abs((point.y ?? f.y) - f.y) < 4.1 &&
      distance(point, f) <= f.r,
  )
}

export function obscured(fields, time, origin, target) {
  const dx = target.x - origin.x,
    dz = target.z - origin.z
  const len = dx * dx + dz * dz
  if (len < 6.25) return false
  return fields.some((field) => {
    if (!activeField(field, time)) return false
    const t = clamp(
      ((field.x - origin.x) * dx + (field.z - origin.z) * dz) / len,
      0,
      1,
    )
    if (Math.abs(origin.y + (target.y - origin.y) * t - field.y) > 4.1)
      return false
    return (
      Math.hypot(origin.x + dx * t - field.x, origin.z + dz * t - field.z) <
      field.r
    )
  })
}

export function trimTactics(match) {
  match.fields = match.fields.filter((f) => f.until > match.time)
  for (const [id, ping] of match.pings)
    if (ping.until <= match.time || !match.players.has(id))
      match.pings.delete(id)
  for (const [team, entries] of match.contacts) {
    for (const [id, until] of entries)
      if (until <= match.time || !match.players.get(id)?.alive)
        entries.delete(id)
    if (entries.size === 0) match.contacts.delete(team)
  }
}

function lookedPoint(p, world) {
  const origin = { x: p.x, y: p.y + eyeHeight(p), z: p.z }
  const v = aimVector(p.yaw, p.pitch)
  const max = p.air === 'ground' ? 138 : 360
  const length = rayWorld(world, origin, v, max)
  const x = clamp(origin.x + v.x * length, -world.half, world.half)
  const z = clamp(origin.z + v.z * length, -world.half, world.half)
  return {
    x,
    z,
    y:
      length < max - 0.1
        ? Math.max(world.height(x, z), origin.y + v.y * length)
        : world.height(x, z),
  }
}

/** Waypoints carry only a whitelisted kind and finite, in-bounds coordinates. */
export function setSquadPing(match, p, raw) {
  if (!p?.alive || match.result || typeof raw !== 'object' || !raw) return false
  const existing = match.pings.get(p.id)
  if (
    raw.kind === 'clear' ||
    (raw.kind === 'look' &&
      existing &&
      match.time - existing.time >= 0.25 &&
      match.time - existing.time < REPEATED)
  ) {
    if (!existing) return false
    match.pings.delete(p.id)
    p.pingReady = match.time + 0.26
    match.event('pingClear', { actor: p.id, team: p.team })
    return true
  }
  if (p.pingReady > match.time) return false
  const world = match.world
  let point, kind
  if (raw.kind === 'look') {
    if (p.air === 'plane') return false
    point = lookedPoint(p, world)
    kind = 'move'
  } else if (PING_KIND.has(raw.kind)) {
    if (
      !Number.isFinite(raw.x) ||
      !Number.isFinite(raw.z) ||
      Math.abs(raw.x) > world.half ||
      Math.abs(raw.z) > world.half
    )
      return false
    point = { x: raw.x, z: raw.z, y: world.height(raw.x, raw.z) }
    kind = raw.kind
  } else return false
  const waypoint = {
    id: p.id,
    name: p.name,
    team: p.team,
    kind,
    x: round(point.x),
    z: round(point.z),
    y: round(point.y),
    time: match.time,
    until: match.time + PING_SECONDS,
  }
  match.pings.set(p.id, waypoint)
  p.pingReady = match.time + 0.7
  match.event('ping', { actor: p.id, team: p.team, name: p.name, kind })
  return true
}

export function tacticalWire(match, p) {
  return {
    pings: [...match.pings.values()].filter((mark) => mark.team === p.team),
    contacts: [...(match.contacts.get(p.team)?.keys() ?? [])],
  }
}
