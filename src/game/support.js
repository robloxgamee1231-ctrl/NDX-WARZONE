import { HEALTH_MAX, WEAPONS } from '../config.js'
import { equippedSpec } from './loadout.js'
import { eyeHeight, forward } from './movement.js'
import { restockTactical } from './tactics.js'
import { distance, rayWorld } from './world.js'

// Support crew are civilians, not match seats or hit targets. Their positions
// are public and seeded with the battlefield, so no separate position stream is needed.
export const SERVICES = Object.freeze({
  coach: Object.freeze({
    title: 'Range Coach',
    action: 'Talk to Coach Vale',
    detail: 'OPEN THE RANGE DRILL BOARD',
    icon: 'reticle',
    tint: '#87e5ee',
    operator: 'warden',
    flag: 0,
  }),
  supply: Object.freeze({
    title: 'Quartermaster',
    action: 'Request an ammo refill',
    detail: 'RESERVE AMMO + GEAR · ONCE PER MATCH',
    icon: 'box',
    tint: '#e6b77d',
    operator: 'tidewatch',
    flag: 1,
  }),
  medic: Object.freeze({
    title: 'Field Medic',
    action: 'Request field aid',
    detail: 'RESTORE UP TO 42 HEALTH · ONCE PER MATCH',
    icon: 'person',
    tint: '#a6e6a4',
    operator: 'alpine',
    flag: 2,
  }),
})
const STAFF = {
  ridge: [
    ['supply', 'Supply Officer Rune', -23, 9, Math.PI],
    ['medic', 'Medic Iona', 34, -184, 0],
  ],
  floodline: [
    ['supply', 'Supply Officer Rune', 109, -91, 0],
    ['medic', 'Medic Iona', -110, 188, 0],
    ['supply', 'Supply Officer Flint', 76, -211, 0],
  ],
  yard: [
    ['supply', 'Supply Officer Rune', -38, -18, Math.PI * 0.5],
    ['supply', 'Supply Officer Flint', 38, 18, -Math.PI * 0.5],
  ],
  'relay-works': [
    ['supply', 'Supply Officer Rune', -35, 19, -Math.PI * 0.5],
    ['supply', 'Supply Officer Flint', 35, -19, Math.PI * 0.5],
    ['medic', 'Medic Iona', -2.5, 30, 0],
  ],
  range: [
    ['coach', 'Coach Vale', -0.95, 10.25, Math.PI],
    ['supply', 'Supply Officer Rune', 9.7, 13.8, -Math.PI * 0.5],
  ],
}

export function createStaff(world) {
  const staff = []
  for (const [index, [kind, name, x, z, yaw]] of (
    STAFF[world.map.id] ?? []
  ).entries()) {
    const base = { x, z }
    // Allow a small tidy relocation if a seeded prop occupies the booth.
    for (let i = 0; i < 16; i++) {
      const offset = i * 0.39,
        px = base.x + Math.cos(i * 2.39996) * offset,
        pz = base.z + Math.sin(i * 2.39996) * offset
      const y = world.height(px, pz)
      const blocked = [...world.grid.nearby(px, pz, 1.3)].some(
        (b) =>
          b.y < y + 1.8 &&
          b.y + b.h > y + 0.15 &&
          Math.abs(b.x - px) < b.w * 0.5 + 1.18 &&
          Math.abs(b.z - pz) < b.d * 0.5 + 1.18,
      )
      if (!blocked) {
        staff.push(
          Object.freeze({
            id: `crew-${index}`,
            kind,
            name,
            x: px,
            y,
            z: pz,
            yaw,
          }),
        )
        break
      }
    }
  }
  return Object.freeze(staff)
}

export function canSeeStaff(world, player, npc) {
  const o = { x: player.x, y: player.y + eyeHeight(player) * 0.92, z: player.z }
  const dx = npc.x - o.x,
    dy = npc.y + 1.3 - o.y,
    dz = npc.z - o.z,
    d = Math.hypot(dx, dy, dz)
  return (
    d < 0.004 ||
    rayWorld(world, o, { x: dx / d, y: dy / d, z: dz / d }, d) > d - 0.29
  )
}

export function nearestStaff(world, p, item = null) {
  if (
    !p?.alive ||
    p.bot ||
    p.downed ||
    p.air !== 'ground' ||
    p.mantle ||
    p.climbing ||
    !p.grounded
  )
    return null
  const f = forward(p.yaw)
  let best = item ? distance(item, p) - 0.3 : 3.18
  let handle = null
  for (const npc of world.staff ?? []) {
    const dx = npc.x - p.x,
      dz = npc.z - p.z,
      d = Math.hypot(dx, dz)
    if (
      d >= best ||
      Math.abs(npc.y - p.y) > 1.25 ||
      p.services & SERVICES[npc.kind].flag
    )
      continue
    if (d > 1.22 && (dx * f.x + dz * f.z) / d < 0.26) continue
    if (!canSeeStaff(world, p, npc)) continue
    best = d
    handle = npc
  }
  return handle
}

function refill(p) {
  const current = equippedSpec(p)
  let supplied = p.stock < current.stock
  if (supplied) p.stock = current.stock
  for (const [i, gun] of (p.kit ?? []).entries()) {
    if (i === p.slot) continue
    const other = WEAPONS[gun.id]
    if (other && gun.stock < other.stock) {
      supplied = true
      gun.stock = other.stock
    }
  }
  return restockTactical(p) || supplied
}

export function talkToStaff(match, p, item = null) {
  if (match.result || match.time < (p?.serviceReady ?? 0)) return false
  const npc = nearestStaff(match.world, p, item)
  if (
    !npc ||
    (npc.kind === 'coach' &&
      ['active', 'countdown'].includes(match.training?.state))
  )
    return false
  p.serviceReady = match.time + 0.85
  const desk = SERVICES[npc.kind]
  if (npc.kind === 'supply') {
    if (!refill(p)) {
      match.notice(p, `${npc.name} · Your reserves are already full.`, 'info')
      return false
    }
    match.notice(p, `${npc.name} · Ammo and gear replenished.`, 'green')
  } else if (npc.kind === 'medic') {
    if (p.health >= HEALTH_MAX || match.time - p.lastDamage < 1.9) {
      const message =
        p.health >= HEALTH_MAX
          ? 'Your health is already full.'
          : 'Take cover before requesting treatment.'
      match.notice(p, `${npc.name} · ${message}`, 'info')
      return false
    }
    const heal = Math.min(42, HEALTH_MAX - p.health)
    p.health += heal
    match.notice(p, `${npc.name} · +${Math.round(heal)} health.`, 'green')
  } else
    match.notice(
      p,
      'Coach Vale · Pick an exercise or start in the live-fire lane.',
      'info',
    )
  p.services |= desk.flag
  match.event('staff', { actor: p.id, service: npc.kind, handle: npc.id })
  return true
}
