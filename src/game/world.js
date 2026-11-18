import { layoutPads } from './launch-pads.js'
import { battlefield } from './map-catalog.js'
import { createStaff } from './support.js'
import {
  FLOODLINE_SITES,
  RELAY_WORKS_POINTS,
  RELAY_WORKS_SITES,
  floodlineHeight,
  layoutFloodline,
  layoutRelayWorks,
} from './map-layouts.js'

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
export const lerp = (a, b, t) => a + (b - a) * t
export const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)
export function randomSource(n) {
  return () => {
    n |= 0
    n = (n + 0x6d2b79f5) | 0
    let t = Math.imul(n ^ (n >>> 15), 1 | n)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RIDGE_SITES = [
  { name: 'AIRSTRIP', x: -252, z: 142, y: 3.4, r: 49 },
  { name: 'FLOODGATE', x: -198, z: -176, y: 6, r: 47 },
  { name: 'RELAY STATION', x: 34, z: -205, y: 11, r: 53 },
  { name: 'OLD TOWN', x: -19, z: -9, y: 5.3, r: 66 },
  { name: 'NORTH YARD', x: 199, z: -64, y: 7.7, r: 50 },
  { name: 'THE QUARRY', x: 196, z: 159, y: 4.2, r: 55 },
  { name: 'TIMBER CAMP', x: -12, z: 217, y: 8.1, r: 42 },
]
const roadPairs = [
  [0, 1],
  [0, 3],
  [0, 6],
  [1, 2],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 4],
  [3, 5],
  [3, 6],
  [4, 5],
  [5, 6],
]
const WORLD_CACHE = new Map()

class Grid {
  constructor(size = 13) {
    this.size = size
    this.cells = new Map()
  }
  key(x, z) {
    return x * 65536 + z
  }
  add(box) {
    const s = this.size
    for (
      let x = Math.floor((box.x - box.w / 2) / s);
      x <= Math.floor((box.x + box.w / 2) / s);
      x++
    ) {
      for (
        let z = Math.floor((box.z - box.d / 2) / s);
        z <= Math.floor((box.z + box.d / 2) / s);
        z++
      ) {
        const key = this.key(x, z)
        if (!this.cells.has(key)) this.cells.set(key, [])
        this.cells.get(key).push(box)
      }
    }
  }
  nearby(x, z, r) {
    const s = this.size,
      out = new Set()
    for (let a = Math.floor((x - r) / s); a <= Math.floor((x + r) / s); a++)
      for (let b = Math.floor((z - r) / s); b <= Math.floor((z + r) / s); b++) {
        const list = this.cells.get(this.key(a, b))
        if (list) for (const box of list) out.add(box)
      }
    return out
  }
  rayHit(o, v, limit) {
    const s = this.size
    let x = Math.floor(o.x / s),
      z = Math.floor(o.z / s),
      t = 0,
      hit = limit
    const dx = Math.sign(v.x),
      dz = Math.sign(v.z)
    const stepX = dx ? Math.abs(s / v.x) : Infinity,
      stepZ = dz ? Math.abs(s / v.z) : Infinity
    let tX = dx ? ((x + (dx > 0 ? 1 : 0)) * s - o.x) / v.x : Infinity
    let tZ = dz ? ((z + (dz > 0 ? 1 : 0)) * s - o.z) / v.z : Infinity
    const checked = new Set()
    while (t < hit) {
      const list = this.cells.get(this.key(x, z))
      if (list)
        for (const box of list) {
          if (checked.has(box)) continue
          checked.add(box)
          const a = rayBox(o, v, box, hit)
          if (a < hit) hit = a
        }
      if (tX < tZ) {
        t = tX
        tX += stepX
        x += dx
      } else {
        t = tZ
        tZ += stepZ
        z += dz
      }
    }
    return hit
  }
}

export function rayBox(o, v, b, limit) {
  let lo = 0.001,
    hi = limit
  const axes = [
    [o.x, v.x, b.x - b.w / 2, b.x + b.w / 2],
    [o.y, v.y, b.y, b.y + b.h],
    [o.z, v.z, b.z - b.d / 2, b.z + b.d / 2],
  ]
  for (const [origin, dir, min, max] of axes) {
    if (Math.abs(dir) < 0.00001) {
      if (origin < min || origin > max) return limit
      continue
    }
    let a = (min - origin) / dir,
      d = (max - origin) / dir
    if (a > d) [a, d] = [d, a]
    lo = Math.max(lo, a)
    hi = Math.min(hi, d)
    if (hi < lo) return limit
  }
  return lo
}

export function planeAt(time, world) {
  const u = clamp(time / 17.5, 0, 1)
  const path = world?.map?.flight
  const [ax, az] = path?.from ?? [-346, 305]
  const [bx, bz] = path?.to ?? [346, -292]
  return {
    x: lerp(ax, bx, u),
    y: path?.altitude ?? 152,
    z: lerp(az, bz, u),
    yaw: Math.atan2(ax - bx, az - bz),
  }
}

export function createWorld(id = 'ridge', seed = 173) {
  const map = battlefield(id)
  const { kind, half, extent } = map
  const key = `${map.id}:${seed}`
  if (WORLD_CACHE.has(key)) return WORLD_CACHE.get(key)
  const rand = randomSource(seed ^ 0x1d3d)
  const jitter = (r = 1) => (rand() * 2 - 1) * r
  const grid = new Grid()
  const boxes = [],
    vegetation = [],
    pickups = [],
    ladders = [],
    roads = [],
    targets = [],
    spawns = [],
    extras = []
  const sites =
    map.id === 'floodline'
      ? FLOODLINE_SITES
      : map.id === 'relay-works'
        ? RELAY_WORKS_SITES
        : kind === 'ridge'
          ? RIDGE_SITES
          : kind === 'yard'
            ? [{ name: 'SWITCHYARD', x: 0, z: 0, y: 1.2, r: 34 }]
            : [{ name: 'ECHO RANGE', x: 0, z: -10, y: 1.15, r: 45 }]
  let feature = 0

  function height(x, z) {
    const seedOffset = (seed % 1000) / 67
    if (map.id === 'floodline')
      return floodlineHeight(x, z, seedOffset, smooth, lerp)
    if (map.id === 'relay-works' && Math.abs(x) < 54 && Math.abs(z) < 54)
      return 1.15
    if (kind !== 'ridge') {
      const rim = smooth(47, 131, Math.hypot(x * 0.89, z * 0.95))
      const basin =
        Math.sin(x * 0.049) *
        Math.cos(z * 0.066) *
        (kind === 'yard' ? 0.16 : 0.48)
      const shelves =
        1 -
        Math.abs(
          Math.sin(x * 0.056 + z * 0.032) * Math.cos(z * 0.044 - x * 0.037),
        )
      const ridges =
        kind === 'range'
          ? 12 * Math.pow(shelves, 4) + 6 * Math.sin(x * 0.081 + z * 0.082)
          : 0
      return (
        1.15 +
        basin +
        rim *
          (17 +
            8 * Math.sin(x * 0.036 + z * 0.041) +
            10 * Math.sin(z * 0.07) * Math.sin(x * 0.034) +
            ridges)
      )
    }
    const radius = Math.hypot(x * 0.89, z)
    let y =
      7 + Math.sin(x * 0.011 - 0.6) * 4.2 + Math.cos(z * 0.016 + 0.7) * 5.4
    y +=
      Math.sin((x + z) * 0.029 + seedOffset) * 2.2 +
      Math.cos(x * 0.039 - z * 0.023) * 2.4
    y +=
      smooth(136, 356, radius) *
      (5 +
        6 * Math.sin(x * 0.021 + z * 0.015) +
        3 * Math.cos(x * 0.044 + z * 0.025))
    const mountain = smooth(309, 608, radius) * (1 - smooth(635, 920, radius))
    const cleft =
      1 -
      Math.abs(
        Math.sin(x * 0.018 + z * 0.037) * Math.cos(z * 0.026 - x * 0.041),
      )
    y +=
      mountain *
      (82 +
        36 * Math.sin((z + x) * 0.013 + 1.8) +
        26 * Math.cos(x * 0.029 - z * 0.015) +
        13 * Math.sin(z * 0.073 + x * 0.065) +
        Math.pow(cleft, 5) * 25)
    for (const s of sites) {
      if (Math.abs(x - s.x) > s.r + 37 || Math.abs(z - s.z) > s.r + 37) continue
      const d = Math.hypot(x - s.x, z - s.z)
      if (d < s.r + 37) y = lerp(s.y, y, smooth(s.r, s.r + 37, d))
    }
    return y
  }
  function box(mat, x, y, z, w, h, d, collide = false, tint = 1, ry = 0) {
    const b = { mat, x, y, z, w, h, d, tint, ry }
    boxes.push(b)
    if (collide) grid.add(b)
    return b
  }
  const prop = (mat, x, z, w, h, d, collide = true) =>
    box(mat, x, height(x, z) - 0.07, z, w, h, d, collide, 0.87 + rand() * 0.25)
  function pickup(type, x, z, add = {}) {
    const it = { id: `l${++feature}`, type, x, y: height(x, z), z, ...add }
    pickups.push(it)
    return it
  }
  function lamp(x, z, high = 6.3) {
    const y = height(x, z)
    box('dark', x, y - 0.08, z, 0.19, high, 0.19, true)
    box('dark', x + 0.35, y + high - 0.23, z, 0.86, 0.1, 0.16)
    box('light', x + 0.77, y + high - 0.26, z, 0.28, 0.09, 0.33)
  }
  function stripes(x, y, z, w, h, plane = 'x') {
    for (let i = 0; i < 5; i++) {
      const t = ((i + 0.5) / 5 - 0.5) * w
      box(
        i % 2 ? 'dark' : 'hazard',
        x + (plane === 'x' ? t : 0),
        y,
        z + (plane === 'z' ? t : 0),
        plane === 'x' ? w / 5 : 0.025,
        h,
        plane === 'z' ? w / 5 : 0.025,
      )
    }
  }
  function rail(x, y, z, width, axis) {
    const w = axis === 'x' ? width : 0.1,
      d = axis === 'z' ? width : 0.1
    box('dark', x, y + 0.66, z, w, 0.11, d, true)
    box('dark', x, y + 0.28, z, w, 0.075, d)
    for (let i = -1; i <= 1; i++)
      box(
        'dark',
        x + (axis === 'x' ? i * width * 0.46 : 0),
        y,
        z + (axis === 'z' ? i * width * 0.46 : 0),
        0.09,
        0.78,
        0.09,
      )
  }
  function container(x, z, along = 'x', hue = 'teal', stacked = false) {
    const y = height(x, z) - 0.04,
      w = along === 'x' ? 6.1 : 2.58,
      d = along === 'x' ? 2.58 : 6.1
    box(hue, x, y, z, w, 2.57, d, true, 0.86 + rand() * 0.23)
    for (const side of [-1, 1]) {
      box('trim', x, y + 2.48, z + (side * d) / 2, w, 0.12, 0.11)
      box('trim', x, y + 0.1, z + (side * d) / 2, w, 0.12, 0.11)
      box('trim', x + (side * w) / 2, y + 0.1, z, 0.11, 0.12, d)
      box('trim', x + (side * w) / 2, y + 2.48, z, 0.11, 0.12, d)
      for (let i = -2; i <= 2; i++) {
        if (along === 'x')
          box(
            hue,
            x + (i * w) / 5.3,
            y + 0.19,
            z + (side * d) / 2,
            0.1,
            2.27,
            0.105,
            false,
            0.77,
          )
        else
          box(
            hue,
            x + (side * w) / 2,
            y + 0.19,
            z + (i * d) / 5.3,
            0.105,
            2.27,
            0.1,
            false,
            0.77,
          )
      }
    }
    if (along === 'x') {
      for (const s of [-1, 1])
        box(
          'trim',
          x + w / 2 + 0.02,
          y + 0.22,
          z + s * d * 0.24,
          0.09,
          2.08,
          0.075,
        )
      stripes(x + w / 2 + 0.029, y + 0.34, z, 0.65, 0.12, 'z')
    } else {
      for (const s of [-1, 1])
        box(
          'trim',
          x + s * w * 0.24,
          y + 0.22,
          z + d / 2 + 0.02,
          0.075,
          2.08,
          0.09,
        )
      stripes(x, y + 0.34, z + d / 2 + 0.03, 0.65, 0.12)
    }
    if (stacked) {
      box('rust', x + 0.1, y + 2.57, z, w, 2.57, d, true)
      for (const s of [-1, 1]) {
        box('trim', x + 0.1, y + 5.04, z + (s * d) / 2, w, 0.12, 0.11)
        for (let i = -2; i <= 2; i++)
          if (along === 'x')
            box(
              'rust',
              x + 0.1 + (i * w) / 5.3,
              y + 2.81,
              z + (s * d) / 2,
              0.09,
              2.23,
              0.1,
              false,
              0.77,
            )
      }
    }
  }
  function concreteBlock(x, z, w, d, h) {
    const b = prop('concrete', x, z, w, h, d)
    box('trim', x, b.y + h - 0.09, z, w + 0.06, 0.1, d + 0.06)
    stripes(x, b.y + 0.2, z + d / 2 + 0.016, Math.min(w * 0.7, 1.7), 0.14)
  }
  function building(x, z, w, d, mat, opts = {}) {
    const y = height(x, z),
      h = opts.h ?? 4.4
    const wall = 0.28,
      opening = opts.big ? 3.8 : 1.95
    box('floor', x, y - 0.09, z, w + 0.48, 0.13, d + 0.48, false)
    box(mat, x, y, z - d / 2, w, h, wall, true, 0.77)
    box(mat, x - w / 2, y, z, wall, h, d, true, 0.91)
    box(mat, x + w / 2, y, z, wall, h, d, true)
    const frontW = (w - opening) / 2
    for (const s of [-1, 1])
      box(
        mat,
        x + s * (opening / 2 + frontW / 2),
        y,
        z + d / 2,
        frontW,
        h,
        wall,
        true,
        1.04,
      )
    box(mat, x, y + 2.66, z + d / 2, opening, h - 2.66, wall, true)
    box('trim', x, y + 2.5, z + d / 2 + 0.09, opening + 0.24, 0.16, 0.33)
    for (const s of [-1, 1])
      box(
        'trim',
        x + s * (opening / 2 + 0.1),
        y,
        z + d / 2 + 0.11,
        0.16,
        2.53,
        0.32,
      )
    box('light', x, y + 2.69, z + d / 2 + 0.23, 0.6, 0.12, 0.21)
    box('roof', x, y + h, z, w + 0.65, 0.33, d + 0.67, true)
    box('trim', x, y + h - 0.04, z + d / 2 + 0.18, w + 0.48, 0.16, 0.16)
    box('trim', x, y + h - 0.04, z - d / 2 - 0.18, w + 0.48, 0.16, 0.16)
    for (const s of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const wz = z + i * d * 0.27
        box('dark', x + s * (w / 2 + 0.15), y + h * 0.42, wz, 0.1, 1.12, 1.48)
        box(
          i === 1 && opts.warm ? 'warmglass' : 'glass',
          x + s * (w / 2 + 0.208),
          y + h * 0.42 + 0.08,
          wz,
          0.025,
          0.96,
          1.28,
          false,
          i === -1 ? 0.72 : 1,
        )
        box(
          'trim',
          x + s * (w / 2 + 0.223),
          y + h * 0.42 + 0.08,
          wz,
          0.055,
          0.96,
          0.05,
        )
        box(
          'trim',
          x + s * (w / 2 + 0.225),
          y + h * 0.42 + 0.52,
          wz,
          0.045,
          0.052,
          1.28,
        )
      }
    }
    for (const s of [-1, 1]) {
      const qx = x + s * (opening / 2 + frontW * 0.56)
      box('dark', qx, y + 1.45, z + d / 2 + 0.15, 1.36, 1.01, 0.08)
      box(
        opts.warm && s === -1 ? 'warmglass' : 'glass',
        qx,
        y + 1.53,
        z + d / 2 + 0.201,
        1.2,
        0.84,
        0.026,
      )
      box('trim', qx, y + 1.53, z + d / 2 + 0.225, 0.045, 0.84, 0.03)
      box('trim', qx, y + 1.43, z + d / 2 + 0.21, 1.46, 0.1, 0.16)
      box(mat, qx, y + 0.02, z + d / 2 + 0.18, 1.65, 0.29, 0.17, false, 0.68)
    }
    box('metal', x - w * 0.25, y + h + 0.33, z - d * 0.16, 1.08, 0.61, 0.91)
    for (let k = -2; k <= 2; k++)
      box(
        'dark',
        x - w * 0.25 + k * 0.16,
        y + h + 0.52,
        z - d * 0.16 + 0.46,
        0.065,
        0.2,
        0.035,
      )
    if (opts.ladder) {
      const lx = x + w * 0.27,
        lz = z + d / 2 + 0.42
      ladders.push({ x: lx, z: lz, y, top: y + h + 0.33, inX: 0, inZ: -1 })
      for (const s of [-1, 1])
        box('hazard', lx + s * 0.36, y, lz, 0.071, h + 0.85, 0.076)
      for (let j = 0.25; j < h + 0.49; j += 0.31)
        box('trim', lx, y + j, lz, 0.77, 0.043, 0.06)
      rail(x - w * 0.18, y + h + 0.33, z + d / 2 - 0.12, w * 0.54, 'x')
      rail(x - w / 2 + 0.08, y + h + 0.33, z, d * 0.91, 'z')
    }
    box('wood', x - w * 0.25, y + 0.02, z - d * 0.24, 1.27, 0.69, 0.93, true)
    box('metal', x + w * 0.3, y + 0.02, z - d * 0.3, 1.39, 0.89, 0.89, true)
    if (opts.loot !== false) {
      pickup('crate', x - w * 0.25, z - 0.4, { y: y + 0.04 })
      const roll = rand()
      pickup(
        roll > 0.82
          ? 'satchel'
          : roll > 0.63
            ? 'box'
            : roll > 0.47
              ? 'ammo'
              : roll > 0.24
                ? 'plate'
                : 'cash',
        x + w * 0.25,
        z - d * 0.2,
        { amount: roll < 0.24 ? 600 : roll < 0.47 ? 2 : undefined },
      )
    }
  }
  function makeRoad(points, width, paint = true) {
    roads.push({ points, width, paint })
  }
  function roadDistance(x, z) {
    let result = Infinity
    for (const road of roads)
      for (let i = 1; i < road.points.length; i++) {
        const [ax, az] = road.points[i - 1],
          [bx, bz] = road.points[i]
        const dx = bx - ax,
          dz = bz - az,
          t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1)
        result = Math.min(
          result,
          Math.hypot(x - ax - dx * t, z - az - dz * t) - road.width * 0.5,
        )
      }
    return result
  }

  const layout = {
    height,
    box,
    prop,
    pickup,
    lamp,
    rail,
    building,
    container,
    concreteBlock,
    makeRoad,
    roadDistance,
    ladders,
    spawns,
    extras,
    vegetation,
    rand,
  }
  if (map.id === 'floodline') layoutFloodline(layout)
  else if (map.id === 'relay-works') layoutRelayWorks(layout)
  else if (kind === 'ridge') {
    for (const [i, j] of roadPairs) {
      const a = sites[i],
        b = sites[j]
      const x1 = (a.x + b.x) * 0.5 + (i % 2 ? 8 : -10),
        z1 = (a.z + b.z) * 0.5 + (j % 2 ? 13 : -9)
      makeRoad(
        [
          [a.x, a.z],
          [lerp(a.x, x1, 0.52), lerp(a.z, z1, 0.52)],
          [x1, z1],
          [lerp(x1, b.x, 0.52), lerp(z1, b.z, 0.52)],
          [b.x, b.z],
        ],
        i === 3 || j === 3 ? 7.6 : 5.5,
        i === 3 || j === 3,
      )
    }
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i]
      const code = i % 3
      const wall = code === 0 ? 'siding' : code === 1 ? 'concrete' : 'plaster'
      for (const [dx, dz, w, d, h] of [
        [-16, -13, 11, 8, 4.25],
        [14, -18, 14, 10, 5.6],
        [-24, 16, 9, 7, 3.45],
        [19, 18, 9, 8, 4.7],
        [-33, -24, 8, 7, 3.6],
        [34, 26, 9, 7, 3.45],
      ]) {
        if (roadDistance(s.x + dx, s.z + dz) < 2.3) continue
        building(s.x + dx, s.z + dz, w, d, wall, {
          h,
          ladder: h > 4.1,
          warm: i % 2 === 0,
          big: h > 5,
        })
        spawns.push({ x: s.x + dx - 2, z: s.z + dz + 8 })
      }
      pickup('station', s.x + 6, s.z + 7)
      pickup('contract', s.x - 9, s.z + 9, {
        task: i % 2 ? 'scavenge' : 'recon',
        site: i,
      })
      pickup('plate', s.x - 4, s.z + 8, { amount: 2 })
      pickup('cash', s.x - 17, s.z - 7, { amount: 850 })
      pickup('crate', s.x + 29, s.z - 7)
      for (const [dx, dz] of [
        [28, 4],
        [-26, 5],
        [5, -31],
        [-34, 12],
        [26, -22],
        [-8, 22],
      ]) {
        if (roadDistance(s.x + dx, s.z + dz) > 1)
          concreteBlock(s.x + dx, s.z + dz, 2.7, 1.0, 0.92)
      }
      for (let j = 0; j < 4; j++) {
        const dx = (j % 2 ? 1 : -1) * (9 + j * 5),
          dz = (j < 2 ? -1 : 1) * (8 + j * 3)
        if (roadDistance(s.x + dx, s.z + dz) > -0.5) lamp(s.x + dx, s.z + dz)
      }
      if (i === 0 || i === 4 || i === 5)
        for (let j = 0; j < 7; j++) {
          const x = s.x + (j % 2 ? -1 : 1) * (20 + j * 3.3),
            z = s.z - 30 + (j % 3) * 9
          if (roadDistance(x, z) > 3.9)
            container(
              x,
              z,
              j % 2 ? 'x' : 'z',
              j % 3 === 0 ? 'rust' : j % 3 === 1 ? 'teal' : 'siding',
              j % 4 === 0,
            )
        }
      if (i === 2) {
        const tx = s.x + 8,
          tz = s.z - 37,
          y = height(tx, tz)
        for (const x of [-1, 1])
          for (const z of [-1, 1])
            box('trim', tx + x * 1.4, y, tz + z * 1.4, 0.17, 18, 0.17)
        for (let h = 1; h < 18; h += 2.6) {
          for (const k of [-1, 1]) {
            box('trim', tx, y + h, tz + k * 1.4, 2.88, 0.12, 0.13)
            box('trim', tx + k * 1.4, y + h, tz, 0.13, 0.12, 2.88)
          }
        }
        box('hazard', tx, y + 18, tz, 1.25, 0.2, 1.25)
        box('beacon', tx, y + 18.2, tz, 0.3, 0.34, 0.3)
        extras.push({ type: 'antenna', x: tx, y: y + 18.4, z: tz })
      }
      if (i === 0) {
        makeRoad(
          [
            [s.x - 24, s.z + 28],
            [s.x - 12, s.z + 79],
          ],
          12,
          true,
        )
        extras.push({
          type: 'windsock',
          x: s.x - 4,
          y: height(s.x - 4, s.z + 45),
          z: s.z + 45,
        })
      }
    }
    for (let i = 0; i < 480; i++) {
      const x = jitter(535),
        z = jitter(535),
        y = height(x, z)
      if (
        sites.some((s) => distance(s, { x, z }) < s.r * 0.86) ||
        roadDistance(x, z) < 1.8 ||
        y < 1.0
      )
        continue
      vegetation.push({
        type: rand() < 0.68 ? 'pine' : 'scrub',
        x,
        y,
        z,
        s: 0.6 + rand() * 1.35,
        ry: rand() * 6.28,
        tint: 0.72 + rand() * 0.45,
      })
      if (i % 7 === 0 && Math.hypot(x, z) < 398)
        prop(
          'stone',
          x + 0.6,
          z - 0.62,
          1.1 + rand() * 2,
          0.49 + rand() * 1.4,
          1.1 + rand() * 2,
        )
    }
    for (let i = 0; i < 75; i++) {
      const x = jitter(388),
        z = jitter(388)
      if (
        sites.some((s) => distance(s, { x, z }) < s.r) ||
        roadDistance(x, z) < 2
      )
        continue
      extras.push({
        type: 'rock',
        x,
        y: height(x, z) - 0.15,
        z,
        s: 0.6 + rand() * 2.1,
        ry: rand() * 6.28,
      })
    }
    for (const [x, z] of [
      [-74, 109],
      [88, -115],
      [125, 72],
      [-111, -98],
      [-195, 64],
      [84, 177],
      [295, 48],
    ]) {
      building(x, z, 7, 6, 'wood', { h: 3.15 })
      lamp(x - 5, z + 2, 4)
      pickup('plate', x - 4, z + 4, { amount: 1 })
      spawns.push({ x: x - 2, z: z + 8 })
    }
  } else if (kind === 'yard') {
    makeRoad(
      [
        [-54, 9],
        [-30, 9],
        [0, 7],
        [30, 8],
        [54, 8],
      ],
      8,
    )
    makeRoad(
      [
        [2, -54],
        [2, -24],
        [0, 7],
        [2, 33],
        [2, 54],
      ],
      7,
    )
    for (let row = -2; row <= 2; row++)
      for (let col = -2; col <= 2; col++) {
        if (
          (row === 0 && (col === -1 || col === 1)) ||
          (row === 1 && col === 0)
        )
          continue
        const x = col * 14 + (row % 2 ? 4 : -1),
          z = row * 13 - 3
        container(
          x,
          z,
          (row + col) % 2 ? 'x' : 'z',
          ['teal', 'rust', 'siding'][Math.floor(rand() * 3)],
          (row + col) % 3 === 2,
        )
        if ((row + col) % 2 === 0) concreteBlock(x + 3.7, z + 4, 1.9, 0.88, 1.1)
        if (col === -2 || col === 2) {
          lamp(x - 3, z + 4)
          spawns.push({ x: x + 2, z: z + 6 })
        }
      }
    building(-36, 5, 8, 12, 'siding', { h: 4.2, ladder: true, big: true })
    building(36, -9, 9, 13, 'concrete', { h: 4.8, ladder: true, warm: true })
    building(11, -40, 10, 8, 'plaster', { h: 4.4 })
    for (const x of [-45, 45])
      for (let z = -43; z <= 43; z += 10) rail(x, height(x, z), z, 8.8, 'z')
    for (const [x, z] of [
      [-22, 11],
      [0, -17],
      [23, -3],
      [2, 28],
      [-5, -42],
      [13, 21],
    ]) {
      pickup('plate', x, z, { amount: 2 })
      pickup('ammo', x + 2, z)
    }
    pickup('crate', -6, 4)
    pickup('box', 19, 20)
    pickup('satchel', -17, -16)
  } else {
    spawns.push({ x: 0, z: 13 })
    makeRoad(
      [
        [0, 26],
        [0, -52],
      ],
      20,
      false,
    )
    makeRoad(
      [
        [-36, 8],
        [37, 8],
      ],
      5,
      false,
    )
    for (let row = 0; row < 3; row++)
      for (const x of [-7.8, 0, 7.8]) {
        const z = -9 - row * 14 + (x !== 0 ? 1 : 0)
        targets.push({
          id: `target-${row}-${x}`,
          x,
          y: height(x, z) + 1.48 + (row === 2 ? 0.8 : 0),
          z,
          radius: row === 0 ? 0.56 : 0.45,
        })
        const ty = height(x, z)
        box(
          'metal',
          x,
          ty,
          z + 0.045,
          0.11,
          1.82 + (row === 2 ? 0.8 : 0),
          0.1,
          false,
        )
        box('dark', x, ty, z, 0.85, 0.13, 0.69)
      }
    for (const x of [-22, 20])
      for (let z = -42; z < 15; z += 7.5) rail(x, height(x, z), z, 6.5, 'z')
    building(-30, -13, 10.3, 9.4, 'plaster', {
      h: 4.25,
      ladder: true,
      warm: true,
    })
    building(29, -18, 12, 10, 'siding', { h: 5.3, ladder: true })
    container(29, 1, 'x', 'teal')
    container(30, -33, 'x', 'rust')
    for (const [x, z, w, h] of [
      [19, 4, 2.4, 0.62],
      [19, -2, 2.4, 1.22],
      [19, -8, 2.4, 2.02],
      [-16, -5, 2.4, 0.9],
      [-16, -18, 2.4, 1.25],
      [13, -20, 2.4, 1.4],
    ])
      concreteBlock(x, z, w, 1.25, h)
    for (const x of [-13, -7, 7, 13]) lamp(x, -41, 5.25)
    for (const x of [-12.1, 12.1])
      for (let z = -34; z <= 12; z += 3.4) {
        const y = height(x, z)
        box('hazard', x, y + 0.015, z, 0.105, 0.032, 1.63, false, 0.94)
      }
    for (const x of [-13.4, 13.4]) {
      const y = height(x, 5.6)
      box('wood', x, y + 0.84, 5.6, 2.7, 0.12, 1.25, true)
      for (const a of [-1, 1])
        for (const b of [-1, 1])
          box('dark', x + a * 1.13, y, 5.6 + b * 0.49, 0.092, 0.84, 0.092)
      box('greenmetal', x - 0.45, y + 0.96, 5.32, 0.68, 0.29, 0.52)
      box('greenmetal', x + 0.37, y + 0.96, 5.62, 0.55, 0.2, 0.45)
    }
    for (const x of [-18, 18, -39, 39]) lamp(x, 10, 4.5)
    for (let i = 0; i < 44; i++) {
      const x = jitter(71),
        z = -42 - rand() * 65
      extras.push({
        type: 'rock',
        x,
        y: height(x, z) - 0.25,
        z,
        s: 0.65 + rand() * 3.8,
        ry: rand() * 6.28,
      })
    }
    for (let i = 0; i < 74; i++) {
      const x = jitter(110),
        z = jitter(128)
      if (Math.abs(x) > 40 || z < -51)
        vegetation.push({
          type: i % 5 ? 'pine' : 'scrub',
          x,
          y: height(x, z),
          z,
          s: 0.8 + rand() * 1.2,
          ry: rand() * 6.28,
          tint: 0.82 + rand() * 0.25,
        })
    }
    pickup('plate', -1.65, 9.8, { amount: 3 })
    pickup('crate', 1.8, 9.6)
    pickup('ammo', -3.9, 9.25)
    pickup('satchel', 4.8, 9.0)
    pickup('box', 7.2, 8.95)
    pickup('cash', 8.9, 9.15, { amount: 3400 })
    pickup('station', 12, 10.65)
    pickup('contract', 13, -4, { task: 'recon', site: 0 })
    pickup('weapon', -4, 15.35, { weapon: 'viper' })
    pickup('weapon', 4.3, 15.35, { weapon: 'kestrel' })
    pickup('dummy', -7, 10)
    pickup('reset', -10.7, 10)
  }
  for (const v of vegetation)
    if (v.type === 'pine' && Math.abs(v.x) < half && Math.abs(v.z) < half)
      grid.add({
        x: v.x,
        z: v.z,
        y: v.y,
        w: v.s * 0.34,
        d: v.s * 0.34,
        h: v.s * 5.3,
      })
  for (const e of extras)
    if (e.type === 'rock' && Math.abs(e.x) < half && Math.abs(e.z) < half)
      grid.add({
        x: e.x,
        z: e.z,
        y: e.y,
        w: e.s * 1.29,
        d: e.s * 1.1,
        h: e.s * 0.81,
      })
  const world = {
    kind,
    map,
    relayPoints: map.id === 'relay-works' ? RELAY_WORKS_POINTS : null,
    seed,
    half,
    extent,
    height,
    grid,
    sites,
    boxes,
    vegetation,
    pickups,
    ladders,
    roads,
    spawns,
    targets,
    extras,
  }
  world.pads = layoutPads(world)
  world.staff = createStaff(world)
  if (WORLD_CACHE.size >= 7) WORLD_CACHE.delete(WORLD_CACHE.keys().next().value)
  WORLD_CACHE.set(key, world)
  return world
}

export function rayWorld(world, origin, direction, limit) {
  let hit = world.grid.rayHit(origin, direction, limit)
  // The solid heightfield is sampled along the shot and refined at the first crossing.
  for (let t = 0.22, prev = 0; t < hit; prev = t, t += 3.2) {
    if (
      origin.y + direction.y * t >
      world.height(origin.x + direction.x * t, origin.z + direction.z * t)
    )
      continue
    let a = prev,
      b = t
    for (let k = 0; k < 6; k++) {
      const m = (a + b) / 2
      if (
        origin.y + direction.y * m >
        world.height(origin.x + direction.x * m, origin.z + direction.z * m)
      )
        a = m
      else b = m
    }
    hit = b
    break
  }
  return hit
}
