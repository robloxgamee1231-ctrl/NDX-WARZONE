import * as T from 'three'
import { box, canvasTexture, material, mesh } from './graphics.js'
import { clamp, randomSource, smooth } from './world.js'

const ALLEGIANCE = {
  ally: '#6cdfe8',
  hostile: '#f47e5f',
  neutral: '#d7c486',
  contested: '#f1c465',
}
const v = new T.Vector3()
const pose = new T.Object3D()

function relayTower(scene, r) {
  const g = new T.Group()
  scene.add(g)
  g.position.set(r.x, r.y, r.z)
  const dark = material('#253940', 0.82, 0.18)
  const panel = material('#45545a', 0.7, 0.19)
  const frame = material('#626b62', 0.61, 0.4)
  const glow = new T.MeshBasicMaterial({ color: ALLEGIANCE.neutral })
  const bloom = new T.MeshBasicMaterial({
    color: ALLEGIANCE.neutral,
    transparent: true,
    opacity: 0.29,
    depthWrite: false,
    side: T.DoubleSide,
  })
  const base = mesh(
    new T.CylinderGeometry(0.55, 0.69, 0.15, 8),
    dark,
    g,
    0,
    0.08,
    0,
  )
  base.rotation.y = 0.39
  box(g, frame, 0.53, 0.31, 0.46, 0, 0.297, 0)
  box(g, panel, 0.61, 0.09, 0.52, 0, 0.497, 0)
  box(g, dark, 0.22, 1.78, 0.22, 0, 1.16, 0)
  box(g, frame, 0.4, 0.13, 0.29, 0, 1.42, 0)
  box(g, glow, 0.17, 0.88, 0.14, 0, 1.95, 0)
  for (const x of [-1, 1]) {
    const brace = box(g, panel, 0.115, 0.99, 0.1, x * 0.29, 0.61, 0.14)
    brace.rotation.z = x * 0.32
    box(g, glow, 0.104, 0.12, 0.078, x * 0.16, 0.309, 0.24)
  }
  const diamond = mesh(new T.OctahedronGeometry(0.34, 0), glow, g, 0, 2.7, 0)
  diamond.scale.set(1, 0.82, 1)
  const ring = mesh(
    new T.RingGeometry(r.radius - 0.1, r.radius, 72),
    bloom,
    g,
    0,
    0.13,
    0,
  )
  ring.rotation.x = -Math.PI / 2
  const scan = mesh(
    new T.CylinderGeometry(0.01, 0.31, 8, 8, 1, true),
    bloom,
    g,
    0,
    6.35,
    0,
  )
  scan.renderOrder = 2
  const decal = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#17262b'
    ctx.fillRect(0, 0, 128, 128)
    ctx.strokeStyle = '#66848c'
    ctx.lineWidth = 3
    ctx.strokeRect(5, 5, 118, 118)
    ctx.fillStyle = '#e7e8cd'
    ctx.textAlign = 'center'
    ctx.font = '700 84px monospace'
    ctx.fillText(r.id, 64, 94)
  })
  const plate = mesh(
    new T.PlaneGeometry(0.33, 0.33),
    new T.MeshBasicMaterial({ map: decal, side: T.DoubleSide }),
    g,
    0,
    0.997,
    0.121,
  )
  const fade = new T.MeshBasicMaterial({
    color: ALLEGIANCE.neutral,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    side: T.DoubleSide,
  })
  const chevron = mesh(new T.RingGeometry(0.44, 0.485, 6), fade, g, 0, 2.7, 0)
  chevron.rotation.y = Math.PI / 2
  return { g, glow, bloom, plate, diamond, ring, scan, fade, chevron }
}

export class RelayVisuals {
  constructor(scene) {
    this.scene = scene
    this.towers = new Map()
  }

  update(control, me, camera, time, quality) {
    if (!control) return
    for (const r of control.relays) {
      if (!this.towers.has(r.id))
        this.towers.set(r.id, relayTower(this.scene, r))
      const tower = this.towers.get(r.id)
      const state = r.contested
        ? 'contested'
        : r.owner === null
          ? 'neutral'
          : r.owner === me.team
            ? 'ally'
            : 'hostile'
      const shade = ALLEGIANCE[state]
      tower.glow.color.set(shade)
      tower.fade.color.set(shade)
      tower.bloom.color.set(shade)
      tower.bloom.opacity = r.contested
        ? 0.29 + 0.095 * Math.sin(time * 7.2)
        : r.claim !== null
          ? 0.41
          : 0.23
      tower.diamond.position.y = 2.7 + Math.sin(time * 2.6) * 0.105
      tower.diamond.rotation.y = time * 0.74 + r.x
      tower.chevron.rotation.y = Math.atan2(
        camera.position.x - r.x,
        camera.position.z - r.z,
      )
      tower.chevron.position.y = tower.diamond.position.y
      tower.scan.visible =
        quality !== 'low' && (r.contested || r.claim !== null)
      tower.scan.scale.y = 0.72 + r.progress * 0.28
      tower.ring.visible =
        camera.position.distanceToSquared(tower.g.position) < 90 ** 2
    }
  }
}

function smokeTexture() {
  return canvasTexture(96, 96, (ctx, w, h) => {
    const rnd = randomSource(29481)
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 27; i++) {
      const a = rnd() * Math.PI * 2
      const out = Math.sqrt(rnd()) * 22
      const x = w / 2 + Math.cos(a) * out,
        y = h / 2 + Math.sin(a) * out
      const r = 10 + rnd() * 21
      const g = ctx.createRadialGradient(x, y, 1, x, y, r)
      g.addColorStop(0, `rgba(195,199,200,${0.13 + rnd() * 0.26})`)
      g.addColorStop(0.47, 'rgba(169,180,187,.22)')
      g.addColorStop(1, 'rgba(169,180,187,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
    }
  })
}

const SMOKE_BUDGET = {
  low: { groups: 4, puffs: 9 },
  balanced: { groups: 9, puffs: 16 },
  high: { groups: 16, puffs: 21 },
}
const PUFF_LIMIT = SMOKE_BUDGET.high.groups * SMOKE_BUDGET.high.puffs

export class SmokeVisuals {
  constructor(scene) {
    const geo = new T.PlaneGeometry(1, 1)
    geo.setAttribute(
      'opacityPerPuff',
      new T.InstancedBufferAttribute(new Float32Array(PUFF_LIMIT), 1).setUsage(
        T.DynamicDrawUsage,
      ),
    )
    const mat = new T.MeshBasicMaterial({
      map: smokeTexture(),
      transparent: true,
      color: '#d5dee0',
      opacity: 0.82,
      depthWrite: false,
    })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float opacityPerPuff;\nvarying float vPuff;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvPuff = opacityPerPuff;',
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPuff;')
        .replace(
          '#include <alphatest_fragment>',
          'diffuseColor.a *= vPuff;\n#include <alphatest_fragment>',
        )
    }
    this.batch = new T.InstancedMesh(geo, mat, PUFF_LIMIT)
    this.batch.frustumCulled = false
    this.batch.count = 0
    this.batch.instanceMatrix.setUsage(T.DynamicDrawUsage)
    this.batch.renderOrder = 6
    scene.add(this.batch)
    this.puffs = new Map()
  }

  getPuffs(id) {
    if (!this.puffs.has(id)) {
      const rng = randomSource(
        [...id].reduce((n, t) => (n * 31 + t.charCodeAt(0)) | 0, 213),
      )
      const puffs = Array.from({ length: SMOKE_BUDGET.high.puffs }, () => ({
        angle: rng() * 6.283,
        range: Math.sqrt(rng()),
        pitch: rng(),
        roll: rng() * 6.283,
        drift: 0.21 + rng() * 0.26,
        size: 3.0 + rng() * 2.6,
      }))
      this.puffs.set(id, puffs)
    }
    return this.puffs.get(id)
  }

  update(fields, camera, time, quality) {
    const budget = SMOKE_BUDGET[quality] ?? SMOKE_BUDGET.balanced
    const near = fields.filter(
      (f) =>
        time < f.until &&
        camera.position.distanceToSquared(v.set(f.x, f.y, f.z)) < 184 ** 2,
    )
    near.sort(
      (a, b) =>
        camera.position.distanceToSquared(v.set(b.x, b.y, b.z)) -
        camera.position.distanceToSquared(v.set(a.x, a.y, a.z)),
    )
    const alive = new Set(near.map((f) => f.id))
    for (const id of this.puffs.keys())
      if (!alive.has(id)) this.puffs.delete(id)
    const alpha = this.batch.geometry.attributes.opacityPerPuff
    let index = 0
    for (const f of near.slice(-budget.groups)) {
      const age = time - f.starts
      const soon = Math.max(0, age)
      const rise = smooth(0, 1.5, soon)
      const dissipate = smooth(0, 3.8, f.until - time)
      const phase = Math.min(soon, 12) * 0.42
      const puffs = this.getPuffs(f.id)
      for (let i = 0; i < budget.puffs; i++) {
        const p = puffs[i]
        const theta = p.angle + phase * 0.38
        const radial = f.r * p.range * (0.18 + rise * 0.61)
        pose.position.set(
          f.x + Math.cos(theta) * radial + soon * p.drift * 0.25,
          f.y + 0.6 + p.pitch * (1.5 + rise * 0.91),
          f.z + Math.sin(theta) * radial,
        )
        pose.quaternion.copy(camera.quaternion)
        pose.rotateZ(p.roll + phase * 0.27)
        pose.scale.setScalar(p.size * (0.52 + rise * 0.55 + phase * 0.035))
        pose.updateMatrix()
        this.batch.setMatrixAt(index, pose.matrix)
        alpha.setX(
          index++,
          Math.max(0.13, rise) * dissipate * (quality === 'low' ? 0.99 : 0.82),
        )
      }
    }
    this.batch.count = index
    this.batch.visible = index > 0
    this.batch.instanceMatrix.needsUpdate = alpha.needsUpdate = true
  }

  dispose() {
    this.batch.dispose()
  }
}

export class CourseVisuals {
  constructor(scene) {
    this.root = new T.Group()
    scene.add(this.root)
    this.root.visible = false
    const color = '#80e6e6'
    this.line = new T.MeshBasicMaterial({
      color,
      side: T.DoubleSide,
      transparent: true,
      opacity: 0.43,
      depthWrite: false,
    })
    this.arc = mesh(new T.RingGeometry(0.88, 1, 56), this.line, this.root)
    this.arc.rotation.x = -Math.PI / 2
    this.pillar = mesh(
      new T.CylinderGeometry(0.44, 0.82, 2.45, 32, 1, true),
      this.line,
      this.root,
      0,
      1.22,
      0,
    )
    const cap = new T.MeshBasicMaterial({ color, depthWrite: false })
    this.mark = mesh(
      new T.OctahedronGeometry(0.22, 0),
      cap,
      this.root,
      0,
      1.64,
      0,
    )
  }

  update(training, time) {
    this.root.visible =
      !!training?.point &&
      (training.state === 'countdown' || training.state === 'active')
    if (!this.root.visible) return
    const { x, y, z, r } = training.point
    const course = training.kind === 'course'
    this.root.position.set(
      x,
      y + (course ? 0.035 : -0.32),
      z + (course ? 0 : 0.21),
    )
    this.arc.visible = course
    this.arc.scale.setScalar(r ?? 0.6)
    this.pillar.visible = course
    this.mark.position.y = (course ? 1.82 : 1.02) + Math.sin(time * 6.2) * 0.071
    this.mark.rotation.y = time * 2.3
    this.line.opacity = clamp(0.26 + Math.sin(time * 4.5) * 0.16, 0.08, 0.49)
  }
}

export class LaunchVisuals {
  constructor(scene, pads = []) {
    this.pads = pads.map((p) => {
      const g = new T.Group()
      g.position.set(p.x, p.y + 0.015, p.z)
      g.rotation.y = p.yaw
      scene.add(g)
      const steel = material('#46575b', 0.78, 0.26)
      const dark = material('#28383e', 0.87, 0.14)
      const cool = new T.MeshBasicMaterial({
        color: '#7ccdd7',
        transparent: true,
        opacity: 0.83,
        depthWrite: false,
      })
      const base = mesh(
        new T.CylinderGeometry(1.12, 1.38, 0.19, 10),
        steel,
        g,
        0,
        0.095,
        0,
      )
      base.rotation.y = 0.312
      mesh(new T.CylinderGeometry(0.91, 1.02, 0.096, 10), dark, g, 0, 0.22, 0)
      const ring = mesh(new T.RingGeometry(0.76, 0.8, 48), cool, g, 0, 0.272, 0)
      ring.rotation.x = -Math.PI / 2
      const vent = new T.Group()
      g.add(vent)
      for (const x of [-1, 1]) {
        box(vent, dark, 0.21, 0.31, 1.35, x * 0.98, 0.2, 0)
        box(vent, steel, 0.22, 0.13, 1.09, x * 0.99, 0.41, 0)
        box(vent, cool, 0.104, 0.017, 0.71, x * 0.99, 0.482, 0)
      }
      const arrows = canvasTexture(128, 128, (ctx) => {
        ctx.strokeStyle = '#92d9d8'
        ctx.lineWidth = 8
        ctx.lineCap = 'square'
        for (const y of [56, 81, 106]) {
          ctx.beginPath()
          ctx.moveTo(39, y)
          ctx.lineTo(64, y - 21)
          ctx.lineTo(89, y)
          ctx.stroke()
        }
      })
      const decal = mesh(
        new T.PlaneGeometry(1.12, 1.12),
        new T.MeshBasicMaterial({
          map: arrows,
          transparent: true,
          depthWrite: false,
        }),
        g,
        0,
        0.274,
        0,
      )
      decal.rotation.x = -Math.PI / 2
      const plume = mesh(
        new T.CylinderGeometry(0.43, 0.62, 2.8, 10, 1, true),
        new T.MeshBasicMaterial({
          color: '#a8edff',
          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          opacity: 0.073,
        }),
        g,
        0,
        1.69,
        0,
      )
      return { p, g, cool, plume }
    })
  }

  update(camera, time, quality) {
    for (const { p, g, cool, plume } of this.pads) {
      const range = camera.position.distanceToSquared(g.position)
      g.visible = range < (quality === 'low' ? 85 : 175) ** 2
      if (!g.visible) continue
      cool.opacity = 0.57 + 0.31 * Math.sin(time * 2.55 + p.x)
      plume.visible = quality !== 'low' && range < 65 ** 2
      plume.material.opacity = 0.077 + 0.034 * Math.sin(time * 5 + p.z)
    }
  }
}
