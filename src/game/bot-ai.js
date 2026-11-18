import { assignRelay, onRelay } from './control.js'
import { equippedSpec } from './loadout.js'
import { EMPTY_INPUT, eyeHeight, forward, yawWrap } from './movement.js'
import { botRescueTarget } from './squad.js'
import { obscured } from './tactics.js'
import { drillAmmoFloor } from './training.js'
import { clamp, distance, lerp, rayWorld } from './world.js'

export const BOT_PROFILES = Object.freeze({
  rifleman: Object.freeze({
    name: 'Rifleman',
    weapon: 'raven',
    tactical: 'smoke',
    near: 13,
    far: 31,
  }),
  runner: Object.freeze({
    name: 'Runner',
    weapon: 'viper',
    tactical: 'stim',
    near: 8,
    far: 23,
  }),
  sentinel: Object.freeze({
    name: 'Sentinel',
    weapon: 'bulwark',
    tactical: 'smoke',
    near: 19,
    far: 43,
  }),
  scout: Object.freeze({
    name: 'Scout',
    weapon: 'kestrel',
    tactical: 'pulse',
    near: 25,
    far: 55,
  }),
  breacher: Object.freeze({
    name: 'Breacher',
    weapon: 'harrier',
    tactical: 'stim',
    near: 5,
    far: 14,
  }),
  point: Object.freeze({
    name: 'Point',
    weapon: 'mistral',
    tactical: 'pulse',
    near: 12,
    far: 29,
  }),
})
const roles = Object.keys(BOT_PROFILES)
export const botProfileAt = (index) => roles[index % roles.length]
const toward = (p, q) => Math.atan2(p.x - q.x, p.z - q.z)
const travel = (b) => ({ x: b.wx, z: b.wz })

export function botCanSee(match, p, enemy) {
  if (
    !enemy?.alive ||
    enemy.team === p.team ||
    enemy.air === 'plane' ||
    (enemy.air !== 'ground' && Math.abs(enemy.y - p.y) > 10)
  )
    return false
  if (match.fields.length && obscured(match.fields, match.time, p, enemy))
    return false
  const x = enemy.x - p.x,
    z = enemy.z - p.z
  const eye = { x: p.x, y: p.y + eyeHeight(p), z: p.z }
  const y = enemy.y + eyeHeight(enemy) * 0.79 - eye.y
  const length = Math.hypot(x, y, z)
  return (
    length <= 0.02 ||
    rayWorld(
      match.world,
      eye,
      { x: x / length, y: y / length, z: z / length },
      length,
    ) >
      length - 0.28
  )
}

function deploy(match, p, living, input) {
  const b = p.brain
  if (p.air === 'plane') {
    const lead = living.find((q) => q.team === p.team && !q.bot)
    input.jump = lead
      ? lead.air !== 'plane' || match.time > 16.25
      : match.time > b.drop
    if (input.jump) {
      if (lead && lead.air !== 'plane') {
        b.wx = lead.x - Math.sin(lead.yaw) * 38 + match.rand() * 22 - 11
        b.wz = lead.z - Math.cos(lead.yaw) * 38 + match.rand() * 22 - 11
      }
      input.yaw = toward(p, travel(b))
      input.pitch = -0.6
    }
  } else {
    const d = distance(p, travel(b)),
      h = p.y - match.world.height(p.x, p.z)
    input.yaw = toward(p, travel(b))
    input.pitch = -0.52
    input.z = d > 31 ? 0.74 : 0
    if (p.air === 'freefall' && p.vy < -26 && h > 48 && d > 57)
      input.jump = true
    if (p.air === 'chute' && d < 13) input.z = -0.41
  }
  return input
}

function forgetTarget(b, now) {
  if (b.target) {
    b.target = null
    b.lostAt = now
  }
}

function scan(match, p, living, rule) {
  const b = p.brain,
    now = match.time
  b.next = now + rule.scan[0] + match.rand() * rule.scan[1]
  let chosen = null,
    best = (match.gas ? 128 : 86) * rule.sight
  let noise = null,
    nearNoise = rule.hear
  for (const enemy of living) {
    if (!enemy.alive || enemy.team === p.team || enemy.air === 'plane') continue
    const range = distance(p, enemy)
    if (
      range < nearNoise &&
      now - enemy.shotAt < 0.72 &&
      Math.abs(enemy.y - p.y) < 9
    ) {
      noise = enemy
      nearNoise = range
    }
    const angle = Math.abs(yawWrap(toward(p, enemy) - p.yaw))
    const danger = p.lastAttacker === enemy.id && now - p.lastDamage < 3.4
    const penalty = angle > 1.45 && !danger ? 19 : 0
    const score =
      range +
      penalty +
      (enemy.air === 'ground' ? 0 : 45) +
      (enemy.downed ? 12 : 0) -
      (danger ? 9 : 0)
    if (
      score >= best ||
      (angle > 2.3 && !danger && range > 16) ||
      !botCanSee(match, p, enemy)
    )
      continue
    chosen = enemy
    best = score
  }
  if (chosen) {
    if (b.target !== chosen.id)
      b.aimLock = now + rule.reaction[0] + match.rand() * rule.reaction[1]
    b.target = chosen.id
    b.last = { x: chosen.x, z: chosen.z, until: now + rule.memory }
    b.missX = (match.rand() + match.rand() - 1) * 0.091 * rule.aim
    b.missY = (match.rand() + match.rand() - 1) * 0.072 * rule.aim
  } else {
    forgetTarget(b, now)
    if (noise && (!b.last || b.last.until <= now)) {
      const radius = 2 + nearNoise * 0.075
      b.last = {
        x: noise.x + (match.rand() * 2 - 1) * radius,
        z: noise.z + (match.rand() * 2 - 1) * radius,
        until: now + 2.8,
      }
    }
  }
}

function roam(match, p, living) {
  const b = p.brain,
    now = match.time,
    gas = match.gas
  if (gas && distance(p, gas) > gas.r * 0.8) {
    return gas.r > 24
      ? {
          x: gas.x + Math.sin(p.index * 1.5) * Math.min(22, gas.r * 0.33),
          z: gas.z + Math.cos(p.index * 1.5) * Math.min(22, gas.r * 0.33),
        }
      : gas
  }
  const lead = living.find(
    (q) => !q.bot && q.alive && q.team === p.team && q.air === 'ground',
  )
  const mark = lead && match.pings.get(lead.id)
  if (
    mark &&
    mark.until > now &&
    mark.kind === 'move' &&
    distance(p, mark) < 135 &&
    (!gas || distance(mark, gas) < gas.r * 0.93)
  )
    return mark
  if (b.last?.until > now && distance(p, b.last) > 4.8) return b.last
  if (lead && distance(p, lead) > 14)
    return {
      x: lead.x + Math.sin(p.index * 1.5) * 8,
      z: lead.z + Math.cos(p.index * 1.5) * 8,
    }
  if (
    !b.roamUntil ||
    b.roamUntil < now ||
    distance(p, travel(b)) < 5.8 ||
    (gas && distance(travel(b), gas) > gas.r * 0.82)
  ) {
    const choices = gas
      ? match.world.sites.filter((s) => distance(s, gas) < gas.r * 0.72)
      : match.world.spawns
    const site = choices.length
      ? choices[Math.trunc(match.rand() * choices.length)]
      : (gas ?? p)
    const jitter = gas?.stage > 4 ? 6 : 22
    const next = match.safePoint(
      site.x + (match.rand() - 0.5) * jitter,
      site.z + (match.rand() - 0.5) * jitter,
    )
    b.wx = next.x
    b.wz = next.z
    b.roamUntil = now + 5.8 + match.rand() * 5.2
  }
  return travel(b)
}

export function botInput(match, p, living) {
  const b = p.brain,
    now = match.time,
    rule = match.botRules
  const role = BOT_PROFILES[p.role] ?? BOT_PROFILES.rifleman
  const input = { ...EMPTY_INPUT, yaw: p.yaw, pitch: p.pitch }
  if (p.downed) return { ...input, revive: p.selfRevive }
  if (p.air !== 'ground') return deploy(match, p, living, input)
  const think = b.next <= now
  if (think) scan(match, p, living, rule)
  const enemy = b.target && match.players.get(b.target)
  const foe = enemy && botCanSee(match, p, enemy) ? enemy : null
  if (!foe) forgetTarget(b, now)
  let goal = null,
    pitch = 0,
    yaw = p.yaw
  if (foe) {
    const d = distance(p, foe),
      weapon = equippedSpec(p)
    const aim = { x: foe.x + foe.vx * rule.lead, z: foe.z + foe.vz * rule.lead }
    yaw = toward(p, aim) + b.missX * (p.index % 5 === 0 ? 0.69 : 1)
    pitch =
      Math.atan2(
        foe.y + foe.height * 0.75 - p.y - eyeHeight(p),
        Math.max(0.1, d),
      ) + b.missY
    input.z = d > role.far ? 0.84 : d < role.near ? -0.58 : 0.07
    input.x = Math.sin(now * 1.32 + p.index * 0.77) * rule.side
    input.aim = d > (weapon.pellets ? 7 : 13)
    const max = Math.min(weapon.distance * 0.84, role.far * 1.78 + 5)
    input.fire =
      b.aimLock <= now &&
      Math.abs(yawWrap(yaw - p.yaw)) < rule.accuracyGate &&
      d < max &&
      Math.sin(now * 3.3 + p.index * 1.7) > Math.cos(Math.PI * rule.duty)
    if (rule.tactics && p.tacticalCharges > 0 && p.gearReady <= now && think) {
      input.tacticalUse =
        (p.tacticalType === 'stim' && p.health < 46) ||
        (p.tacticalType === 'smoke' &&
          p.armor < 23 &&
          d > 12 &&
          match.rand() < 0.42) ||
        (p.tacticalType === 'pulse' && d < 42 && match.rand() < 0.095)
    }
  } else {
    goal = roam(match, p, living)
    input.sprint = true
    input.z = distance(p, goal) > 2.15 ? 1 : 0
    if (
      p.armor < 105 &&
      p.plates > 0 &&
      now - p.lastDamage > 2.35 &&
      Math.hypot(p.vx, p.vz) < 9
    )
      input.plate = true
    if (
      think &&
      match.rand() < 0.42 &&
      (p.plates < p.capacity || p.stock < equippedSpec(p).stock * 0.4)
    ) {
      const loot = match.nearbyLoot(p)
      input.interact =
        !!loot && ['plate', 'ammo', 'crate', 'satchel'].includes(loot.type)
    }
  }
  const duty = botRescueTarget(match, p, living)
  const d = foe ? distance(p, foe) : Infinity
  if (duty && d > 18) {
    goal = duty
    input.x = 0
    input.fire = input.plate = input.aim = false
    input.sprint = distance(duty, p) > 5
    input.z = distance(duty, p) > 2.3 ? 1 : 0
    input.revive = input.z === 0
  } else if (match.control) {
    const relay = assignRelay(match.control, p, living),
      meter = distance(p, relay)
    if (!onRelay(p, relay) && (!foe || meter > 9 || d > 24)) {
      goal = relay
      input.z = 1
      input.x = 0
      input.fire = input.aim = false
      input.sprint = meter > 12
    } else if (onRelay(p, relay) && !foe) {
      goal = null
      input.z = input.x = 0
      input.sprint = false
    }
  }
  // A burst can run after a human trigger tap. Bots must still clear their
  // queued rounds when an enemy vanishes or they're assigned a different task.
  if (!foe || goal) p.burstLeft = 0
  if (goal && input.z > 0.2) {
    const via = match.navigator.steer(p, goal, b, now)
    yaw = toward(p, via)
    pitch = 0
  }
  input.yaw = yawWrap(
    p.yaw + clamp(yawWrap(yaw - p.yaw), -rule.turn, rule.turn),
  )
  input.pitch = lerp(p.pitch, pitch, foe ? 0.32 : 0.24)
  if (input.z > 0.2) {
    const ray = { x: p.x, y: p.y + 1, z: p.z },
      dir = { ...forward(input.yaw), y: 0 }
    const hit = match.world.grid.rayHit(ray, dir, 1.24)
    if (hit < 1.24) {
      const side = { ...forward(input.yaw + b.lean * 1.14), y: 0 }
      if (match.world.grid.rayHit(ray, side, 1.32) < 0.56) b.lean *= -1
      if (!foe || !input.fire) input.yaw = yawWrap(input.yaw + b.lean * 0.55)
      input.x = b.lean * 0.78
      if (Math.hypot(p.vx, p.vz) < 1.6 && p.grounded && match.rand() < 0.126)
        input.jump = input.jumpHeld = true
    }
  }
  if (p.ammo < equippedSpec(p).mag * 0.29 && !input.fire) input.reload = true
  // Keeps long bot-only rounds from ending in ambushes with empty magazines.
  drillAmmoFloor(p)
  return input
}
