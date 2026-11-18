import { clamp, lerp, planeAt } from './world.js'
import { equippedSpec } from './loadout.js'
import {
  LAUNCH_COOLDOWN,
  LAUNCH_SECONDS,
  LAUNCH_SPEED,
  LAUNCH_VERTICAL,
  nearestLaunchPad,
} from './launch-pads.js'

const BODY_RADIUS = 0.28
export const STANDING = 1.74
export const DUCKING = 1.04
export const EYE_LEVEL = 1.55
export const eyeHeight = (p) =>
  p.downed ? 0.55 : 0.9 + (p.height - DUCKING) * 0.93
export const yawWrap = (n) => Math.atan2(Math.sin(n), Math.cos(n))
export const forward = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) })
export const aimVector = (yaw, pitch) => ({
  x: -Math.sin(yaw) * Math.cos(pitch),
  y: Math.sin(pitch),
  z: -Math.cos(yaw) * Math.cos(pitch),
})
export const EMPTY_INPUT = Object.freeze({
  x: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  sprint: false,
  tactical: false,
  crouch: false,
  jump: false,
  jumpHeld: false,
  plate: false,
  fire: false,
  aim: false,
  reload: false,
  interact: false,
  equipment: false,
  tacticalUse: false,
  swap: false,
  primary: false,
  sidearm: false,
  revive: false,
  ping: false,
})
export const ACTIONS = [
  'tactical',
  'jump',
  'reload',
  'interact',
  'equipment',
  'tacticalUse',
  'swap',
  'primary',
  'sidearm',
  'ping',
]
const HELD = ['sprint', 'crouch', 'jumpHeld', 'plate', 'fire', 'aim', 'revive']
export function cleanInput(raw = {}) {
  const number = (n, cap) => (Number.isFinite(n) ? clamp(n, -cap, cap) : 0)
  const input = {
    x: number(raw?.x, 1),
    z: number(raw?.z, 1),
    yaw: yawWrap(number(raw?.yaw, 1e6)),
    pitch: number(raw?.pitch, 1.49),
  }
  for (const name of [...ACTIONS, ...HELD]) input[name] = raw?.[name] === true
  return input
}

export function moveState(x, y, z, state = 'ground', yaw = 0) {
  return {
    x,
    y,
    z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw,
    pitch: 0,
    height: STANDING,
    grounded: state === 'ground',
    air: state,
    stance: state === 'ground' ? 'idle' : state,
    slide: 0,
    slideCooldown: 0,
    tactical: 0,
    tacCooldown: 0,
    mantle: null,
    climbing: false,
    landing: 0,
    launchReady: 0,
    launchUntil: 0,
    sprinting: false,
    aim: false,
  }
}

const overlaps = (b, x, z, radius = BODY_RADIUS) =>
  Math.abs(x - b.x) < b.w * 0.5 + radius &&
  Math.abs(z - b.z) < b.d * 0.5 + radius
function floorAt(world, x, z, max, group) {
  let y = world.height(x, z)
  for (const b of group) {
    const top = b.y + b.h
    if (top <= max && top > y && overlaps(b, x, z, 0.16)) y = top
  }
  return y
}
function blocked(b, p, x, z, height = p.height, allowance = 0.055) {
  return (
    overlaps(b, x, z) &&
    p.y + height > b.y + 0.02 &&
    p.y < b.y + b.h - allowance
  )
}
function mantleTo(p, x, z, y, duration) {
  p.mantle = { x0: p.x, y0: p.y, z0: p.z, x, z, y, t: 0, duration }
  p.vx = p.vy = p.vz = 0
  p.slide = 0
  p.climbing = false
  p.grounded = false
  p.stance = 'mantle'
}
function mantleProbe(p, world, boxGroup, f, allowHigh) {
  const px = p.x + f.x * 1.08,
    pz = p.z + f.z * 1.08
  let top = -Infinity,
    ledge
  for (const b of boxGroup) {
    const h = b.y + b.h - p.y
    if (h < 0.42 || h > (allowHigh ? 2.5 : 1.96) || !overlaps(b, px, pz, 0.12))
      continue
    if (b.y > p.y + 0.24 && b.y > p.y + p.height - 0.12) continue
    if (b.y + b.h > top) {
      top = b.y + b.h
      ledge = b
    }
  }
  if (!ledge) return false
  const xp = clamp(
      px,
      ledge.x - ledge.w * 0.5 + 0.06,
      ledge.x + ledge.w * 0.5 - 0.06,
    ),
    zp = clamp(
      pz,
      ledge.z - ledge.d * 0.5 + 0.06,
      ledge.z + ledge.d * 0.5 - 0.06,
    )
  if (
    [...boxGroup].some(
      (b) =>
        b !== ledge &&
        overlaps(b, xp, zp, 0.24) &&
        b.y + b.h > top + 0.06 &&
        b.y < top + 1.05,
    )
  )
    return false
  if (
    Math.hypot(xp - p.x, zp - p.z) > 0.23 &&
    world.height(xp, zp) < top + 0.2
  ) {
    mantleTo(p, xp, zp, top + 0.013, 0.31 + (top - p.y) * 0.068)
    return true
  }
  return false
}

export function integrate(
  p,
  input,
  world,
  dt,
  time,
  emit = () => {},
  autoDrop = 16.6,
) {
  if (p.downed)
    input = {
      ...EMPTY_INPUT,
      yaw: input.yaw,
      pitch: input.pitch,
      x: input.revive ? 0 : input.x,
      z: input.revive ? 0 : input.z,
      crouch: true,
    }
  p.yaw = input.yaw
  p.pitch = input.pitch
  p.slideCooldown = Math.max(0, p.slideCooldown - dt)
  p.tacCooldown = Math.max(0, p.tacCooldown - dt)
  p.landing = Math.max(0, p.landing - dt * 3.7)
  const f = forward(p.yaw),
    rx = Math.cos(p.yaw),
    rz = -Math.sin(p.yaw)
  if (p.air === 'plane') {
    const plane = planeAt(time, world)
    p.x = plane.x
    p.y = plane.y
    p.z = plane.z
    p.stance = 'plane'
    p.aim = false
    p.sprinting = false
    if (input.jump || time >= autoDrop) {
      // Release below the cargo floor. Starting at the aircraft's center
      // puts the first-person camera inside the fuselage for several frames.
      p.y -= 5.4
      p.air = 'freefall'
      p.stance = 'freefall'
      p.grounded = false
      p.vy = -13
      p.vx = f.x * 11
      p.vz = f.z * 11
      emit('drop')
    }
    return
  }
  if (input.interact && !input.revive && !p.plateActive) {
    const pad = nearestLaunchPad(world, p, time)
    if (pad) {
      const direction = forward(pad.yaw)
      p.air = p.stance = 'freefall'
      p.grounded = false
      p.aim = false
      p.sprinting = false
      p.launchUntil = time + LAUNCH_SECONDS
      p.launchReady = time + LAUNCH_COOLDOWN
      p.vx = direction.x * LAUNCH_SPEED
      p.vz = direction.z * LAUNCH_SPEED
      p.vy = LAUNCH_VERTICAL
      p.y = Math.max(p.y, pad.y + 0.24)
      p.slide = p.tactical = 0
      emit('launch')
      return
    }
  }
  if (p.launchUntil > time && p.air === 'freefall') {
    const wall = { x: p.x, y: p.y + eyeHeight(p), z: p.z }
    const velocity = Math.hypot(p.vx, p.vy, p.vz)
    const contact = world.grid.rayHit(
      wall,
      { x: p.vx / velocity, y: p.vy / velocity, z: p.vz / velocity },
      velocity * dt,
    )
    if (contact < velocity * dt - 0.001) {
      p.launchUntil = 0
      p.vx = p.vz = 0
      p.vy = -0.5
    } else {
      p.x = clamp(p.x + p.vx * dt, -world.half, world.half)
      p.z = clamp(p.z + p.vz * dt, -world.half, world.half)
      p.y += p.vy * dt
      p.vy -= dt * 21
      p.vx = lerp(p.vx, (input.x * rx + input.z * f.x) * 5, 0.025)
      p.vz = lerp(p.vz, (input.x * rz + input.z * f.z) * 5, 0.025)
      return
    }
  }
  if (p.air === 'freefall' || p.air === 'chute') {
    const floor = floorAt(
      world,
      p.x,
      p.z,
      p.y,
      world.grid.nearby(p.x, p.z, 1.3),
    )
    const height = p.y - floor
    if (p.air === 'freefall' && (input.jump || height < 22)) {
      p.air = 'chute'
      emit('chute')
    }
    if (p.air === 'chute' && input.crouch && height > 37) {
      p.air = 'freefall'
      emit('cut')
    }
    const open = p.air === 'chute',
      fx = f.x * (open ? 4.4 : 7.6),
      fz = f.z * (open ? 4.4 : 7.6),
      speed = open ? 10.6 : 13
    const blend = 1 - Math.exp(-dt * (open ? 3.9 : 1.65))
    p.vx = lerp(p.vx, fx + (f.x * input.z + rx * input.x) * speed, blend)
    p.vz = lerp(p.vz, fz + (f.z * input.z + rz * input.x) * speed, blend)
    p.vy = lerp(
      p.vy,
      open ? -8.1 : p.pitch < -0.45 ? -44 : -33,
      1 - Math.exp(-dt * (open ? 5.8 : 1.7)),
    )
    p.x = clamp(p.x + p.vx * dt, -world.half, world.half)
    p.z = clamp(p.z + p.vz * dt, -world.half, world.half)
    p.y += p.vy * dt
    p.stance = p.air
    p.aim = false
    p.sprinting = false
    if (p.y <= floor + 0.025) {
      p.y = floor
      p.vy = 0
      p.air = 'ground'
      p.stance = 'idle'
      p.grounded = true
      p.landing = 0.92
      emit('land')
    }
    return
  }
  if (p.mantle) {
    const m = p.mantle,
      u = clamp((m.t += dt) / m.duration, 0, 1),
      up = Math.sin(u * Math.PI * 0.5),
      over = u * u * (3 - 2 * u)
    p.y = lerp(m.y0, m.y, up) + Math.sin(u * Math.PI) * 0.13
    p.x = lerp(m.x0, m.x, over)
    p.z = lerp(m.z0, m.z, over)
    p.height = lerp(p.height, DUCKING, 0.23)
    p.aim = false
    p.sprinting = false
    if (u >= 1) {
      p.mantle = null
      p.grounded = true
      p.stance = 'crouch'
      emit('mantleEnd')
    }
    return
  }
  const group = world.grid.nearby(p.x, p.z, 2.45)
  if ((input.jumpHeld || p.climbing) && input.z > 0.2 && world.ladders.length) {
    const l = world.ladders.find(
      (v) =>
        Math.abs(v.x - p.x) < 0.6 &&
        Math.abs(v.z - p.z) < 0.82 &&
        p.y > v.y - 0.65 &&
        p.y < v.top + 0.07 &&
        f.x * v.inX + f.z * v.inZ > 0.35,
    )
    if (l) {
      p.climbing = true
      p.stance = 'climb'
      p.vx = p.vy = p.vz = 0
      p.aim = false
      p.sprinting = false
      p.grounded = false
      p.x = lerp(p.x, l.x - l.inX * 0.17, Math.min(1, dt * 12))
      p.z = lerp(p.z, l.z - l.inZ * 0.17, Math.min(1, dt * 12))
      p.y += dt * 3.45
      if (p.y >= l.top)
        mantleTo(p, l.x + l.inX * 0.78, l.z + l.inZ * 0.78, l.top + 0.015, 0.29)
      return
    }
  }
  p.climbing = false

  const handling = p.weapon ? equippedSpec(p).speed : 1
  const magnitude = Math.hypot(input.x, input.z),
    power = Math.min(1, magnitude)
  let dx = 0,
    dz = 0
  if (magnitude > 0.01) {
    dx = (input.x * rx + input.z * f.x) / magnitude
    dz = (input.x * rz + input.z * f.z) / magnitude
  }
  const busy =
    p.plateActive || p.reloadEnd > time || p.swapReady > time || !!p.reviving
  let crouch = input.crouch || p.slide > 0
  if (
    !crouch &&
    p.height < STANDING - 0.015 &&
    [...group].some((b) => blocked(b, p, p.x, p.z, STANDING))
  )
    crouch = true
  if (
    input.tactical &&
    input.z > 0.23 &&
    p.tacCooldown === 0 &&
    !crouch &&
    !busy
  ) {
    p.tactical = 2.1
    p.tacCooldown = 4.8
  }
  if (input.z < 0.1 || busy || input.aim || input.fire || crouch) p.tactical = 0
  else p.tactical = Math.max(0, p.tactical - dt)
  const velocity = Math.hypot(p.vx, p.vz)
  if (
    input.crouch &&
    p.grounded &&
    p.slideCooldown === 0 &&
    !busy &&
    (velocity > 6.9 ||
      ((input.sprint || p.tactical > 0) && input.z > 0.4 && velocity > 4.75))
  ) {
    p.slide = 0.83
    p.slideCooldown = 1.14
    p.vx =
      (velocity > 4 ? p.vx / velocity : dx) *
      Math.max(velocity * 1.05, 13.1) *
      handling
    p.vz =
      (velocity > 4 ? p.vz / velocity : dz) *
      Math.max(velocity * 1.05, 13.1) *
      handling
    crouch = true
    emit('slide')
  }
  if (input.jump && (p.grounded || (p.slide > 0 && p.vy < 0.1))) {
    if (
      p.slide <= 0 &&
      input.z > 0.18 &&
      mantleProbe(p, world, group, f, true)
    ) {
      emit('mantle')
      return
    }
    if (p.slide > 0) {
      p.vy = 7.85
      p.vx *= 1.1
      p.vz *= 1.1
      p.slide = 0
      emit('slideJump')
    } else {
      p.vy = 7.05
      emit('jump')
    }
    p.grounded = false
  } else if (
    input.jumpHeld &&
    input.z > 0.38 &&
    p.slide <= 0 &&
    p.vy < 2.4 &&
    (p.stance === 'jump' || p.grounded) &&
    mantleProbe(p, world, group, f, p.stance === 'jump')
  ) {
    emit('mantle')
    return
  }

  p.aim = input.aim && !p.plateActive && p.slide <= 0
  p.sprinting =
    !busy &&
    !p.aim &&
    !crouch &&
    !input.fire &&
    (input.sprint || p.tactical > 0) &&
    input.z > 0.19 &&
    power > 0.28
  const speed =
    (p.downed
      ? 1.27
      : p.aim
        ? 3.35
        : busy
          ? 4.15
          : crouch
            ? 3.0
            : p.tactical > 0
              ? 11.8
              : p.sprinting
                ? 8.55
                : 5.45) * handling
  if (p.slide > 0) {
    p.slide = Math.max(0, p.slide - dt)
    const drag = Math.exp(-dt * 1.23)
    p.vx = p.vx * drag + dx * dt * 1.9
    p.vz = p.vz * drag + dz * dt * 1.9
  } else {
    const k = 1 - Math.exp(-dt * (p.grounded ? (power > 0.07 ? 13 : 17) : 4.4))
    const airKeep =
      !p.grounded && Math.hypot(p.vx, p.vz) > speed && power > 0.08
        ? Math.min(11, Math.hypot(p.vx, p.vz)) * 0.89
        : speed
    p.vx = lerp(p.vx, dx * power * airKeep, k)
    p.vz = lerp(p.vz, dz * power * airKeep, k)
  }
  p.height = lerp(
    p.height,
    p.downed ? 0.66 : crouch ? DUCKING : STANDING,
    1 - Math.exp(-dt * 16),
  )
  for (const axis of ['x', 'z']) {
    const nx =
      axis === 'x' ? clamp(p.x + p.vx * dt, -world.half, world.half) : p.x
    const nz =
      axis === 'z' ? clamp(p.z + p.vz * dt, -world.half, world.half) : p.z
    const allowStep = p.grounded ? 0.31 : 0.037
    if (
      world.height(nx, nz) > p.y + allowStep ||
      [...group].some((b) => blocked(b, p, nx, nz, p.height, allowStep))
    ) {
      if (axis === 'x') p.vx = 0
      else p.vz = 0
    } else {
      p.x = nx
      p.z = nz
    }
  }
  const ground = floorAt(
    world,
    p.x,
    p.z,
    p.y + (p.grounded ? 0.315 : 0.12),
    group,
  )
  if (p.grounded && p.y - ground > 0.33) p.grounded = false
  const priorY = p.y
  if (!p.grounded) p.vy -= dt * 19.65
  p.y += p.vy * dt
  if (p.vy > 0) {
    for (const b of group)
      if (
        overlaps(b, p.x, p.z) &&
        priorY + p.height <= b.y + 0.04 &&
        p.y + p.height > b.y
      ) {
        p.y = b.y - p.height - 0.01
        p.vy = 0
      }
  }
  if (p.y <= ground + 0.045 && p.vy <= 0) {
    if (!p.grounded && p.vy < -3.3) {
      p.landing = clamp(-p.vy * 0.09, 0.1, 0.78)
      emit('land')
    }
    p.y = ground
    p.vy = 0
    p.grounded = true
  }
  p.stance = p.downed
    ? 'downed'
    : p.slide > 0
      ? 'slide'
      : !p.grounded
        ? 'jump'
        : crouch
          ? 'crouch'
          : p.sprinting
            ? p.tactical > 0
              ? 'tactical'
              : 'sprint'
            : velocity > 0.5
              ? 'run'
              : 'idle'
}
