import * as T from 'three'
import { LOOT, ROOM_LIMIT } from '../config.js'
import { crateHeight } from './reinforcements.js'
import { clamp, planeAt, smooth } from './world.js'
import {
  box,
  canvasTexture,
  cube,
  disposeScene,
  material,
  mesh,
  surface,
} from './graphics.js'

const position = new T.Vector3(),
  worldRot = new T.Quaternion(),
  localRot = new T.Quaternion(),
  localEuler = new T.Euler(),
  scale = new T.Vector3(),
  matrix = new T.Matrix4(),
  color = new T.Color()
const yawAxis = new T.Vector3(0, 1, 0),
  rootPos = new T.Vector3()

const FIELD_ACTOR_LIMIT = ROOM_LIMIT + 8

export class Operators {
  constructor(scene) {
    this.scene = scene
    const textile = surface('wood', '#c3c7bb', 331)
    const cloth = material('#4c5550', 0.98, 0, textile),
      cargo = material('#646951', 0.93, 0, textile),
      armor = material('#353e3d', 0.85, 0.03, textile)
    const dark = material('#283433', 0.78, 0.12),
      metal = material('#5a6764', 0.61, 0.26),
      visor = material('#344d54', 0.24, 0.36),
      rug = material('#4b5543', 0.84, 0, textile)
    const unit = cube(),
      ball = new T.SphereGeometry(0.5, 10, 7)
    this.parts = []
    const part = (
      geo,
      mat,
      x,
      y,
      z,
      w,
      h,
      d,
      limb = '',
      ax = 0,
      az = 0,
      team = false,
    ) => {
      const inst = new T.InstancedMesh(geo, mat, FIELD_ACTOR_LIMIT)
      inst.count = 0
      inst.frustumCulled = false
      scene.add(inst)
      inst.castShadow = true
      inst.receiveShadow = true
      inst.instanceMatrix.setUsage(T.DynamicDrawUsage)
      this.parts.push({ inst, x, y, z, w, h, d, limb, ax, az, team })
    }
    part(unit, cloth, 0, 1.06, 0, 0.48, 0.49, 0.26)
    part(unit, armor, 0, 1.19, -0.035, 0.448, 0.41, 0.2)
    part(unit, rug, 0, 1.1, 0.2, 0.43, 0.49, 0.24, '', 0.06)
    part(unit, metal, 0, 1.06, 0.34, 0.26, 0.19, 0.055)
    part(unit, dark, 0, 0.88, 0, 0.47, 0.12, 0.29)
    part(unit, rug, -0.123, 1.05, -0.171, 0.132, 0.209, 0.136)
    part(unit, rug, 0.11, 1.05, -0.172, 0.16, 0.214, 0.135)
    part(unit, armor, 0.039, 1.34, 0.06, 0.119, 0.13, 0.13)
    part(unit, metal, 0.148, 1.43, 0.18, 0.029, 0.41, 0.026)
    part(ball, dark, 0, 1.62, 0, 0.321, 0.385, 0.34, 'head')
    part(ball, metal, 0, 1.71, 0.023, 0.358, 0.258, 0.372, 'head', -0.12)
    part(unit, visor, 0, 1.646, -0.15, 0.301, 0.093, 0.078, 'head', -0.11)
    part(unit, armor, 0.153, 1.643, 0.018, 0.1, 0.174, 0.172, 'head')
    part(unit, metal, -0.138, 1.645, 0.016, 0.096, 0.123, 0.13, 'head')
    part(unit, dark, 0, 1.505, -0.108, 0.238, 0.103, 0.115, 'head')
    for (const side of [-1, 1]) {
      const suffix = side < 0 ? 'L' : 'R'
      part(
        ball,
        cloth,
        side * 0.281,
        1.281,
        0,
        0.215,
        0.213,
        0.225,
        `upper${suffix}`,
        0,
        -side * 0.14,
      )
      part(
        unit,
        cargo,
        side * 0.328,
        1.146,
        -0.043,
        0.173,
        0.285,
        0.176,
        `upper${suffix}`,
        -0.34,
        -side * 0.2,
      )
      part(
        unit,
        armor,
        side * 0.362,
        1.203,
        -0.074,
        0.105,
        0.109,
        0.13,
        `upper${suffix}`,
        -0.37,
        -side * 0.2,
        true,
      )
      part(
        unit,
        cloth,
        side * 0.26,
        1.072,
        -0.224,
        0.147,
        0.168,
        0.315,
        `arm${suffix}`,
        -0.12,
        -side * 0.15,
      )
      part(
        ball,
        dark,
        side * 0.181,
        1.08,
        -0.351,
        0.154,
        0.147,
        0.169,
        `arm${suffix}`,
        0,
        -side * 0.15,
      )
      part(
        unit,
        cargo,
        side * 0.13,
        0.669,
        0,
        0.223,
        0.386,
        0.234,
        `thigh${suffix}`,
        0.05,
      )
      part(
        unit,
        rug,
        side * 0.128,
        0.466,
        -0.056,
        0.183,
        0.168,
        0.17,
        `thigh${suffix}`,
        0,
      )
      part(
        unit,
        cloth,
        side * 0.13,
        0.264,
        0.018,
        0.181,
        0.37,
        0.189,
        `leg${suffix}`,
        -0.04,
      )
      part(
        unit,
        dark,
        side * 0.13,
        0.085,
        -0.061,
        0.202,
        0.144,
        0.29,
        `leg${suffix}`,
        0,
      )
    }
    part(unit, metal, 0.107, 1.13, -0.333, 0.083, 0.117, 0.344, 'gun', -0.03)
    part(unit, dark, 0.108, 1.144, -0.593, 0.058, 0.057, 0.309, 'gun', -0.035)
    part(unit, metal, 0.106, 1.044, -0.374, 0.057, 0.187, 0.111, 'gun', 0.18)
    const chuteMat = material(
      '#869574',
      0.87,
      0,
      surface('wood', '#c1cabc', 16),
    )
    chuteMat.side = T.DoubleSide
    const geo = new T.PlaneGeometry(4.7, 2.1, 16, 6)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i),
        um = x / 2.35,
        vv = y / 1.05
      pos.setXYZ(
        i,
        x,
        3.57 +
          (1 - um * um) * 0.86 +
          Math.sin(um * 36) * 0.047 +
          (1 - vv * vv) * 0.23,
        y * 0.94 + 0.21,
      )
    }
    geo.computeVertexNormals()
    part(geo, chuteMat, 0, 0, 0, 1, 1, 1, 'chute')
    const lineGeo = new T.CylinderGeometry(0.009, 0.009, 1, 4)
    for (const side of [-1, 1])
      for (const z of [-0.7, 0.9]) {
        const from = new T.Vector3(side * 0.23, 1.25, 0),
          to = new T.Vector3(side * 2.3, 3.64, z),
          dy = to.clone().sub(from)
        const q = new T.Quaternion().setFromUnitVectors(
          yawAxis,
          dy.clone().normalize(),
        )
        const g = lineGeo.clone().applyQuaternion(q)
        const mid = from.add(to).multiplyScalar(0.5)
        g.scale(dy.length(), dy.length(), dy.length())
        part(g, dark, mid.x, mid.y, mid.z, 1, 1, 1, 'chute')
      }
    lineGeo.dispose()
  }
  update(players, camera, hidden, own, time, limit, imported) {
    const visible = players.filter(
      (a) =>
        a.id !== hidden &&
        !imported?.has(a.id) &&
        a.alive &&
        a.air !== 'plane' &&
        Math.abs(a.x - camera.position.x) < limit &&
        Math.abs(a.z - camera.position.z) < limit,
    )
    const cap = Math.min(visible.length, FIELD_ACTOR_LIMIT)
    for (const part of this.parts) part.inst.count = 0
    for (let i = 0; i < cap; i++) {
      const p = visible[i],
        speed = Math.hypot(p.vx, p.vz),
        pace = clamp(speed / 6.9, 0.0, 1.25)
      const angle = time * (pace > 0.99 ? 12.2 : 9.1) + i * 2.425,
        stride = Math.sin(angle) * pace * 0.63
      const crouch = clamp((1.75 - p.height) / 0.72, 0, 1),
        moving = p.air === 'ground',
        slide = p.stance === 'slide'
      const lean = slide
        ? -0.61
        : p.stance === 'tactical'
          ? 0.28
          : moving
            ? pace * 0.064
            : 0.16
      worldRot.setFromAxisAngle(yawAxis, p.yaw)
      rootPos.set(p.x, p.y, p.z)
      for (const part of this.parts) {
        let px = part.x,
          py = part.y,
          pz = part.z,
          ax = part.ax,
          az = part.az
        const limb = part.limb
        if (
          (limb === 'chute' && p.air !== 'chute') ||
          (limb === 'gun' && p.npc)
        )
          continue
        if (limb !== 'chute') {
          py = py * (1 - crouch * 0.23) - crouch * 0.19
          if (moving) py += Math.abs(Math.sin(angle)) * pace * 0.025
          if (limb === 'head' || limb === 'gun') ax += -p.pitch * 0.46
          const side = limb.endsWith('L') ? -1 : 1
          if (limb.startsWith('thigh')) {
            ax += moving
              ? stride * side
              : Math.sin(time * 3.4 + i) * 0.35 - 0.19
            if (slide) {
              ax -= 0.98
              pz -= 0.13
            }
            pz += Math.sin(ax) * -0.214
          } else if (limb.startsWith('leg')) {
            ax += (moving ? stride * side * 0.81 : 0.38) + crouch * 0.28
            pz += Math.sin(ax) * -0.43
            if (slide) {
              ax -= 0.8
              pz -= 0.36
            }
          } else if (limb.startsWith('upper') || limb.startsWith('arm')) {
            ax += -p.pitch * 0.38 - stride * side * 0.12
            if (p.air !== 'ground') {
              az -= side * 0.49
              px += side * 0.11
              py += p.air === 'chute' ? 0.22 : 0.04
            }
          }
          if (py > 0.72) pz -= lean * (py - 0.6)
          ax += lean * 0.67
        }
        localEuler.set(ax, 0, az)
        localRot.setFromEuler(localEuler).premultiply(worldRot)
        position.set(px, py, pz).applyQuaternion(worldRot).add(rootPos)
        scale.set(part.w, part.h, part.d)
        matrix.compose(position, localRot, scale)
        const index = part.inst.count++
        part.inst.setMatrixAt(index, matrix)
        if (part.team) {
          color.set(p.uniform ?? (p.team === own?.team ? '#7dc8d4' : '#af7c52'))
          part.inst.setColorAt(index, color)
        }
      }
    }
    for (const part of this.parts) {
      part.inst.instanceMatrix.needsUpdate = true
      if (part.inst.instanceColor) part.inst.instanceColor.needsUpdate = true
    }
  }
}

export class Aircraft {
  constructor(scene) {
    const g = (this.g = new T.Group())
    scene.add(g)
    const body = material(
        '#6c7880',
        0.64,
        0.36,
        surface('metal', '#d2d6d4', 231),
      ),
      edge = material('#4a585e', 0.66, 0.4),
      dark = material('#303a3e', 0.57, 0.44),
      window = material('#405967', 0.26, 0.66)
    const pivot = mesh(
      new T.CylinderGeometry(1.76, 1.96, 16.8, 16),
      body,
      g,
      0,
      0,
      0.1,
    )
    pivot.rotation.x = Math.PI / 2
    const sphere = new T.SphereGeometry(1, 16, 12)
    const nose = mesh(sphere, body, g, 0, -0.13, -8.3)
    nose.scale.set(1.89, 1.66, 3.24)
    const cargo = mesh(sphere, body, g, 0, 0.19, 8.28)
    cargo.scale.set(1.77, 1.57, 3.21)
    let cockpit = mesh(sphere, window, g, 0, 1.04, -9.16)
    cockpit.scale.set(1.44, 0.68, 1.82)
    box(g, edge, 0.1, 0.55, 2.43, 0, 1.43, -9.1).rotation.x = 0.18
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++)
        box(g, edge, 0.055, 0.61, 0.19, side * 1.82, 0.19, i * 1.34 - 2.6)
      const shape = new T.Shape()
      shape.moveTo(0, -3.7)
      shape.lineTo(side * 13.3, 2.25)
      shape.lineTo(side * 15, 5.0)
      shape.lineTo(0, 2.1)
      shape.closePath()
      const wing = new T.ExtrudeGeometry(shape, {
        depth: 0.33,
        bevelEnabled: true,
        bevelSize: 0.17,
        bevelThickness: 0.087,
        bevelSegments: 1,
        steps: 1,
      })
      wing.rotateX(Math.PI / 2)
      mesh(wing, body, g, 0, 0.46, 0)
      const tailWing = box(g, body, 6.9, 0.22, 1.4, side * 2.83, 1.37, 7.6)
      tailWing.rotation.y = side * 0.39
      const wingtip = mesh(
        sphere,
        new T.MeshBasicMaterial({ color: side === 1 ? '#acc58b' : '#c5654c' }),
        g,
        side * 14.67,
        0.43,
        4.75,
      )
      wingtip.scale.set(0.12, 0.12, 0.2)
    }
    const tail = box(g, body, 0.32, 4.82, 3.51, 0, 2.27, 7.32)
    tail.rotation.x = 0.29
    box(g, edge, 0.34, 0.49, 3.02, 0, 4.7, 6.72).rotation.x = 0.28
    this.props = []
    for (const side of [-1, 1])
      for (const spread of [4.16, 8.5]) {
        const x = side * spread,
          z = (spread - 4.16) * 0.32 - 1.95
        const engine = mesh(sphere, edge, g, x, 0.02, z)
        engine.scale.set(0.79, 0.83, 1.96)
        const hub = mesh(sphere, dark, g, x, 0.02, z - 1.96)
        hub.scale.set(0.26, 0.26, 0.35)
        const prop = new T.Group()
        g.add(prop)
        prop.position.set(x, 0.02, z - 2.04)
        for (let j = 0; j < 4; j++) {
          const blade = new T.Group()
          prop.add(blade)
          blade.rotation.z = j * Math.PI * 0.5
          box(blade, dark, 0.18, 1.25, 0.05, 0, 0.64, 0)
          box(blade, edge, 0.18, 0.12, 0.058, 0, 1.26, 0)
        }
        this.props.push(prop)
      }
  }
  update(time, hasPlane, world) {
    const p = planeAt(time, world)
    this.g.visible = hasPlane || time < 18
    this.g.position.set(p.x, p.y - 0.78, p.z)
    this.g.rotation.y = p.yaw
    for (const [i, prop] of this.props.entries())
      prop.rotation.z = time * (i % 2 === 0 ? 23 : -24)
  }
}

function labelTexture(title, colorValue = '#81def0') {
  return canvasTexture(128, 64, (ctx) => {
    ctx.fillStyle = '#132327'
    ctx.fillRect(0, 0, 128, 64)
    ctx.strokeStyle = colorValue
    ctx.lineWidth = 2
    ctx.strokeRect(3, 3, 122, 58)
    ctx.fillStyle = colorValue
    ctx.font = '700 20px "Barlow Condensed", sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(title, 64, 28)
    ctx.fillStyle = '#98a9a7'
    ctx.font = '11px monospace'
    ctx.fillText('NDX / FIELD', 64, 46)
  })
}

export class FieldObjects {
  constructor(scene, world) {
    this.scene = scene
    this.world = world
    this.views = new Map()
    this.templates = new Map()
    this.targets = new Map()
    this.common = {
      dark: material('#354143', 0.81, 0.12),
      case: material('#566463', 0.82, 0.12, surface('metal', '#c9d0cd', 65)),
      edge: material('#73847d', 0.66, 0.26),
      strap: material('#303e3c', 0.89),
      steel: material('#a0a89b', 0.68, 0.19),
      green: material('#68745b', 0.92, 0, surface('wood', '#bfc4ba', 71)),
      cyan: new T.MeshBasicMaterial({ color: '#83dbe5' }),
      plate: material('#546674', 0.75, 0.29),
    }
    for (const t of world.targets) {
      const root = new T.Group()
      this.scene.add(root)
      root.position.set(t.x, t.y, t.z)
      const ring = (r, c, z) =>
        mesh(
          new T.CircleGeometry(t.radius * r, 26),
          new T.MeshStandardMaterial({
            color: c,
            roughness: 0.78,
            metalness: 0.18,
            side: T.DoubleSide,
          }),
          root,
          0,
          0,
          z,
        )
      ring(1, '#d0d8c4', 0.012)
      ring(0.83, '#465756', 0.019)
      ring(0.63, '#a8b09d', 0.026)
      ring(0.47, '#465756', 0.033)
      ring(0.28, '#ae6748', 0.039)
      const edge = mesh(
        new T.CylinderGeometry(t.radius + 0.033, t.radius + 0.033, 0.065, 24),
        this.common.dark,
        root,
        0,
        0,
        -0.034,
      )
      edge.rotation.x = Math.PI / 2
      this.targets.set(t.id, { t, root })
    }
    const beaconMat = new T.MeshBasicMaterial({
      color: '#f0d17e',
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      side: T.DoubleSide,
    })
    this.beam = mesh(
      new T.CylinderGeometry(0.115, 0.46, 12, 11, 1, true),
      beaconMat,
      scene,
    )
    this.beam.visible = false
    const foot = new T.RingGeometry(0.83, 1, 44)
    foot.rotateX(-Math.PI / 2)
    this.beamRing = mesh(foot, beaconMat, scene)
    this.beamRing.visible = false
  }
  template(type) {
    if (this.templates.has(type)) return this.templates.get(type)
    const grp = new T.Group(),
      c = this.common,
      tint = LOOT[type].color
    const emit = new T.MeshBasicMaterial({ color: tint })
    if (
      type === 'crate' ||
      type === 'box' ||
      type === 'refill' ||
      type === 'supply'
    ) {
      const large = type === 'crate' || type === 'supply',
        w = large ? 1.08 : 0.74,
        h = large ? 0.42 : 0.31,
        d = large ? 0.61 : 0.51
      box(grp, c.case, w, h, d, 0, h * 0.5, 0)
      box(grp, c.dark, w + 0.045, 0.084, d + 0.035, 0, 0.035, 0)
      const lid = new T.Group()
      lid.name = 'lid'
      lid.position.set(0, h, -d * 0.51)
      grp.add(lid)
      box(lid, c.dark, w + 0.12, 0.118, d + 0.097, 0, 0.04, d / 2)
      box(lid, c.edge, w - 0.03, 0.063, d - 0.018, 0, 0.121, d / 2)
      for (const side of [-1, 1]) {
        box(grp, c.strap, 0.104, h, d + 0.035, side * w * 0.34, h * 0.5, 0)
        box(
          lid,
          c.strap,
          0.095,
          0.134,
          d + 0.112,
          side * w * 0.34,
          0.089,
          d / 2,
        )
        box(
          grp,
          c.steel,
          0.088,
          0.14,
          0.062,
          side * w * 0.33,
          h * 0.87,
          d / 2 + 0.035,
        )
      }
      if (type === 'supply') {
        const stem = new T.Group()
        stem.name = 'delivery-chute'
        grp.add(stem)
        const cloth = new T.MeshStandardMaterial({
          color: '#829e9e',
          roughness: 0.89,
          side: T.DoubleSide,
        })
        const dome = mesh(
          new T.SphereGeometry(2.1, 16, 7, 0, Math.PI * 2, 0, 1.05),
          cloth,
          stem,
          0,
          3.15,
          0,
        )
        dome.scale.set(1, 0.58, 1)
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            const a = new T.Vector3(sx * 0.43, 0.34, sz * 0.27),
              b = new T.Vector3(sx * 1.17, 3.71, sz * 1.1)
            const delta = b.clone().sub(a),
              bar = mesh(
                new T.CylinderGeometry(0.015, 0.015, delta.length(), 5),
                c.strap,
                stem,
              )
            bar.position.copy(a).lerp(b, 0.5)
            bar.quaternion.setFromUnitVectors(yawAxis, delta.normalize())
          }
        const beam = mesh(
          new T.CylinderGeometry(0.022, 0.35, 11, 8, 1, true),
          new T.MeshBasicMaterial({
            color: '#86dae2',
            transparent: true,
            opacity: 0.2,
            depthWrite: false,
            side: T.DoubleSide,
          }),
          grp,
          0,
          6,
          0,
        )
        beam.name = 'delivery-beam'
        grp.scale.setScalar(1.25)
      }
      if (large || type === 'refill')
        box(grp, emit, w * 0.37, 0.038, 0.021, 0, h * 0.59, d * 0.515)
    } else if (type === 'plate') {
      const g = new T.Shape()
      g.moveTo(-0.18, -0.22)
      g.lineTo(0.18, -0.22)
      g.lineTo(0.23, -0.15)
      g.lineTo(0.23, 0.13)
      g.lineTo(0.132, 0.215)
      g.lineTo(-0.132, 0.215)
      g.lineTo(-0.23, 0.13)
      g.lineTo(-0.23, -0.15)
      g.closePath()
      const item = new T.Group()
      grp.add(item)
      item.rotation.x = 0.82
      item.position.y = 0.18
      mesh(
        new T.ExtrudeGeometry(g, {
          depth: 0.047,
          steps: 1,
          bevelEnabled: true,
          bevelThickness: 0.019,
          bevelSize: 0.022,
          bevelSegments: 2,
        }),
        c.plate,
        item,
      )
      box(item, emit, 0.236, 0.031, 0.01, 0, 0.016, 0.07)
      box(item, c.steel, 0.143, 0.016, 0.012, 0, -0.037, 0.068)
    } else if (type === 'satchel') {
      box(grp, c.green, 0.56, 0.49, 0.31, 0, 0.265, 0)
      box(grp, c.case, 0.53, 0.124, 0.347, 0, 0.52, 0.004)
      box(grp, c.strap, 0.394, 0.24, 0.073, 0, 0.238, 0.181)
      for (const sign of [-1, 1]) {
        box(grp, c.strap, 0.075, 0.462, 0.346, sign * 0.17, 0.274, 0.01)
        box(grp, c.steel, 0.089, 0.086, 0.037, sign * 0.17, 0.28, 0.204)
      }
      box(grp, emit, 0.21, 0.05, 0.055, 0, 0.48, 0.181)
    } else if (['tactical', 'mask', 'revive'].includes(type)) {
      const w = type === 'tactical' ? 0.24 : 0.38
      box(grp, c.dark, w, 0.28, 0.26, 0, 0.16, 0)
      box(grp, c.case, w + 0.03, 0.054, 0.29, 0, 0.316, 0)
      box(grp, emit, w * 0.52, 0.045, 0.024, 0, 0.192, 0.14)
      if (type === 'revive') box(grp, emit, 0.031, 0.13, 0.025, 0, 0.192, 0.14)
      for (const side of [-1, 1])
        box(grp, c.edge, 0.04, 0.18, 0.11, side * w * 0.49, 0.18, 0)
    } else if (type === 'cash') {
      for (let i = 0; i < 3; i++) {
        const t = box(
          grp,
          i % 2 ? c.steel : c.green,
          0.31,
          0.063,
          0.168,
          0,
          0.048 + i * 0.059,
          0,
        )
        t.rotation.y = (i - 0.6) * 0.21
      }
      box(grp, emit, 0.059, 0.195, 0.183, 0, 0.11, 0)
    } else if (type === 'ammo') {
      box(grp, c.green, 0.46, 0.15, 0.28, 0, 0.07, 0)
      for (let i = -2; i <= 2; i++) {
        box(grp, c.edge, 0.046, 0.069, 0.246, i * 0.07, 0.156, 0)
        box(grp, c.steel, 0.047, 0.064, 0.07, i * 0.07, 0.153, 0.106)
      }
      box(grp, emit, 0.19, 0.027, 0.017, 0, 0.079, 0.145)
    } else if (type === 'weapon') {
      box(grp, c.case, 0.18, 0.106, 0.61, 0, 0.135, 0)
      box(grp, c.dark, 0.069, 0.066, 0.88, 0, 0.16, -0.12)
      box(grp, c.edge, 0.064, 0.15, 0.146, 0, 0.095, 0.106)
      box(grp, emit, 0.11, 0.029, 0.19, 0, 0.188, -0.137)
      grp.rotation.y = -0.74
    } else if (type === 'contract') {
      const b = new T.Group()
      grp.add(b)
      b.position.y = 0.285
      b.rotation.x = -0.96
      box(b, c.dark, 0.42, 0.49, 0.076)
      box(b, emit, 0.29, 0.35, 0.011, 0, 0.011, 0.049)
      box(b, c.case, 0.31, 0.3, 0.02, 0, -0.019, 0.059)
      for (let i = 0; i < 3; i++)
        box(b, c.steel, 0.183, 0.014, 0.011, 0, 0.065 - 0.074 * i, 0.076)
    } else {
      const station = type === 'station'
      box(
        grp,
        c.dark,
        station ? 0.98 : 0.68,
        0.12,
        station ? 0.71 : 0.51,
        0,
        0.082,
        0,
      )
      box(grp, c.case, station ? 0.91 : 0.52, 0.76, 0.55, 0, 0.48, 0)
      box(grp, c.edge, station ? 1.03 : 0.65, 0.12, 0.64, 0, 0.901, 0.02)
      box(grp, c.dark, station ? 0.92 : 0.63, 0.503, 0.177, 0, 1.155, -0.178)
      const title = station
        ? 'BUY STATION'
        : type === 'dummy'
          ? 'DAMAGE TEST'
          : 'RANGE RESET'
      const tex = labelTexture(title, LOOT[type].hex)
      mesh(
        new T.PlaneGeometry(station ? 0.79 : 0.52, 0.355),
        new T.MeshBasicMaterial({ map: tex }),
        grp,
        0,
        1.178,
        -0.084,
      )
      box(grp, emit, station ? 0.46 : 0.32, 0.041, 0.031, 0, 0.784, 0.284)
      for (let i = -2; i <= 2; i++)
        box(grp, c.dark, 0.07, 0.081, 0.034, i * 0.082, 1.003, 0.161)
    }
    const marker = new T.Group()
    marker.name = 'marker'
    grp.add(marker)
    const jewel = mesh(
      new T.OctahedronGeometry(type === 'station' ? 0.13 : 0.09, 0),
      emit,
      marker,
    )
    jewel.scale.set(0.77, 1, 0.77)
    marker.position.y =
      type === 'station' || type === 'dummy' || type === 'reset'
        ? 1.73
        : type === 'crate' || type === 'refill'
          ? 0.82
          : 0.66
    this.templates.set(type, grp)
    return grp
  }
  update(snap, camera, me, quality) {
    const active = new Set(),
      max = quality === 'low' ? 42 : 68,
      time = snap.time
    for (const item of snap.loot.values()) {
      const center = item.type === 'supply' ? crateHeight(item, time) : item.y
      const limit = item.type === 'supply' ? 220 : max
      if (
        item.removed ||
        Math.hypot(item.x - camera.position.x, item.z - camera.position.z) >
          limit ||
        Math.abs(center - camera.position.y) > 86
      )
        continue
      active.add(item.id)
      let v = this.views.get(item.id)
      if (!v) {
        const root = this.template(item.type).clone(true)
        v = {
          root,
          lid: root.getObjectByName('lid'),
          marker: root.getObjectByName('marker'),
          chute: root.getObjectByName('delivery-chute'),
          beam: root.getObjectByName('delivery-beam'),
        }
        v.markerY = v.marker?.position.y ?? 0
        this.views.set(item.id, v)
        this.scene.add(root)
      }
      v.root.visible = true
      const bob = [
        'plate',
        'cash',
        'contract',
        'weapon',
        'ammo',
        'satchel',
      ].includes(item.type)
        ? Math.sin(time * 2.9 + item.x + item.z) * 0.071 + 0.087
        : 0
      v.root.position.set(item.x, center + bob, item.z)
      if (v.chute) {
        v.chute.visible = !!item.falling
        v.chute.rotation.z = Math.sin(time * 1.9) * 0.075
      }
      if (v.beam) v.beam.visible = !item.falling && !item.opened
      if (v.marker) {
        v.marker.visible =
          !item.opened &&
          !(
            item.type === 'refill' &&
            (item.team !== me?.team || item.usedBy?.includes(me?.id))
          )
        v.marker.rotation.y = time * 1.8 + item.x
        v.marker.position.y = v.markerY + Math.sin(time * 2.8 + item.z) * 0.044
      }
      if (v.lid) v.lid.rotation.x = item.opened ? -1.19 : 0
    }
    for (const [id, v] of this.views)
      if (!active.has(id)) {
        this.scene.remove(v.root)
        this.views.delete(id)
      }
    for (const { t, root } of this.targets.values()) {
      const delay = (snap.targetDown[t.id] ?? 0) - time
      root.visible =
        !snap.training ||
        snap.training.kind !== 'steel' ||
        ['failed', 'passed'].includes(snap.training.state) ||
        snap.training.target === t.id ||
        delay > 0
      root.rotation.x =
        delay > 0
          ? clamp(Math.min((1.23 - delay) * 12, delay * 9), 0, 1) * -1.34
          : 0
    }
    const c = me?.contract
    this.beam.visible = this.beamRing.visible = !!c
    if (c) {
      const h = this.world.height(c.x, c.z)
      this.beam.position.set(c.x, h + 6, c.z)
      this.beamRing.position.set(c.x, h + 0.14, c.z)
      this.beamRing.scale.setScalar(c.task === 'recon' ? 6.9 : 1.4)
      this.beam.material.opacity = 0.17 + Math.sin(time * 3.3) * 0.05
    }
  }
  dispose() {
    disposeScene(...this.templates.values())
  }
}

export class Effects {
  constructor(scene) {
    this.scene = scene
    this.list = []
    this.ge = new T.BufferGeometry()
    this.ge.setAttribute(
      'position',
      new T.BufferAttribute(new Float32Array(6 * 240), 3).setUsage(
        T.DynamicDrawUsage,
      ),
    )
    this.ge.setAttribute(
      'color',
      new T.BufferAttribute(new Float32Array(6 * 240), 3).setUsage(
        T.DynamicDrawUsage,
      ),
    )
    this.lines = new T.LineSegments(
      this.ge,
      new T.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.91,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    )
    this.lines.renderOrder = 5
    this.lines.frustumCulled = false
    scene.add(this.lines)
  }
  shot(e, local) {
    if (e.trace)
      this.list.push({
        begin: e.start,
        end: e.end,
        ttl: local ? 0.07 : 0.12,
        full: 0.12,
        energy: local ? 0.53 : 0.9,
      })
    if (e.impact)
      for (let i = 0; i < 4; i++) {
        const a = e.end,
          nx = (Math.random() - 0.5) * 0.41,
          nz = (Math.random() - 0.5) * 0.41,
          ny = Math.random() * 0.36
        this.list.push({
          begin: a,
          end: [a[0] + nx, a[1] + ny, a[2] + nz],
          ttl: 0.1 + Math.random() * 0.13,
          full: 0.2,
          energy: 1.1,
        })
      }
    if (this.list.length > 240) this.list.splice(0, this.list.length - 240)
  }
  update(dt) {
    this.list = this.list.filter((l) => (l.ttl -= dt) > 0)
    const p = this.ge.attributes.position,
      c = this.ge.attributes.color
    this.list.forEach((l, i) => {
      const a = l.energy * smooth(0, l.full, l.ttl)
      p.setXYZ(i * 2, ...l.begin)
      p.setXYZ(i * 2 + 1, ...l.end)
      c.setXYZ(i * 2, a, a * 0.63, a * 0.23)
      c.setXYZ(i * 2 + 1, a * 0.98, a * 0.79, a * 0.43)
    })
    this.ge.setDrawRange(0, this.list.length * 2)
    p.needsUpdate = c.needsUpdate = true
  }
}
