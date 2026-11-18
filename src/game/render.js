import * as T from 'three'
import { QUALITY } from '../config.js'
import { eyeHeight, forward, yawWrap } from './movement.js'
import { clamp, lerp, planeAt, rayWorld } from './world.js'
import { disposeScene } from './graphics.js'
import { Environment } from './environment.js'
import { Aircraft, Effects, FieldObjects, Operators } from './objects.js'
import { ViewModel } from './viewmodel.js'
import { ModelPool } from './assets.js'
import { equippedSpec } from './loadout.js'
import { OperatorRigs } from './operator-rig.js'
import { FieldDressing } from './field-dressing.js'
import { SupportCrew } from './support-visuals.js'
import {
  CourseVisuals,
  LaunchVisuals,
  RelayVisuals,
  SmokeVisuals,
} from './field-effects.js'

const target = new T.Vector3(),
  tmp = new T.Vector3(),
  vec = new T.Vector3(),
  recoilDirection = new T.Vector3()
const RAD = Math.PI / 180

export class FieldRenderer {
  constructor(root, world, settings) {
    this.root = root
    this.world = world
    this.settings = settings
    this.aspect = 1.7
    this.sway = 0
    this.roll = 0
    this.recoil = 0
    this.aim = 0
    this.poseKey = null
    this.elapsed = 0
    const canvas = document.createElement('canvas')
    canvas.className = 'field-canvas'
    canvas.setAttribute('aria-label', '3D battlefield')
    canvas.tabIndex = 0
    const contextOptions = {
      antialias: settings.quality !== 'low',
      alpha: false,
      powerPreference:
        settings.quality === 'low' ? 'low-power' : 'high-performance',
      depth: true,
      stencil: false,
    }
    const context = canvas.getContext('webgl2', contextOptions)
    if (!context) throw new Error('This device does not have WebGL 2 enabled.')
    this.renderer = new T.WebGLRenderer({ canvas, context, ...contextOptions })
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.toneMapping = T.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.09
    this.renderer.shadowMap.type = T.PCFShadowMap
    this.renderer.autoClear = false
    this.renderer.setClearColor('#889da9')
    this.canvas = canvas
    root.prepend(canvas)
    this.scene = new T.Scene()
    this.scene.name = world.map.name
    this.camera = new T.PerspectiveCamera(
      65,
      1.7,
      0.062,
      QUALITY[settings.quality].draw,
    )
    this.camera.rotation.order = 'YXZ'
    this.view = new T.Scene()
    this.view.name = 'First-person rig'
    this.viewCam = new T.PerspectiveCamera(58, 1.7, 0.014, 6)
    this.view.add(new T.HemisphereLight('#d4eaff', '#a08e73', 2.23))
    const sun = new T.DirectionalLight('#ffe2bc', 2.06)
    sun.position.set(-3, 4, 1)
    this.view.add(sun)
    const rim = new T.DirectionalLight('#8baabd', 0.81)
    rim.position.set(2, 0, -4)
    this.view.add(rim)
    this.env = new Environment(this.scene, world, settings.quality)
    this.actors = new Operators(this.scene)
    this.supportCrew = new SupportCrew(this.scene, world)
    this.objects = new FieldObjects(this.scene, world)
    this.effects = new Effects(this.scene)
    if (world.kind === 'ridge') this.aircraft = new Aircraft(this.scene)
    this.models = new ModelPool()
    this.operatorRigs = new OperatorRigs(this.scene, this.models)
    this.dressing = new FieldDressing(this.scene, world, this.models)
    this.relays = new RelayVisuals(this.scene)
    this.smoke = new SmokeVisuals(this.scene)
    this.course = new CourseVisuals(this.scene)
    this.launchPads = new LaunchVisuals(this.scene, world.pads)
    this.viewmodel = new ViewModel(this.view, this.models)
    this.models.load(settings.weapon)
    this.sizeObserver = new ResizeObserver(() => this.resize())
    this.sizeObserver.observe(root)
    this.setSettings(settings)
    this.resize()
  }
  setSettings(settings) {
    this.settings = settings
    if (settings.quality !== this.quality) {
      this.quality = settings.quality
      const q = QUALITY[this.quality]
      this.renderer.shadowMap.enabled = q.shadows
      this.env.applyQuality(this.quality)
      this.camera.far = q.draw
      this.renderScale = this.pixelCap = Math.min(
        window.devicePixelRatio || 1,
        q.pixel,
      )
      this.slowFor = this.fastFor = 0
      this.renderer.setPixelRatio(this.renderScale)
      this.resize()
    }
  }
  resize() {
    const w = Math.max(1, this.root.clientWidth),
      h = Math.max(1, this.root.clientHeight)
    this.renderer.setSize(w, h, false)
    this.aspect = w / h
    this.camera.aspect = this.viewCam.aspect = this.aspect
    this.camera.updateProjectionMatrix()
    this.viewCam.fov = this.aspect < 1 ? 68 : 57
    this.viewCam.updateProjectionMatrix()
  }
  adaptResolution(fps, dt) {
    this.slowFor = fps < 43 ? this.slowFor + dt : 0
    this.fastFor = fps > 57 ? this.fastFor + dt : 0
    const floor = Math.min(
      this.pixelCap,
      this.quality === 'high' ? 0.77 : this.quality === 'low' ? 0.61 : 0.66,
    )
    let next = this.renderScale
    if (this.slowFor > 2.15 && next > floor) {
      next = Math.max(floor, next * 0.86)
      this.slowFor = 0
    } else if (this.fastFor > 8 && next < this.pixelCap) {
      next = Math.min(this.pixelCap, next * 1.1)
      this.fastFor = 0
    }
    if (next !== this.renderScale) {
      this.renderScale = next
      this.renderer.setPixelRatio(next)
      this.resize()
    }
  }
  shot(event, local) {
    this.effects.shot(event, local)
    if (local) {
      this.viewmodel.event(event)
      this.recoil = clamp(this.recoil + 0.0094, 0, 0.041)
    }
  }
  modelEvent(event) {
    this.viewmodel.event(event)
  }
  project(x, y, z) {
    recoilDirection.set(x, y, z).sub(this.camera.position)
    this.camera.getWorldDirection(tmp)
    if (recoilDirection.dot(tmp) < 0.06) return null
    vec.set(x, y, z).project(this.camera)
    if (vec.z > 1 || Math.abs(vec.x) > 1.12 || Math.abs(vec.y) > 1.12)
      return null
    return { x: (vec.x * 0.5 + 0.5) * 100, y: (0.5 - vec.y * 0.5) * 100 }
  }
  frame(snap, me, focus, look, dt, players) {
    const { camera } = this,
      p = focus ?? me
    if (!p) return
    const distanceLimit =
      this.quality === 'low' ? 175 : this.quality === 'high' ? 350 : 245
    const fp = (!focus || focus.id === me.id) && me.alive
    const plane = p.air === 'plane',
      cameraId = `${p.id}:${plane ? 'plane' : fp ? 'first' : 'spectator'}`
    const motion = this.settings.reducedMotion ? 0.14 : 1
    const blend =
      this.poseKey !== cameraId ? 1 : 1 - Math.exp(-dt * (fp ? 27 : 11))
    this.poseKey = cameraId
    this.elapsed += dt
    if (plane) {
      const a = planeAt(snap.time, this.world),
        f = forward(a.yaw),
        side = Math.cos(a.yaw),
        sz = -Math.sin(a.yaw)
      const bank = Math.sin(this.elapsed * 0.75) * 2.0 * motion
      camera.position.set(
        a.x - f.x * 25.7 + side * (10.5 + bank),
        a.y + 8.7,
        a.z - f.z * 25.7 + sz * (10.5 + bank),
      )
      camera.lookAt(a.x + f.x * 12.1, a.y - 7.8, a.z + f.z * 12.1)
    } else if (fp) {
      const yaw = look?.yaw ?? p.yaw,
        pitch = look?.pitch ?? p.pitch
      this.recoil *= Math.exp(-dt * 14)
      const f = forward(yaw),
        speed = Math.hypot(p.vx, p.vz),
        walk = p.grounded
          ? clamp(speed * 0.113, 0, 1.35) * (p.aim ? 0.3 : 1)
          : 0
      this.sway += dt * (speed > 7 ? 11.3 : 8.15)
      const bobX = Math.sin(this.sway * 0.5) * walk * 0.032 * motion,
        bobY = Math.sin(this.sway) * walk * 0.043 * motion
      target.set(
        p.x + Math.cos(yaw) * bobX,
        p.y + eyeHeight(p) + bobY - p.landing * 0.12 * motion,
        p.z - Math.sin(yaw) * bobX,
      )
      camera.position.lerp(target, blend)
      const lateral = p.vx * Math.cos(yaw) - p.vz * Math.sin(yaw)
      const chosen =
        (p.stance === 'slide' ? 0.072 : p.air === 'chute' ? 0.025 : 0) +
        lateral * 0.0019 +
        Math.sin(this.sway * 0.5) * walk * 0.009
      this.roll = lerp(this.roll, chosen, 1 - Math.exp(-dt * 10))
      camera.rotation.set(
        clamp(pitch + this.recoil * motion, -1.52, 1.52),
        yaw,
        this.roll * motion,
        'YXZ',
      )
    } else {
      const f = forward(p.yaw),
        offset = me.alive ? 4.6 : p.alive ? 4.6 : 7
      const o = { x: p.x, y: p.y + p.height + 0.32, z: p.z }
      const v = {
        x: -f.x * 0.92 + Math.cos(p.yaw) * 0.23,
        y: 0.38,
        z: -f.z * 0.92 - Math.sin(p.yaw) * 0.23,
      }
      const dist = Math.max(0.32, rayWorld(this.world, o, v, offset) - 0.23)
      target.set(o.x + v.x * dist, o.y + v.y * dist, o.z + v.z * dist)
      camera.position.lerp(target, blend)
      camera.lookAt(p.x + f.x * 4, p.y + p.height * 0.73, p.z + f.z * 4)
    }
    this.aim = lerp(
      this.aim,
      fp && p.air === 'ground' && me.aim ? 1 : 0,
      1 - Math.exp(-dt * 12),
    )
    const horizontal =
      clamp(
        this.settings.fov +
          (fp && me.sprinting ? 3.1 : 0) +
          (fp && me.tactical > 0 ? 3.4 : 0),
        65,
        108,
      ) -
      this.aim *
        ((me.weapon === 'kestrel' ? 28 : me.weapon === 'spectre' ? 14 : 20) +
          (equippedSpec(me).aimZoom ?? 0))
    const fov = clamp(
      (2 *
        Math.atan(
          Math.tan(horizontal * RAD * 0.5) / Math.max(0.89, this.aspect),
        )) /
        RAD,
      30,
      78,
    )
    if (Math.abs(camera.fov - fov) > 0.02) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    camera.updateMatrixWorld()
    this.env.update(camera, snap, dt, this.settings.weather, p)
    const population = players.concat(this.supportCrew.update(p, snap.time, dt))
    const imported = this.operatorRigs.update(
      population,
      camera,
      me,
      fp ? me.id : null,
      snap.time,
      dt,
      this.quality,
    )
    this.actors.update(
      population,
      camera,
      fp ? me.id : null,
      me,
      snap.time,
      distanceLimit,
      imported,
    )
    this.dressing.update(camera, this.quality)
    this.relays.update(snap.control, me, camera, snap.time, this.quality)
    this.launchPads.update(camera, snap.time, this.quality)
    this.smoke.update(snap.fields ?? [], camera, snap.time, this.quality)
    this.course.update(snap.training, snap.time)
    this.objects.update(snap, camera, me, this.quality)
    this.effects.update(dt)
    this.aircraft?.update(snap.time, plane, this.world)
    this.viewmodel.update(
      fp && !plane ? me : null,
      dt,
      snap.time,
      this.aspect,
      this.settings.reducedMotion,
    )
    const r = this.renderer
    r.clear()
    r.render(this.scene, camera)
    if (fp && !plane) {
      r.clearDepth()
      r.render(this.view, this.viewCam)
    }
  }
  dispose() {
    this.sizeObserver.disconnect()
    this.operatorRigs.dispose()
    this.dressing.dispose()
    this.viewmodel.dispose()
    this.smoke.dispose()
    this.models.dispose()
    this.objects.dispose()
    disposeScene(this.scene, this.view)
    this.env.dispose()
    this.env.sun.shadow.map?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
  }
}
