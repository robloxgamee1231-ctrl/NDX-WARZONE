import { cancelPlating } from './armor.js'
import { eyeHeight } from './movement.js'
import { distance, rayWorld } from './world.js'

export const RESCUE = Object.freeze({
  range: 2.65,
  allySeconds: 3.25,
  selfSeconds: 5.4,
  bleedSeconds: 24,
  bleedHealth: 44,
  recovery: 38,
})

export function rescueState() {
  return {
    downed: false,
    bleedUntil: 0,
    bleedHealth: 0,
    downedBy: null,
    reviveProgress: 0,
    reviving: null,
    reviver: null,
    selfRevive: false,
    mask: 0,
  }
}

export function canFallDown(match, p, cause) {
  if (
    p.downed ||
    match.mode.id !== 'battle-royale' ||
    cause !== 'fire' ||
    p.air !== 'ground'
  )
    return false
  if (p.selfRevive) return true
  return (
    match.teamSize > 1 &&
    [...match.players.values()].some(
      (q) =>
        q.alive &&
        !q.downed &&
        q.air === 'ground' &&
        q.team === p.team &&
        q.id !== p.id,
    )
  )
}

export function knockDown(p, time, attacker) {
  p.downed = true
  p.health = RESCUE.bleedHealth
  p.bleedHealth = RESCUE.bleedHealth
  p.bleedUntil = time + RESCUE.bleedSeconds
  p.downedBy = attacker?.id ?? null
  p.reviveProgress = 0
  p.reviver = p.reviving = null
  p.shopId = null
  p.reloadStart = p.reloadEnd = 0
  p.vx = p.vz = p.slide = p.tactical = 0
  p.sprinting = p.aim = p.climbing = false
  p.mantle = null
  cancelPlating(p)
}

export function rescueTarget(players, p, world) {
  if (
    !p?.alive ||
    p.downed ||
    p.air !== 'ground' ||
    !p.grounded ||
    p.mantle ||
    p.climbing
  )
    return null
  let closest = RESCUE.range,
    result = null
  for (const q of players) {
    if (
      q.id === p.id ||
      q.team !== p.team ||
      !q.alive ||
      !q.downed ||
      Math.abs(p.y - q.y) > 1.12
    )
      continue
    const d = distance(p, q)
    if (d > closest) continue
    const eye = { x: p.x, y: p.y + eyeHeight(p) * 0.7, z: p.z }
    const vx = q.x - eye.x,
      vy = q.y + 0.52 - eye.y,
      vz = q.z - eye.z
    const len = Math.hypot(vx, vy, vz)
    if (
      len > 0.18 &&
      rayWorld(world, eye, { x: vx / len, y: vy / len, z: vz / len }, len) <
        len - 0.24
    )
      continue
    result = q
    closest = d
  }
  return result
}

function revive(p, helper) {
  p.downed = false
  p.health = RESCUE.recovery
  p.bleedUntil = p.bleedHealth = p.reviveProgress = 0
  p.reviver = p.downedBy = null
  p.lastAttacker = null
  p.recentHits = {}
  p.plateBlocked = true
  if (p === helper) p.selfRevive = false
  else helper.revives++
  helper.reviving = null
}

/** One channel per victim, advanced after all operators have moved this tick. */
export function updateRescues(match, intents, dt) {
  const { time, players, world } = match
  const channels = new Map()
  for (const p of players.values()) p.reviving = null
  for (const [id, input] of intents) {
    const p = players.get(id)
    if (
      !p?.alive ||
      p.downed ||
      !input.revive ||
      input.sprint ||
      Math.hypot(p.vx, p.vz) > 1.15 ||
      time - p.lastDamage < 0.46
    )
      continue
    const q = rescueTarget(players.values(), p, world)
    if (q && (!channels.has(q.id) || q.reviver === p.id)) channels.set(q.id, p)
  }
  // Freeze the set of viable squadmates for this tick. A simultaneous wipe
  // cannot yield different rescues based on insertion order in the roster.
  const activeTeams = new Set(
    [...players.values()]
      .filter((p) => p.alive && !p.downed)
      .map((p) => p.team),
  )
  for (const p of players.values()) {
    if (!p.alive || !p.downed) continue
    const input = intents.get(p.id)
    const helper =
      channels.get(p.id) ??
      (p.grounded &&
      p.selfRevive &&
      input?.revive &&
      Math.hypot(p.vx, p.vz) < 0.85
        ? p
        : null)
    if (time >= p.bleedUntil || (!activeTeams.has(p.team) && !p.selfRevive)) {
      const enemy = players.get(p.downedBy)
      match.eliminate(p, enemy, 'bleedout')
      continue
    }
    if (!helper?.alive || time - p.lastDamage < 0.52) {
      p.reviver = null
      p.reviveProgress = 0
      continue
    }
    if (p.reviver !== helper.id) p.reviveProgress = 0
    p.reviver = helper.id
    helper.reviving = p.id
    p.reviveProgress +=
      dt / (p === helper ? RESCUE.selfSeconds : RESCUE.allySeconds)
    if (p.reviveProgress + 1e-7 >= 1) {
      revive(p, helper)
      match.event('rescued', {
        actor: helper.id,
        target: p.id,
        team: p.team,
        name: p.name,
        self: p === helper,
      })
      match.notice(
        p,
        p === helper ? 'Self-revive used' : `${helper.name} revived you`,
        'green',
      )
    }
  }
}

export function botRescueTarget(match, p, living) {
  if (!match.mode.gas || p.downed) return null
  let choice = null,
    best = 29
  for (const q of living) {
    if (q.id === p.id || q.team !== p.team || !q.downed) continue
    const d = distance(p, q)
    if (d >= best || (match.gas && distance(q, match.gas) > match.gas.r + 6))
      continue
    choice = q
    best = d
  }
  return choice
}
