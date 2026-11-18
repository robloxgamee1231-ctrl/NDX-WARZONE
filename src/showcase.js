import * as T from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { ModelPool } from './game/assets.js'
import { finishStyle, operatorStyle } from './game/loadout.js'

const held = new Set([
  'AK',
  'SMG',
  'Sniper',
  'Pistol',
  'Shotgun',
  'Knife',
  'RPG',
  'Muzzle',
])

// This small PBR scene can use the WebGPU backend without the FPS's GLSL
// terrain, gas, and effects. Choose by successful initialization, not UA.
export function mountShowcase(
  host,
  { kind = 'weapon', id, style, webgpu = true },
) {
  let stopped = false,
    frame,
    observer,
    renderer,
    model,
    skeletons,
    mixer,
    device,
    fallback
  const pool = new ModelPool()
  const status = host.querySelector('[data-preview-status]')
  function fail(error) {
    if (stopped) return
    const retry = webgpu && !!device
    stop()
    delete host.dataset.renderer
    if (retry && host.isConnected) {
      status.textContent = 'Switching 3D preview to WebGL 2…'
      fallback = mountShowcase(host, { kind, id, style, webgpu: false })
    } else
      status.textContent = error?.message ?? 'The 3D preview is unavailable.'
  }
  async function start() {
    const asset = await pool.load(id)
    if (stopped) return
    if (!asset) throw new Error('3D model unavailable.')
    const options = {
      antialias: true,
      alpha: false,
      powerPreference: 'low-power',
    }
    if (webgpu && navigator.gpu && isSecureContext) {
      try {
        const adapter = await navigator.gpu.requestAdapter()
        if (stopped) return
        if (adapter) {
          const { WebGPURenderer } = await import('three/webgpu')
          if (stopped) return
          device = await adapter.requestDevice()
          if (stopped) {
            device.destroy()
            return
          }
          const candidate = new WebGPURenderer({
            ...options,
            device,
            antialias: false,
          })
          candidate.onDeviceLost = () => {
            if (device) fail(new Error('WebGPU device lost.'))
          }
          device.addEventListener('uncapturederror', (event) => {
            event.preventDefault()
            fail(event.error)
          })
          try {
            await candidate.init()
            if (!stopped && candidate.backend.isWebGPUBackend)
              renderer = candidate
          } finally {
            if (renderer !== candidate) candidate.dispose()
          }
          if (stopped) return
        }
      } catch {
        if (stopped) return
      }
    }
    if (!renderer) {
      const discarded = device
      device = null
      discarded?.destroy()
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('webgl2', options)
      if (!context) throw new Error('WebGL 2 is not available on this device.')
      renderer = new T.WebGLRenderer({ canvas, context, ...options })
    }
    const scene = new T.Scene(),
      pivot = new T.Group(),
      fit = new T.Group(),
      camera = new T.PerspectiveCamera(32, 1, 0.02, 30)
    scene.background = new T.Color('#101b2a')
    scene.add(pivot, new T.HemisphereLight('#d0e6ff', '#6d5676', 2.85))
    const key = new T.DirectionalLight('#fff3db', 3.35),
      rim = new T.DirectionalLight('#7ad9ff', 3.15)
    key.position.set(3, 5, 4)
    rim.position.set(-3, 1, -2)
    scene.add(key, rim)
    model = clone(asset.scene)
    skeletons = new Set()
    const look = kind === 'operator' ? operatorStyle(style) : finishStyle(style)
    const mats = new Map(),
      accents = []
    const tint = new T.Color()
    model.traverse((obj) => {
      if (held.has(obj.name)) obj.visible = false
      if (obj.isSkinnedMesh) {
        skeletons.add(obj.skeleton)
        obj.frustumCulled = false
      }
      if (!obj.isMesh || Array.isArray(obj.material)) return
      const base = obj.material
      if (!mats.has(base)) {
        const copy = base.clone()
        if (kind !== 'operator' && copy.color) {
          copy.metalness = Math.min(0.26, copy.metalness ?? 0)
          copy.roughness = Math.max(0.55, copy.roughness ?? 0.55)
          copy.color.lerp(tint.set('#84959e'), 0.31)
        }
        if (
          kind === 'operator' &&
          look?.dye &&
          Object.hasOwn(look.dye, base.name)
        )
          copy.color?.set(look.dye[base.name])
        if (
          kind !== 'operator' &&
          look &&
          look.id !== 'issue' &&
          base.name.startsWith('vm_')
        ) {
          const materialBody = /metal|polymer|awp/i.test(base.name)
          copy.color?.lerp(
            tint.set(materialBody ? look.body : look.trim),
            materialBody ? 0.86 : 0.61,
          )
          if (look.effect === 'pulse' && /dark|accent/i.test(base.name)) {
            copy.emissive.set(look.trim)
            accents.push(copy)
          }
        }
        mats.set(base, copy)
      }
      obj.material = mats.get(base)
    })
    model.rotation.y = kind === 'operator' ? -0.12 : -0.22
    const bounds = new T.Box3().setFromObject(model),
      size = bounds.getSize(new T.Vector3()),
      center = bounds.getCenter(new T.Vector3())
    model.position.sub(center)
    const modelSize = Math.max(size.x, size.y, size.z, 0.1)
    fit.add(model)
    pivot.add(fit)
    if (kind === 'operator' && asset.animations.length) {
      mixer = new T.AnimationMixer(model)
      const clip =
        asset.animations.find((c) => c.name === 'Idle') ?? asset.animations[0]
      mixer.clipAction(clip).play()
    }
    // Use a side-on camera for the rifles, which have their long axis along Z.
    if (kind === 'operator') camera.position.set(0.14, 0.22, 5.1)
    else camera.position.set(4.2, 0.95, 2.05)
    camera.lookAt(0, 0, 0)
    renderer.setPixelRatio(Math.min(1.65, devicePixelRatio))
    renderer.toneMapping = T.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    const canvas = renderer.domElement
    canvas.setAttribute('aria-label', `Interactive 3D ${kind} preview`)
    canvas.tabIndex = 0
    host.prepend(canvas)
    const backend = renderer.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL 2'
    const resize = () => {
      const w = Math.max(1, host.clientWidth),
        h = Math.max(1, host.clientHeight)
      camera.aspect = w / h
      fit.scale.setScalar(
        (kind === 'operator'
          ? 2.06
          : Math.min(5.25, Math.max(1.27, camera.aspect * 2.13))) / modelSize,
      )
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
    }
    observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    let turn = 0,
      pitch = 0,
      pointer = null,
      x = 0,
      y = 0
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    canvas.addEventListener('pointerdown', (e) => {
      pointer = e.pointerId
      x = e.clientX
      y = e.clientY
      canvas.setPointerCapture(e.pointerId)
    })
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return
      turn += (e.clientX - x) * 0.013
      pitch = T.MathUtils.clamp(pitch + (e.clientY - y) * 0.007, -0.64, 0.64)
      x = e.clientX
      y = e.clientY
    })
    canvas.addEventListener('lostpointercapture', () => {
      pointer = null
    })
    canvas.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key))
        return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'ArrowLeft') turn -= 0.25
      if (e.key === 'ArrowRight') turn += 0.25
      if (e.key === 'ArrowUp') pitch = Math.max(-0.64, pitch - 0.13)
      if (e.key === 'ArrowDown') pitch = Math.min(0.64, pitch + 0.13)
    })
    if (device) device.pushErrorScope('validation')
    renderer.render(scene, camera)
    if (device) {
      const error = await device.popErrorScope()
      if (stopped) return
      if (error) throw error
    }
    host.dataset.renderer = backend
    status.textContent = `${backend} · drag or use arrow keys to rotate`
    let previous = performance.now()
    function draw(now) {
      if (stopped) return
      if (!host.isConnected) return stop()
      const dt = Math.min(0.05, (now - previous) / 1000)
      previous = now
      if (pointer === null && !reduced)
        turn += dt * (kind === 'operator' ? 0.47 : 0.29)
      pivot.rotation.set(pitch, turn, 0)
      for (const m of accents)
        m.emissiveIntensity = 0.11 + 0.11 * (0.5 + 0.5 * Math.sin(now * 0.004))
      mixer?.update(reduced ? 0 : dt)
      try {
        renderer.render(scene, camera)
      } catch (error) {
        fail(error)
        return
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
  }
  function stop() {
    if (stopped) {
      fallback?.()
      return
    }
    stopped = true
    cancelAnimationFrame(frame)
    observer?.disconnect()
    mixer?.stopAllAction()
    if (model && mixer) mixer.uncacheRoot(model)
    for (const bones of skeletons ?? []) bones.dispose()
    if (model) {
      const materials = new Set()
      model.traverse((obj) => {
        if (obj.isMesh && !Array.isArray(obj.material))
          materials.add(obj.material)
      })
      for (const material of materials) material.dispose()
    }
    pool.dispose()
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss?.()
      renderer.domElement.remove()
    }
    device?.destroy()
  }
  start().catch(fail)
  return stop
}
