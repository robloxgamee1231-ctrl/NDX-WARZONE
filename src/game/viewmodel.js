import * as T from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { WEAPONS } from '../config.js'
import {
  animateWeapon,
  applyWeaponFinish,
  disposeWeapon,
  mountWeapon,
} from './weapon-models.js'
import { equippedSpec, finishForWeapon } from './loadout.js'
import { clamp, lerp, smooth } from './world.js'
import { box, canvasTexture, material, mesh, surface } from './graphics.js'

const roundBox = (group, mat, w, h, d, r, x = 0, y = 0, z = 0) =>
  mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat, group, x, y, z)
function cyl(
  group,
  mat,
  top,
  bottom,
  length,
  x,
  y,
  z,
  axis = 'z',
  segments = 12,
) {
  const m = mesh(
    new T.CylinderGeometry(top, bottom, length, segments),
    mat,
    group,
    x,
    y,
    z,
  )
  if (axis === 'z') m.rotation.x = Math.PI / 2
  if (axis === 'x') m.rotation.z = Math.PI / 2
  return m
}
function makeHand(parent, sign, pal) {
  const g = new T.Group()
  parent.add(g)
  const { cloth, cuff, glove, knuckle, skin, clip } = pal
  const wrist = roundBox(
    g,
    cloth,
    0.104,
    0.107,
    0.235,
    0.02,
    sign * 0.019,
    -0.004,
    0.113,
  )
  wrist.rotation.y = sign * 0.16
  roundBox(g, cuff, 0.109, 0.111, 0.052, 0.011, sign * 0.007, -0.002, 0.039)
  box(g, clip, 0.066, 0.016, 0.055, sign * 0.015, 0.056, 0.052)
  const palm = roundBox(g, glove, 0.091, 0.077, 0.105, 0.015, 0, 0.004, -0.021)
  palm.rotation.y = sign * 0.09
  roundBox(g, knuckle, 0.076, 0.03, 0.053, 0.007, sign * 0.006, 0.046, -0.029)
  const fingers = []
  for (let i = 0; i < 4; i++) {
    const fx = (i - 1.5) * 0.02
    const digit = new T.Group()
    digit.position.set(fx, 0.001, -0.061)
    g.add(digit)
    roundBox(digit, glove, 0.019, 0.036, 0.042, 0.007, 0, -0.002, -0.016)
    const tip = roundBox(
      digit,
      i === 0 ? skin : glove,
      0.018,
      0.032,
      0.034,
      0.006,
      0,
      -0.016,
      -0.036,
    )
    tip.rotation.x = -0.4
    box(digit, knuckle, 0.015, 0.006, 0.025, 0, 0.016, -0.024)
    digit.rotation.x = -0.28 - i * 0.07
    digit.rotation.y = (i - 1.5) * 0.025
    fingers.push(digit)
  }
  const thumb = roundBox(
    g,
    glove,
    0.026,
    0.033,
    0.075,
    0.011,
    sign * 0.051,
    -0.008,
    -0.036,
  )
  thumb.rotation.y = sign * 0.53
  thumb.rotation.x = -0.15
  return { g, fingers }
}
export class ViewModel {
  constructor(scene, pool) {
    this.scene = scene
    this.pool = pool
    this.current = null
    this.kick = 0
    this.flash = 0
    this.aim = 0
    this.plateWeight = 0
    this.plateT = 0
    this.insertAfter = 1
    this.sprint = 0
    this.tactical = 0
    this.reload = 0
    this.boxTime = 0
    this.phase = 0
    this.pose = new T.Vector3(0.242, -0.252, -0.64)
    const mach = surface('metal', '#a8acac', 234)
    const fabric = surface('wood', '#acb1a7', 724)
    this.pal = {
      receiver: material('#596367', 0.61, 0.45, mach),
      steel: material('#3b474d', 0.55, 0.48, mach),
      rail: material('#676d68', 0.53, 0.49),
      dark: material('#252d31', 0.67, 0.35),
      groove: material('#242d30', 0.79, 0.13),
      gasket: material('#373a34', 0.77, 0.1),
      bolt: material('#7b8279', 0.41, 0.71),
      brass: material('#a1844e', 0.42, 0.61),
      optic: material('#27373b', 0.42, 0.43),
      glass: new T.MeshBasicMaterial({
        color: '#86c1cd',
        opacity: 0.12,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
      }),
      dot: new T.MeshBasicMaterial({ color: '#fda264', depthTest: true }),
      cloth: material('#5d6459', 0.93, 0, fabric),
      cuff: material('#4f5446', 0.96, 0, fabric),
      glove: material('#343b39', 0.83, 0, fabric),
      knuckle: material('#4e5650', 0.78, 0.07),
      skin: material('#655b4d', 0.86, 0.0),
      clip: material('#696f62', 0.63, 0.16),
    }
    this.light = new T.PointLight('#ffb767', 0, 2.1)
    scene.add(this.light)
    this.models = new Map()
    this.buildPlate()
    this.buildAir()
  }
  buildWeapon(id) {
    const p = this.pal,
      long = id === 'kestrel' || id === 'bulwark',
      short = id === 'viper' || id === 'mistral',
      len = long ? 1.12 : short ? 0.68 : 0.85
    const root = new T.Group(),
      gun = new T.Group()
    root.add(gun)
    this.scene.add(root)
    roundBox(gun, p.receiver, 0.125, 0.131, 0.44, 0.011, 0, 0.005, -0.153)
    roundBox(gun, p.steel, 0.136, 0.102, 0.39, 0.012, 0, 0.065, -0.24)
    roundBox(gun, p.dark, 0.105, 0.115, 0.21, 0.013, 0, -0.035, 0.115)
    roundBox(gun, p.gasket, 0.155, 0.157, 0.092, 0.016, 0, -0.045, 0.256)
    box(gun, p.rail, 0.105, 0.04, 0.139, 0, 0.026, 0.143)
    box(gun, p.groove, 0.141, 0.067, 0.164, 0, -0.123, 0.144)
    roundBox(
      gun,
      p.dark,
      0.061,
      0.199,
      0.085,
      0.012,
      0,
      -0.138,
      0.016,
    ).rotation.x = -0.22
    box(gun, p.rail, 0.085, 0.038, 0.135, 0, -0.102, -0.055)
    box(gun, p.dark, 0.067, 0.092, 0.019, 0, -0.126, 0.017)
    box(gun, p.rail, 0.086, 0.024, 0.128, 0, -0.167, -0.047)
    const foreLength = long ? 0.49 : short ? 0.265 : 0.371
    roundBox(
      gun,
      p.receiver,
      0.112,
      0.111,
      foreLength,
      0.013,
      0,
      0.023,
      -0.323 - foreLength * 0.5,
    )
    roundBox(
      gun,
      p.steel,
      0.101,
      0.099,
      foreLength - 0.04,
      0.012,
      0,
      -0.01,
      -0.341 - foreLength * 0.5,
    )
    const bar = cyl(gun, p.dark, 0.021, 0.026, len * 0.68, 0, 0.042, -len * 0.7)
    bar.rotation.x = Math.PI / 2
    cyl(
      gun,
      p.steel,
      long ? 0.031 : 0.027,
      long ? 0.032 : 0.033,
      long ? 0.14 : 0.1,
      0,
      0.043,
      -len,
    )
    cyl(gun, p.dark, 0.025, 0.025, 0.012, 0, 0.043, -len - 0.051)
    for (let i = 0; i < (short ? 4 : 7); i++) {
      const z = -0.365 - (i * (foreLength - 0.08)) / (short ? 4 : 7)
      for (const s of [-1, 1]) {
        box(gun, p.groove, 0.012, 0.028, 0.032, s * 0.056, 0.034, z)
        box(gun, p.bolt, 0.015, 0.006, 0.028, s * 0.056, 0.05, z)
      }
    }
    box(
      gun,
      p.rail,
      0.085,
      0.025,
      foreLength + 0.26,
      0,
      0.121,
      -0.246 - foreLength * 0.33,
    )
    for (let i = 0; i < 12; i++)
      box(
        gun,
        p.dark,
        0.097,
        0.015,
        0.025,
        0,
        0.137,
        -0.055 - i * (0.027 + (long ? 0.021 : 0)),
      )
    for (const side of [-1, 1]) {
      const plate = box(
        gun,
        p.steel,
        0.014,
        0.059,
        0.209,
        side * 0.067,
        0.034,
        -0.142,
      )
      plate.rotation.y = side * 0.015
      box(gun, p.groove, 0.014, 0.027, 0.115, side * 0.074, 0.043, -0.229)
      box(gun, p.bolt, 0.013, 0.018, 0.096, side * 0.079, 0.043, -0.22)
      for (const z of [0.025, -0.073, -0.319])
        cyl(gun, p.bolt, 0.008, 0.008, 0.01, side * 0.073, 0.013, z, 'x', 7)
      box(gun, p.brass, 0.016, 0.015, 0.037, side * 0.07, -0.008, -0.043)
    }
    const decal = canvasTexture(256, 64, (ctx) => {
      ctx.clearRect(0, 0, 256, 64)
      ctx.fillStyle = '#d1d9cb'
      ctx.font = '700 28px monospace'
      ctx.fillText('NDX / ' + WEAPONS[id].name, 10, 29)
      ctx.font = '16px monospace'
      ctx.fillStyle = '#aaa996'
      ctx.fillText(`TACTICAL  ·  ${WEAPONS[id].caliber}`, 10, 53)
    })
    const label = mesh(
      new T.PlaneGeometry(0.148, 0.037),
      new T.MeshBasicMaterial({
        map: decal,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      }),
      gun,
      0.074,
      -0.011,
      -0.121,
    )
    label.rotation.y = Math.PI * 0.5
    const mag = new T.Group()
    gun.add(mag)
    mag.position.set(0, -0.078, -0.229)
    mag.rotation.x = 0.2
    const mh = short ? 0.235 : long ? 0.139 : 0.188
    roundBox(mag, p.steel, 0.068, mh, 0.104, 0.008, 0, -mh * 0.5, 0)
    roundBox(mag, p.dark, 0.084, 0.027, 0.118, 0.007, 0, -mh - 0.008, 0.003)
    for (const s of [-1, 1])
      for (const z of [-0.032, 0, 0.031])
        box(mag, p.groove, 0.009, mh * 0.6, 0.011, s * 0.035, -mh * 0.55, z)
    box(mag, p.brass, 0.044, 0.013, 0.048, 0, 0.006, -0.006)
    const optic = new T.Group()
    gun.add(optic)
    optic.position.set(0, 0.14, -0.205)
    roundBox(
      optic,
      p.dark,
      0.103,
      0.039,
      long ? 0.185 : 0.106,
      0.008,
      0,
      0.016,
      0,
    )
    const ringZ = long ? -0.071 : -0.009
    for (const s of [-1, 1])
      box(optic, p.optic, 0.019, 0.087, 0.034, s * 0.04, 0.072, ringZ)
    box(optic, p.optic, 0.098, 0.016, 0.035, 0, 0.113, ringZ)
    box(optic, p.rail, 0.075, 0.009, 0.04, 0, 0.043, ringZ)
    const lens = mesh(
      new T.PlaneGeometry(0.065, 0.066),
      p.glass,
      optic,
      0,
      0.076,
      ringZ - 0.002,
    )
    lens.rotation.x = 0.035
    mesh(
      new T.SphereGeometry(0.0024, 6, 4),
      p.dot,
      optic,
      0,
      0.076,
      ringZ + 0.01,
    )
    if (long) {
      for (const s of [-1, 1])
        box(optic, p.steel, 0.025, 0.049, 0.148, s * 0.038, 0.057, -0.055)
      box(optic, p.steel, 0.074, 0.019, 0.146, 0, 0.104, -0.057)
      box(optic, p.bolt, 0.042, 0.024, 0.042, 0, 0.121, -0.066)
    }
    const right = makeHand(root, -1, p),
      left = makeHand(root, 1, p)
    right.g.position.set(0.069, -0.128, 0.117)
    right.g.rotation.set(-0.2, -0.39, 0.46)
    left.g.position.set(-0.047, -0.045, -0.369)
    left.g.rotation.set(1.34, 0.14, -0.82)
    const sleeve = roundBox(
      root,
      p.cloth,
      0.159,
      0.142,
      0.278,
      0.036,
      -0.156,
      -0.133,
      -0.23,
    )
    sleeve.rotation.y = -0.57
    sleeve.rotation.x = -0.3
    const fore = roundBox(
      root,
      p.cloth,
      0.165,
      0.157,
      0.277,
      0.032,
      0.148,
      -0.193,
      0.24,
    )
    fore.rotation.y = 0.27
    fore.rotation.x = 0.37
    const flame = new T.Group()
    gun.add(flame)
    flame.position.set(0, 0.043, -len - 0.084)
    const fire = new T.MeshBasicMaterial({
      color: '#ffcf88',
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: T.AdditiveBlending,
    })
    const cone = mesh(
      new T.ConeGeometry(0.075, 0.29, 6, 1),
      fire,
      flame,
      0,
      0,
      -0.06,
    )
    cone.rotation.x = -Math.PI / 2
    const core = mesh(
      new T.IcosahedronGeometry(0.089, 0),
      new T.MeshBasicMaterial({
        color: '#fff1bc',
        transparent: true,
        opacity: 0.77,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
      flame,
      0,
      0,
      -0.02,
    )
    core.scale.set(0.71, 0.81, 1.34)
    flame.visible = false
    return { root, gun, mag, left, right, sleeve, fore, flame, short, long, mh }
  }
  buildPlate() {
    const p = this.pal,
      rig = (this.plate = new T.Group())
    this.scene.add(rig)
    const outline = new T.Shape()
    outline.moveTo(-0.16, -0.233)
    outline.lineTo(0.16, -0.233)
    outline.quadraticCurveTo(0.194, -0.226, 0.213, -0.19)
    outline.lineTo(0.213, 0.128)
    outline.quadraticCurveTo(0.207, 0.148, 0.192, 0.163)
    outline.lineTo(0.121, 0.224)
    outline.lineTo(-0.121, 0.224)
    outline.lineTo(-0.192, 0.163)
    outline.quadraticCurveTo(-0.207, 0.148, -0.213, 0.128)
    outline.lineTo(-0.213, -0.19)
    outline.quadraticCurveTo(-0.194, -0.226, -0.16, -0.233)
    outline.closePath()
    const geo = new T.ExtrudeGeometry(outline, {
      depth: 0.037,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.014,
      bevelSegments: 3,
      curveSegments: 7,
    })
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++)
      pos.setZ(
        i,
        pos.getZ(i) - Math.pow(Math.abs(pos.getX(i)) / 0.23, 2) * 0.033,
      )
    geo.computeVertexNormals()
    const board = material(
      '#3f4a50',
      0.84,
      0.08,
      surface('wood', '#b8c0c1', 716),
    )
    mesh(geo, board, rig)
    this.plate.visible = false
    for (const s of [-1, 1])
      box(rig, p.rail, 0.016, 0.28, 0.01, s * 0.166, -0.013, 0.032).rotation.z =
        s * 0.019
    const tex = canvasTexture(384, 512, (ctx) => {
      ctx.clearRect(0, 0, 384, 512)
      ctx.strokeStyle = '#c4d5d667'
      ctx.lineWidth = 3
      ctx.strokeRect(35, 30, 314, 447)
      ctx.fillStyle = '#a0c5ce'
      ctx.font = 'bold 28px monospace'
      ctx.fillText('NDX / ARMOR', 55, 103)
      ctx.fillStyle = '#a9b5b3'
      ctx.font = '17px monospace'
      ctx.fillText('CERAMIC COMPOSITE', 55, 142)
      ctx.fillText('STRIKE FACE', 55, 170)
      ctx.fillStyle = '#7a9a9c'
      ctx.fillRect(56, 218, 267, 3)
      ctx.fillRect(56, 289, 267, 2)
      ctx.font = '20px monospace'
      ctx.fillText('A-50     FIELD ISSUE', 55, 269)
      ctx.fillStyle = '#b7bbae'
      for (let x = 58; x < 172; x += 7)
        ctx.fillRect(x, 362, x % 13 > 4 ? 2 : 4, 36)
      ctx.font = '15px monospace'
      ctx.fillText('NZ-0701 / REV.C', 55, 438)
    })
    mesh(
      new T.PlaneGeometry(0.323, 0.387),
      new T.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.57,
        depthWrite: false,
      }),
      rig,
      0,
      -0.01,
      0.0495,
    )
    for (const s of [-1, 1]) {
      const hand = makeHand(rig, -s, p)
      hand.g.position.set(s * 0.211, -0.129, 0.027)
      hand.g.rotation.set(0.12, s * 0.49, s * -0.35)
      roundBox(
        rig,
        p.cloth,
        0.123,
        0.112,
        0.31,
        0.024,
        s * 0.275,
        -0.217,
        0.097,
      ).rotation.z = -s * 0.31
    }
  }
  buildAir() {
    this.air = new T.Group()
    this.scene.add(this.air)
    const p = this.pal
    this.airHands = []
    for (const s of [-1, 1]) {
      const hand = makeHand(this.air, -s, p)
      hand.g.position.set(s * 0.31, -0.28, -0.55)
      hand.g.rotation.set(-0.39, s * 0.38, -s * 0.67)
      const grip = roundBox(
        hand.g,
        p.rail,
        0.034,
        0.035,
        0.118,
        0.008,
        0,
        -0.021,
        -0.052,
      )
      grip.rotation.y = Math.PI / 2
      const strap = box(hand.g, p.cuff, 0.037, 0.46, 0.022, 0, 0.19, -0.047)
      strap.rotation.x = -0.21
      strap.name = 'strap'
      const sleeve = roundBox(
        hand.g,
        p.cloth,
        0.13,
        0.128,
        0.28,
        0.032,
        s * 0.017,
        -0.007,
        0.22,
      )
      sleeve.rotation.y = s * 0.09
      this.airHands.push({ hand, strap, grip, s })
    }
  }
  event(event) {
    const visual = this.models.get(event.weapon ?? this.current)?.visual
    if (event.type === 'reload') animateWeapon(visual, 'reload', 0.78)
    if (event.type === 'shot') {
      animateWeapon(visual, 'shot', 2.5)
      this.kick = Math.min(
        0.22,
        this.kick + (WEAPONS[event.weapon]?.kick ?? 0.031) * 1.63,
      )
      this.flash = 0.055
    }
    if (event.type === 'plateInsert') this.insertAfter = 0
    if (event.type === 'crate') this.boxTime = 0.35
  }
  update(p, dt, time, aspect, reduced) {
    const airMode =
      p?.air === 'chute' ||
      p?.air === 'freefall' ||
      p?.stance === 'mantle' ||
      p?.stance === 'climb'
    this.air.visible = !!airMode && p.alive
    if (airMode)
      for (const { hand, strap, grip, s } of this.airHands) {
        const chute = p.air === 'chute',
          reach = p.stance === 'mantle' || p.stance === 'climb'
        strap.visible = grip.visible = chute
        hand.g.position.set(
          s * (aspect < 1 ? 0.168 : 0.307) * (reach ? 0.76 : 1),
          reach
            ? -0.229 + Math.sin(time * 7 + s) * 0.106
            : chute
              ? -0.027
              : -0.213,
          -0.54 + (reach ? Math.sin(time * 8 + s) * 0.078 : 0),
        )
        hand.g.rotation.set(
          reach ? -1.24 : chute ? -0.91 : -0.19,
          s * 0.3,
          reach ? -0.29 * s : chute ? -0.28 * s : -s * 0.85,
        )
      }
    if (this.current && (!p || this.current !== p.weapon)) {
      const previous = this.models.get(this.current)
      if (previous) previous.root.visible = false
    }
    if (!p) {
      this.plate.visible = false
      return
    }
    const id = Object.hasOwn(WEAPONS, p.weapon) ? p.weapon : 'raven'
    if (!this.models.has(id)) this.models.set(id, this.buildWeapon(id))
    const w = this.models.get(id)
    this.current = id
    if (!w.visual) {
      const asset = this.pool.get(p.weapon)
      if (asset) w.visual = mountWeapon(asset, p.weapon, w)
      else this.pool.load(p.weapon)
    }
    applyWeaponFinish(w.visual, finishForWeapon(p.loadout, p.weapon), time)
    w.visual?.mixer?.update(dt)
    this.insertAfter = Math.min(1, this.insertAfter + dt * 3.4)
    const plateOn = p.plateActive || this.insertAfter < 0.52
    this.plateWeight = lerp(
      this.plateWeight,
      p.plateActive ? 1 : this.insertAfter < 0.52 ? 1 - this.insertAfter : 0,
      1 - Math.exp(-dt * 19),
    )
    const roll = p.plateActive
      ? clamp(p.plateProgress, 0, 1)
      : this.insertAfter < 0.52
        ? 0.84 + this.insertAfter * 0.3
        : this.plateT
    this.plateT = lerp(this.plateT, roll, 1 - Math.exp(-dt * 25))
    this.plate.visible =
      p.alive && p.air === 'ground' && this.plateWeight > 0.045 && !airMode
    if (this.plate.visible) {
      const lift = smooth(0, 0.42, this.plateT),
        insert = smooth(0.68, 1, this.plateT),
        sway = Math.sin(time * 6.3) * 0.002
      this.plate.position.set(
        0.018 + sway + 0.025 * (1 - lift),
        -0.624 + lift * 0.486 - insert * 0.356 - (1 - this.plateWeight) * 0.15,
        -0.61 + insert * 0.165,
      )
      this.plate.rotation.set(
        -0.52 * (1 - lift) + insert * 0.78,
        0.24 * (1 - lift) - insert * 0.07,
        -0.2 * (1 - lift) + insert * 0.095,
      )
      this.plate.scale.setScalar(aspect < 0.83 ? 0.79 : 1)
    }
    const on =
      p.alive &&
      !p.downed &&
      p.air === 'ground' &&
      !airMode &&
      this.plateWeight < 0.98
    w.root.visible = on
    this.kick *= Math.exp(-dt * 14)
    this.flash = Math.max(0, this.flash - dt)
    this.boxTime = Math.max(0, this.boxTime - dt)
    this.light.intensity = this.flash > 0 && on ? 2.1 : 0
    w.flame.visible = this.flash > 0 && on
    if (!on) return
    const speed = Math.hypot(p.vx, p.vz),
      step = p.grounded ? clamp(speed / 9, 0, 1.25) : 0
    this.phase += dt * (step > 0.8 ? 12.3 : 9.1)
    const bob = reduced ? 0.16 : 1,
      weight = 1 - Math.exp(-dt * 13)
    this.aim = lerp(this.aim, p.aim ? 1 : 0, weight)
    this.sprint = lerp(this.sprint, p.sprinting ? 1 : 0, weight)
    this.tactical = lerp(this.tactical, p.tactical > 0 ? 1 : 0, weight)
    const reloadT =
      p.reloadEnd > time
        ? clamp(
            (time - p.reloadStart) /
              Math.max(0.02, p.reloadEnd - p.reloadStart),
            0,
            1,
          )
        : 0
    const rl =
      reloadT > 0
        ? smooth(0.0, 0.22, reloadT) * (1 - smooth(0.76, 1, reloadT))
        : 0
    const magazine =
      reloadT > 0
        ? smooth(0.22, 0.43, reloadT) * (1 - smooth(0.49, 0.7, reloadT))
        : 0
    const narrower = clamp(aspect, 0.52, 1)
    const x =
      lerp(0.242 * narrower, 0, this.aim) +
      this.sprint * 0.057 * narrower -
      Math.sin(this.phase * 0.5) * step * 0.026 * bob * (1 - this.aim * 0.85) +
      this.tactical * 0.046 * narrower +
      rl * 0.03
    const swap = smooth(0, 0.27, Math.max(0, (p.swapReady ?? 0) - time))
    const zoom = equippedSpec(p).aimZoom ?? 0
    const y =
      lerp(-0.252, -(w.visual?.sight ?? 0.197) * 0.92, this.aim) -
      swap * 0.36 -
      this.sprint * 0.075 +
      this.tactical * 0.02 +
      Math.cos(this.phase) * step * 0.014 * bob * (1 - this.aim * 0.82) -
      this.plateWeight * 0.39 -
      rl * 0.05 -
      p.landing * 0.035 * bob -
      this.boxTime * 0.14
    const z =
      lerp(-0.637, -0.562, this.aim) +
      this.kick * 0.37 +
      swap * 0.15 +
      zoom * 0.002
    w.root.scale.setScalar(lerp(0.93, 0.91, this.aim))
    this.pose.lerp(position.set(x, y, z), weight)
    w.root.position.copy(this.pose)
    w.root.rotation.set(
      -this.sprint * 0.205 +
        this.tactical * 0.89 +
        rl * 0.36 +
        this.kick +
        0.052 * (p.stance === 'slide' ? -1 : 0),
      0.031 * (1 - this.aim) -
        this.sprint * 0.23 -
        this.tactical * 0.17 +
        rl * 0.37,
      -0.032 * (1 - this.aim) +
        this.sprint * 0.29 +
        rl * 0.55 +
        Math.sin(this.phase * 0.51) * step * 0.029 * bob +
        (p.stance === 'slide' ? -0.22 : 0),
    )
    if (w.visual) {
      w.visual.magazine.position.set(
        0.028 * magazine,
        -0.23 * magazine,
        0.09 * magazine,
      )
      w.visual.magazine.rotation.x = 0.44 * magazine
    }
    w.mag.position.set(
      0.02 * magazine,
      -0.078 - magazine * 0.237,
      -0.229 + 0.045 * magazine,
    )
    w.mag.rotation.x = 0.2 + 0.34 * magazine
    w.left.g.position.set(
      -0.047 - 0.046 * rl,
      -0.045 - 0.166 * rl - 0.097 * magazine,
      -0.369 + 0.158 * rl,
    )
    w.left.g.rotation.set(1.34 - 0.89 * rl, 0.14 + 0.67 * rl, -0.82 + 0.65 * rl)
    if (w.visual && p.weapon === 'spectre') {
      w.left.g.position.set(-0.029, -0.118 - 0.12 * rl, -0.092)
      w.left.g.rotation.set(0.91, 0.49, -0.57)
      w.right.g.position.set(0.047, -0.105, -0.047)
    }
    w.sleeve.position.set(
      -0.156 + 0.024 * rl,
      -0.133 - 0.135 * rl,
      -0.23 + 0.102 * rl,
    )
    w.right.fingers[0].rotation.x = -0.26 - this.kick * 2.4
    if (this.flash > 0) {
      w.flame.rotation.z = time * 37
      w.flame.scale.setScalar(0.75 + this.flash * 7.3)
    }
    this.light.position.set(
      this.pose.x,
      this.pose.y + 0.1,
      this.pose.z - (w.long ? 1 : 0.77),
    )
  }
  dispose() {
    for (const w of this.models.values())
      if (w.visual) {
        w.gun.add(w.flame)
        disposeWeapon(w.visual)
      }
  }
}
const position = new T.Vector3()
