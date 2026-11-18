import { ACTIONS, EMPTY_INPUT, yawWrap } from './movement.js'
import { clamp } from './world.js'

const keys = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyX',
  'KeyC',
  'KeyG',
  'Digit4',
  'KeyE',
  'KeyQ',
  'KeyR',
  'KeyP',
  'KeyM',
  'KeyT',
  'KeyF',
  'KeyV',
  'KeyZ',
  'KeyB',
  'Digit1',
  'Digit2',
  'Space',
  'Tab',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Escape',
])
const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
const pressAction = {
  Space: 'jump',
  KeyX: 'tactical',
  KeyR: 'reload',
  KeyE: 'interact',
  KeyQ: 'equipment',
  KeyV: 'tacticalUse',
  KeyZ: 'ping',
  Digit1: 'primary',
  Digit2: 'sidearm',
}

// Chromium can replay the movement to or from the capture anchor in a
// locked mouse event. Fixed event coordinates vary by host: some report
// the origin and some report the position at which the lock started.
export function isCaptureWarp(anchor, e, dx, dy) {
  if (!anchor || Math.abs(dx) + Math.abs(dy) <= 150) return false
  const atOrigin = e.clientX === 0 && e.clientY === 0
  const atAnchor =
    Math.abs(e.clientX - anchor.x) < 1.5 && Math.abs(e.clientY - anchor.y) < 1.5
  return (
    (atOrigin || atAnchor) &&
    Math.abs(Math.abs(dx) - anchor.x) < 1.5 &&
    Math.abs(Math.abs(dy) - anchor.y) < 1.5
  )
}

export class FieldInput {
  constructor(root, canvas, settings, callbacks) {
    this.root = root
    this.canvas = canvas
    this.settings = settings
    this.cb = callbacks
    this.keys = new Set()
    this.touch = new Set()
    this.edges = {}
    this.yaw = 0
    this.pitch = 0
    this.lastShift = -100
    this.mouseL = false
    this.mouseR = false
    this.firePulse = false
    this.mobileSprint = false
    this.stick = { x: 0, z: 0 }
    this.abort = new AbortController()
    this.enabled = true
    this.lockRejected = false
    this.isTouch =
      matchMedia('(pointer: coarse)').matches ||
      (navigator.maxTouchPoints > 0 &&
        matchMedia('(any-pointer: coarse)').matches)
    this.root.classList.toggle('has-touch', this.isTouch)
    const on = (el, event, cb, extra = {}) =>
      el.addEventListener(event, cb, { ...extra, signal: this.abort.signal })
    on(window, 'keydown', (e) => this.keyDown(e))
    on(window, 'keyup', (e) => this.keyUp(e))
    on(window, 'blur', () => {
      this.reset()
      this.cb.blur?.()
    })
    on(window, 'contextmenu', (e) => {
      if (
        this.root.contains(e.target) ||
        document.pointerLockElement === this.canvas
      )
        e.preventDefault()
    })
    on(document, 'pointerlockchange', () => {
      this.waitingLock = false
      this.locked = document.pointerLockElement === this.canvas
      this.lockMovementReady = !this.locked
      this.root.classList.toggle('mouse-locked', this.locked)
      if (!this.locked) {
        this.mouseL = false
        this.mouseR = false
      }
      this.cb.lock?.(this.locked)
    })
    on(document, 'pointerlockerror', () => {
      if (this.waitingLock) this.lockRejected = true
      this.waitingLock = false
    })
    on(canvas, 'pointerdown', (e) => this.onDown(e))
    on(window, 'pointerup', (e) => this.onUp(e))
    on(window, 'pointercancel', (e) => this.onUp(e))
    on(window, 'pointermove', (e) => this.onMove(e))
    on(document, 'mousemove', (e) => this.onLockedMove(e))
    const hud = root.querySelector('.touch-controls')
    if (hud) {
      const base = hud.querySelector('.stick'),
        cap = hud.querySelector('.stick-cap')
      on(base, 'pointerdown', (e) => {
        if (!this.enabled || e.pointerType === 'mouse') return
        e.preventDefault()
        e.stopPropagation()
        this.isTouch = true
        this.root.classList.add('has-touch')
        this.cb.gesture?.()
        this.stickId = e.pointerId
        base.setPointerCapture(e.pointerId)
        this.moveStick(e, base, cap)
      })
      on(base, 'pointermove', (e) => {
        if (e.pointerId === this.stickId) this.moveStick(e, base, cap)
      })
      for (const evt of ['pointerup', 'pointercancel', 'lostpointercapture'])
        on(base, evt, (e) => {
          if (e.pointerId === this.stickId) {
            this.stickId = null
            this.stick = { x: 0, z: 0 }
            cap.style.transform = 'translate(-50%,-50%)'
          }
        })
      for (const button of hud.querySelectorAll('[data-touch]')) {
        const key = button.dataset.touch
        on(button, 'pointerdown', (e) => {
          if (!this.enabled) return
          e.preventDefault()
          e.stopPropagation()
          this.cb.gesture?.()
          button.setPointerCapture(e.pointerId)
          this.touch.add(key)
          this.touchTap(key)
          button.classList.toggle(
            'pressed',
            key === 'sprint' ? this.mobileSprint : true,
          )
        })
        for (const evt of ['pointerup', 'pointercancel', 'lostpointercapture'])
          on(button, evt, () => {
            this.touch.delete(key)
            if (key !== 'sprint') button.classList.remove('pressed')
          })
      }
    }
  }
  setLook(yaw, pitch = 0) {
    this.yaw = yawWrap(yaw)
    this.pitch = clamp(pitch, -1.48, 1.48)
  }
  look(dx, dy, scale = 1) {
    const sens = 0.00118 + (this.settings.sensitivity / 100) * 0.00308
    this.setLook(this.yaw - dx * sens * scale, this.pitch - dy * sens * scale)
  }
  keyDown(e) {
    if (
      e.target?.closest?.('dialog, input, select, textarea') ||
      !keys.has(e.code) ||
      this.cb.external?.()
    )
      return
    if (
      e.code === 'Tab' &&
      e.target?.closest?.('.field-panel') &&
      !e.target.closest('.wide')
    )
      return
    e.preventDefault()
    if (e.repeat) return
    if (e.code === 'Escape' || e.code === 'KeyP') {
      this.cb.pause?.()
      return
    }
    if (e.code === 'Tab') {
      this.cb.score?.()
      return
    }
    if (e.code === 'KeyM') {
      this.cb.map?.()
      return
    }
    if (e.code === 'KeyB') {
      this.cb.drills?.()
      return
    }
    if (e.code === 'KeyT') {
      this.cb.rangeTest?.()
      return
    }
    if (!this.enabled) return
    this.cb.gesture?.()
    this.keys.add(e.code)
    const act = pressAction[e.code]
    if (act) this.edges[act] = true
    if (e.code.startsWith('Shift')) {
      const now = performance.now()
      if (now - this.lastShift < 310) this.edges.tactical = true
      this.lastShift = now
    }
    if (e.code === 'Space') this.cb.space?.()
  }
  keyUp(e) {
    this.keys.delete(e.code)
  }
  tryLock() {
    if (this.isTouch || this.locked || this.waitingLock || this.lockRejected)
      return
    if (!this.canvas.requestPointerLock) {
      this.lockRejected = true
      return
    }
    this.waitingLock = true
    try {
      const p = this.canvas.requestPointerLock()
      p?.catch?.(() => {
        this.waitingLock = false
        this.lockRejected = true
      })
    } catch {
      this.waitingLock = false
      this.lockRejected = true
    }
  }
  onDown(e) {
    if (!this.enabled) return
    this.cb.gesture?.('pointer')
    if (e.pointerType === 'touch') {
      this.isTouch = true
      this.root.classList.add('has-touch')
      this.lookId = e.pointerId
      this.lookX = e.clientX
      this.lookY = e.clientY
      this.canvas.setPointerCapture(e.pointerId)
      return
    }
    if (e.button === 1) {
      e.preventDefault()
      this.edges.ping = true
      return
    }
    if (e.button === 0) {
      if (document.pointerLockElement === this.canvas) {
        this.mouseL = true
        this.firePulse = true
      } else {
        this.dragId = e.pointerId
        this.dragMoved = 0
        this.lookX = e.clientX
        this.lookY = e.clientY
        this.lockAnchor = { x: e.clientX, y: e.clientY }
        this.canvas.focus({ preventScroll: true })
        this.tryLock()
        this.leftDown = true
        clearTimeout(this.dragTimer)
        this.dragTimer = setTimeout(() => {
          if (
            this.leftDown &&
            !this.locked &&
            this.dragMoved < 5 &&
            this.enabled
          )
            this.mouseL = true
        }, 126)
      }
    } else if (e.button === 2) {
      this.mouseR = true
      if (!this.locked) {
        this.dragId = e.pointerId
        this.lookX = e.clientX
        this.lookY = e.clientY
      }
    }
  }
  onUp(e) {
    if (e.pointerId === this.lookId) this.lookId = null
    if (e.pointerId === this.dragId) this.dragId = null
    if (e.pointerType !== 'touch') {
      if (e.button === 0) {
        if (
          this.leftDown &&
          !this.locked &&
          this.lockRejected &&
          e.type !== 'pointercancel' &&
          this.dragMoved < 5 &&
          !this.mouseL
        )
          this.firePulse = true
        this.leftDown = false
        this.mouseL = false
        clearTimeout(this.dragTimer)
      }
      if (e.button === 2) this.mouseR = false
    }
  }
  onLockedMove(e) {
    if (!this.enabled || !this.locked) return
    const dx = e.movementX || 0,
      dy = e.movementY || 0
    if (!dx && !dy) return
    if (
      Math.abs(dx) >= this.canvas.clientWidth * 0.92 ||
      Math.abs(dy) >= this.canvas.clientHeight * 0.92
    )
      return
    if (isCaptureWarp(this.lockAnchor, e, dx, dy)) return
    if (!this.lockMovementReady) {
      this.lockMovementReady = true
      // Some browsers emit a cursor-warp delta when capture transfers to the canvas.
      if (Math.abs(dx) + Math.abs(dy) > 150) return
    }
    this.look(dx, dy)
  }
  onMove(e) {
    if (
      !this.enabled ||
      (document.pointerLockElement === this.canvas && e.pointerType !== 'touch')
    )
      return
    if (
      (e.pointerId === this.lookId && e.pointerType === 'touch') ||
      (e.pointerId === this.dragId && e.pointerType !== 'touch')
    ) {
      const dx = e.clientX - this.lookX,
        dy = e.clientY - this.lookY
      if (
        this.waitingLock &&
        e.pointerType !== 'touch' &&
        isCaptureWarp(this.lockAnchor, e, dx, dy)
      )
        return
      this.lookX = e.clientX
      this.lookY = e.clientY
      if (this.leftDown && e.pointerType !== 'touch') {
        this.dragMoved += Math.abs(dx) + Math.abs(dy)
        if (this.dragMoved >= 5) this.mouseL = false
      }
      this.look(dx, dy, e.pointerType === 'touch' ? 1.67 : 1.19)
    }
  }
  moveStick(e, node, cap) {
    const b = node.getBoundingClientRect(),
      radius = b.width * 0.39
    let x = (e.clientX - b.left - b.width * 0.5) / radius,
      z = -(e.clientY - b.top - b.height * 0.5) / radius
    const strength = Math.hypot(x, z)
    if (strength > 1) {
      x /= strength
      z /= strength
    }
    this.stick = {
      x: Math.abs(x) > 0.09 ? x : 0,
      z: Math.abs(z) > 0.09 ? z : 0,
    }
    cap.style.transform = `translate(calc(-50% + ${x * radius}px),calc(-50% + ${-z * radius}px))`
  }
  touchTap(key) {
    if (ACTIONS.includes(key)) this.edges[key] = true
    if (key === 'fire') this.firePulse = true
    if (key === 'sprint') {
      this.mobileSprint = !this.mobileSprint
      if (this.mobileSprint) this.edges.tactical = true
    }
  }
  tap(key) {
    if (ACTIONS.includes(key)) this.edges[key] = true
  }
  read(dt, allow = true) {
    if (!this.enabled || !allow) {
      this.edges = {}
      return { ...EMPTY_INPUT, yaw: this.yaw, pitch: this.pitch }
    }
    const k = this.keys,
      touch = this.touch,
      axis = (p, n) => Number(k.has(p)) - Number(k.has(n))
    if (arrows.some((c) => k.has(c)))
      this.setLook(
        this.yaw - axis('ArrowRight', 'ArrowLeft') * dt * 1.95,
        this.pitch + axis('ArrowUp', 'ArrowDown') * dt * 1.65,
      )
    const input = {
      yaw: this.yaw,
      pitch: this.pitch,
      x: clamp(axis('KeyD', 'KeyA') + this.stick.x, -1, 1),
      z: clamp(axis('KeyW', 'KeyS') + this.stick.z, -1, 1),
      sprint: k.has('ShiftLeft') || k.has('ShiftRight') || this.mobileSprint,
      crouch:
        k.has('KeyC') ||
        k.has('ControlLeft') ||
        k.has('ControlRight') ||
        touch.has('crouch'),
      jumpHeld: k.has('Space') || touch.has('jump'),
      revive: k.has('KeyF') || touch.has('revive'),
      plate: k.has('KeyG') || k.has('Digit4') || touch.has('plate'),
      fire: this.mouseL || this.firePulse || touch.has('fire'),
      aim: this.mouseR || touch.has('aim'),
    }
    for (const a of ACTIONS) input[a] = Boolean(this.edges[a])
    this.edges = {}
    this.firePulse = false
    return input
  }
  reset() {
    this.keys.clear()
    this.touch.clear()
    this.edges = {}
    this.mouseL = this.mouseR = this.firePulse = this.leftDown = false
    clearTimeout(this.dragTimer)
    this.stick = { x: 0, z: 0 }
    this.lookId = this.dragId = this.stickId = null
    const cap = this.root.querySelector('.stick-cap')
    if (cap) cap.style.transform = 'translate(-50%,-50%)'
    for (const b of this.root.querySelectorAll(
      '[data-touch]:not([data-touch="sprint"])',
    ))
      b.classList.remove('pressed')
  }
  enable(on) {
    if (this.enabled === on) return
    this.enabled = on
    if (!on) {
      this.reset()
      this.exitLock()
    }
  }
  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }
  dispose() {
    this.exitLock()
    this.abort.abort()
    this.reset()
  }
}
