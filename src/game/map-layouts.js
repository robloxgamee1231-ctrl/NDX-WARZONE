// Authored NDX layouts. Terrain and solid geometry are built by the same
// generator on the server and in the browser; artwork has no collision role.
export const FLOODLINE_SITES = Object.freeze([
  { name: 'WEST PUMP', x: -119, z: -136, y: 5.6, r: 30 },
  { name: 'BREAKWATER', x: -189, z: 65, y: 8.4, r: 44 },
  { name: 'RIVER MARKET', x: -98, z: 181, y: 5.2, r: 36 },
  { name: 'EXCHANGE', x: 106, z: -101, y: 6.4, r: 39 },
  { name: 'SENSOR ARRAY', x: 186, z: 76, y: 8, r: 34 },
  { name: 'SPILLWAY DEPOT', x: 103, z: 176, y: 5.4, r: 35 },
  { name: 'LANTERN DOCK', x: 73, z: -219, y: 6.1, r: 32 },
])
export const FLOOD_CROSSINGS = Object.freeze([-153, -12, 126])
export const RELAY_WORKS_POINTS = Object.freeze([
  { id: 'A', title: 'North Yard', x: -14, z: -24 },
  { id: 'B', title: 'Turbine Hall', x: 0, z: 0 },
  { id: 'C', title: 'South Bay', x: 14, z: 24 },
])
export const RELAY_WORKS_SITES = Object.freeze([
  { name: 'RELAY WORKS', x: 0, z: 0, y: 1.15, r: 42 },
  { name: 'WEST SERVICE', x: -36, z: -18, y: 1.16, r: 9 },
  { name: 'EAST SERVICE', x: 36, z: 18, y: 1.16, r: 9 },
])
export const canalCenter = (z) => Math.sin(z * 0.0108) * 21 + z * 0.073

export function floodlineHeight(x, z, phase, smooth, lerp) {
  const canal = Math.abs(x - canalCenter(z))
  const bank = 4.72 + Math.sin(z * 0.019 + phase) * 0.23
  const bed = 0.55 + Math.cos(z * 0.029) * 0.24
  let y = lerp(bed, bank, smooth(9, 30, canal))
  y +=
    smooth(31, 61, canal) *
    (1.15 +
      Math.cos(x * 0.026 + z * 0.014) * 1.36 +
      Math.sin(z * 0.029 - x * 0.011 + phase) * 1.19)
  const rim = smooth(236, 427, Math.hypot(x * 0.93, z))
  y +=
    rim *
    smooth(30, 81, canal) *
    (25 + Math.sin(x * 0.046 - z * 0.018) * 11 + Math.cos(z * 0.036) * 7.1)
  for (const site of FLOODLINE_SITES) {
    if (
      Math.abs(x - site.x) > site.r + 20 ||
      Math.abs(z - site.z) > site.r + 20
    )
      continue
    y = lerp(
      site.y,
      y,
      smooth(site.r, site.r + 20, Math.hypot(x - site.x, z - site.z)),
    )
  }
  return y
}

function landSign(api, name, x, z, yaw, wide = 4.6) {
  const { height, extras, box } = api
  const y = height(x, z)
  extras.push({
    type: 'sector-sign',
    name,
    x,
    y: y + 2.45,
    z,
    yaw,
    width: wide,
  })
  for (const s of [-1, 1])
    box(
      'dark',
      x + Math.cos(yaw) * wide * 0.38 * s,
      y,
      z - Math.sin(yaw) * wide * 0.38 * s,
      0.13,
      2.4,
      0.13,
    )
}

function bridge(api, z, index) {
  const { height, box, rail, prop, concreteBlock, makeRoad, lamp } = api
  const cx = canalCenter(z),
    deck = 5.13
  box('deck', cx, deck - 0.36, z, 67, 0.36, 8.8, true)
  for (const side of [-1, 1]) {
    // Mid-channel clearance remains walkable under the crossing.
    box('deck', cx, deck - 0.5, z + side * 4.25, 66, 0.86, 0.25, true)
    for (const dx of [-23, 0, 23])
      rail(cx + dx, deck + 0.3, z + side * 4.26, 21, 'x')
    const x = cx + side * 33.3
    for (let j = 0; j < 3; j++) {
      const stepX = x + side * (j + 0.5) * 1.8
      const top = Math.max(height(stepX, z), deck - (j + 1) * 0.19)
      box(
        'deck',
        stepX,
        height(stepX, z) - 0.17,
        z,
        1.84,
        top - height(stepX, z) + 0.17,
        8.7,
        true,
      )
    }
    prop('signal', x + side * 3.5, z - 5.5, 0.57, 1.33, 0.57, false)
    lamp(x + side * 5.4, z + 6)
    concreteBlock(cx + side * 21.3, z - 2.7, 1.45, 1.7, 3.2)
  }
  for (const dx of [-28, -19, -10, -1, 8, 17, 26])
    box('hazard', cx + dx, deck + 0.018, z, 4.3, 0.019, 0.1)
  makeRoad(
    [
      [cx - 50, z],
      [cx - 31, z],
      [cx + 31, z],
      [cx + 50, z],
    ],
    7.8,
  )
  landSign(api, `CROSSING 0${index + 1}`, cx - 39, z - 6.7, 0, 4.3)
}

function pumpBank(api, site, variant) {
  const {
    box,
    prop,
    height,
    lamp,
    building,
    container,
    concreteBlock,
    pickup,
    makeRoad,
    spawns,
    rand,
  } = api
  const { x, z, name } = site
  makeRoad(
    [
      [x - 37, z + 13],
      [x + 36, z + 13],
    ],
    7.1,
  )
  makeRoad(
    [
      [x + 12, z - 31],
      [x + 12, z + 34],
    ],
    6.3,
    false,
  )
  const slate = ['indigo', 'siding', 'plaster', 'teal']
  building(
    x - 13,
    z - 8,
    variant % 2 === 0 ? 18 : 14,
    13,
    slate[variant % slate.length],
    { h: 5.65 + (variant % 3), big: true, ladder: true, warm: true },
  )
  building(x + 24, z - 17, 13, 12, slate[(variant + 2) % slate.length], {
    h: 4.15,
    big: true,
  })
  building(x - 24, z + 23, 9, 9.5, 'plaster', { h: 3.4, warm: true })
  for (const side of [-1, 1]) {
    const dx = x + side * 11,
      dz = z + 26
    container(
      dx,
      dz,
      side === -1 ? 'x' : 'z',
      side === -1 ? 'teal' : 'rust',
      variant % 3 === 0,
    )
    concreteBlock(x + side * 9, z + 18.2, 4, 1.02, 0.87)
    lamp(x + side * 28, z + 12.4, 6.8)
  }
  if (variant % 3 !== 1) {
    const tx = x + 24,
      tz = z + 24
    // Twin treatment towers with exposed bases and contrasting bands.
    for (const shift of [-3.5, 3.5]) {
      const y = height(tx + shift, tz)
      box('concrete', tx + shift, y, tz, 4.7, 1.02, 4.7, true)
      box('indigo', tx + shift, y + 1.02, tz, 3.9, 9.1, 3.9, true)
      box('trim', tx + shift, y + 10.12, tz, 4.36, 0.35, 4.36)
      for (const h of [2.3, 6.8])
        box('signal', tx + shift, y + h, tz, 4.1, 0.22, 4.1)
      box('light', tx + shift, y + 10.47, tz, 0.33, 0.54, 0.33)
    }
    box('deck', tx, height(tx, tz) + 7.78, tz, 7.4, 0.32, 1.7, true)
  } else {
    // Service stalls leave a broken, low-cover route toward the terminal.
    for (let i = 0; i < 3; i++) {
      const dx = x + 18 + i * 6.1
      prop(i % 2 ? 'teal' : 'rust', dx, z + 22, 4.6, 0.96, 2.3)
      box('deck', dx, height(dx, z + 22) + 2.4, z + 22, 5.5, 0.16, 3.1)
      for (const s of [-1, 1])
        prop('dark', dx + s * 2.18, z + 22, 0.1, 2.5, 0.1)
    }
  }
  landSign(api, name, x - 16, z + 8.3, 0, 5.25)
  pickup('station', x - 4, z + 20)
  pickup('contract', x + 5, z + 6.4, {
    task: variant % 2 ? 'recon' : 'scavenge',
    site: variant,
  })
  pickup('plate', x + 3.8, z - 4.4, { amount: 2 })
  pickup('crate', x + 28, z + 4)
  pickup('cash', x - 29, z - 9, { amount: 600 + Math.floor(rand() * 4) * 100 })
  spawns.push({ x: x - 7, z: z + 17 }, { x: x + 17, z: z - 4 })
}

export function layoutFloodline(api) {
  const {
    makeRoad,
    height,
    lamp,
    concreteBlock,
    container,
    roadDistance,
    vegetation,
    rand,
    extras,
  } = api
  const points = []
  for (let z = -365; z <= 365; z += 10) points.push([canalCenter(z), z])
  makeRoad(points, 23, false) // Concrete spillway floor on the chart and terrain.
  for (const s of [-1, 1]) {
    const levee = points.map(([x, z]) => [x + s * 39, z])
    makeRoad(levee, 6.8)
    for (let z = -272; z <= 271; z += 43) {
      const x = canalCenter(z) + s * 44
      if (FLOOD_CROSSINGS.some((m) => Math.abs(m - z) < 11)) continue
      lamp(x, z)
      if (z % 3) concreteBlock(x + s * 4.1, z - 3, 1.14, 4.85, 1.06)
    }
  }
  FLOOD_CROSSINGS.forEach((z, i) => bridge(api, z, i))
  for (const [i, site] of FLOODLINE_SITES.entries()) {
    const s = Math.sign(site.x),
      z = site.z + 13,
      bank = canalCenter(z) + s * 39
    makeRoad(
      [
        [bank, z - 15],
        [bank + s * 17, z],
        [site.x, z],
      ],
      7.25,
    )
    pumpBank(api, site, i)
  }
  // A few isolated facilities break up the stretches between districts.
  for (const [x, z] of [
    [-82, -55],
    [-139, 96],
    [100, -32],
    [143, 29],
    [215, -14],
    [-244, -74],
    [175, -172],
    [-149, 236],
  ]) {
    container(x, z, 'x', 'teal')
    concreteBlock(x - 4, z + 3, 2.8, 1.2, 0.89)
    api.pickup('crate', x + 2, z + 3)
    api.pickup('ammo', x - 1.8, z + 3)
  }
  for (let i = 0; i < 280; i++) {
    const x = (rand() * 2 - 1) * 400,
      z = (rand() * 2 - 1) * 400
    if (
      Math.abs(x - canalCenter(z)) < 49 ||
      roadDistance(x, z) < 2 ||
      FLOODLINE_SITES.some((s) => Math.hypot(s.x - x, s.z - z) < s.r + 2)
    )
      continue
    const y = height(x, z),
      scale = 0.65 + rand() * 1.55,
      ry = rand() * Math.PI * 2
    if (i % 7 === 0)
      extras.push({ type: 'rock', x, y: y - 0.3, z, s: scale * 1.5, ry })
    else
      vegetation.push({
        type: i % 4 ? 'scrub' : 'pine',
        x,
        y,
        z,
        s: scale,
        tint: 0.85 + rand() * 0.14,
        ry,
      })
  }
}

function stairsFromGround(api, x, direction, startZ, heightTop) {
  const { box, height } = api
  const y = height(x, startZ)
  const steps = 10
  const length = 6.62 / steps
  for (let i = 0; i < steps; i++) {
    const dz = startZ + direction * length * (i + 0.5)
    const h = ((i + 1) / steps) * (heightTop - y)
    box(
      i % 2 ? 'indigo' : 'deck',
      x,
      y - 0.1,
      dz,
      3.74,
      h + 0.1,
      length + 0.012,
      true,
    )
    for (const s of [-1, 1])
      box('rust', x + s * 1.86, y, dz, 0.1, h + 0.69, 0.095)
    box(
      'hazard',
      x,
      y + h + 0.01,
      dz - direction * (length / 2 - 0.05),
      3.66,
      0.023,
      0.07,
    )
  }
}

export function layoutRelayWorks(api) {
  const {
    box,
    height,
    prop,
    rail,
    building,
    container,
    concreteBlock,
    lamp,
    makeRoad,
    spawns,
    pickup,
  } = api
  const y = height(0, 0),
    roof = y + 7.56,
    deck = y + 2.76,
    walkwayX = 5.1
  makeRoad(
    [
      [-49, 0],
      [49, 0],
    ],
    9.1,
    false,
  )
  for (const side of [-1, 1]) {
    const z = side * 27
    makeRoad(
      [
        [-44, 9 * side],
        [-34, z],
        [34, z],
        [44, 9 * side],
      ],
      6.4,
      false,
    )
    for (const x of [-18.6, -5.7, 5.7, 18.6]) {
      box('trim', x, y, side * 9.7, 0.55, 7.56, 0.55, true)
      box('ember', x, roof - 0.5, 0, 0.44, 0.53, 21.1)
      box('light', x + 1.4, roof - 0.7, side * 6.8, 1.68, 0.1, 0.36)
    }
    for (const [x, wide] of [
      [-20, 7.3],
      [0, 15.9],
      [20, 7.3],
    ]) {
      box('indigo', x, y, side * 10.1, wide, 3.12, 0.42, true)
      box('tile', x, y + 3.12, side * 10.1, wide, 0.2, 0.47)
      box('warmglass', x, roof - 1.12, side * 10.1, wide, 1.09, 0.23)
    }
    box('roof', 0, roof, side * 6.45, 48.4, 0.23, 6.96, true)
    box('ember', 0, roof + 0.19, side * 10.05, 48.44, 0.44, 0.37)
    box('trim', 0, roof + 0.21, side * 2.92, 48.44, 0.31, 0.35)
    for (const x of [-20, 20]) lamp(x, side * 18, 4.5)
    const anchor = side * 30
    building(anchor, side * 15, 10.5, 8.8, side > 0 ? 'ember' : 'indigo', {
      loot: false,
      h: 4.1,
      big: true,
      warm: true,
    })
    concreteBlock(side * 31, side * 5.4, 1.26, 4.8, 0.93)
    concreteBlock(-side * 8.9, side * 15.6, 3.2, 0.93, 1.14)
    container(side * 23.6, -side * 28.9, 'z', side > 0 ? 'teal' : 'rust')
    for (const lane of [0, -18, 25, -12]) {
      spawns.push({ x: side * 39.1, z: lane * side, yaw: side * Math.PI * 0.5 })
    }
    pickup('plate', side * 33.4, -side * 19.8, { amount: 2 })
    pickup('ammo', side * 24.1, side * 13.8)
    pickup('box', side * 15.3, -side * 18.2)
    stairsFromGround(api, walkwayX, -side, side * 19.5, deck)
  }
  box('deck', walkwayX, deck - 0.22, 0, 3.8, 0.22, 26, true)
  for (const side of [-1, 1]) {
    for (const z of [-8.7, 0, 8.7])
      rail(walkwayX + side * 1.84, deck, z, 8.62, 'z')
    for (const z of [-11.8, 11.8])
      box('ember', walkwayX + side * 1.58, y, z, 0.18, deck - y, 0.18)
  }
  for (const [x, z] of [
    [-8.5, -4.4],
    [-8.5, 4.6],
    [12.5, -5.4],
    [15.9, 5.5],
  ]) {
    prop('teal', x, z, 2.52, 1.05, 2.1)
    box('deck', x, height(x, z) + 1.05, z, 2.62, 0.14, 2.18)
    box('signal', x, height(x, z) + 0.31, z + 1.058, 1.2, 0.12, 0.05)
  }
  pickup('crate', -13.6, 3.8)
  pickup('satchel', 19.1, -4.3)
  pickup('tactical', -3.5, 17.6)
  pickup('ammo', walkwayX, -0.4, { y: deck + 0.03 })
  landSign(api, 'TURBINE HALL', 0, 12.3, 0, 5.4)
  landSign(api, 'NORTH YARD', -11.9, -28.9, Math.PI, 4.5)
  landSign(api, 'SOUTH BAY', 11.9, 29.9, 0, 4.5)
}
