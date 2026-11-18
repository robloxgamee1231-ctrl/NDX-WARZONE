import { clamp } from './world.js'

export class FieldAudio {
  constructor(volume) {
    this.volume = volume / 100
    this.ctx = null
    this.stepAt = 0
    this.closed = false
  }
  enable() {
    if (this.closed) return
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {})
      return
    }
    const Audio = window.AudioContext || window.webkitAudioContext
    if (!Audio) return
    try {
      const ctx = (this.ctx = new Audio())
      this.out = ctx.createGain()
      this.out.gain.value = this.volume * 0.72
      const limiter = ctx.createDynamicsCompressor()
      this.out.connect(limiter)
      limiter.connect(ctx.destination)
      this.noises = {}
      for (const [label, t, brown] of [
        ['short', 0.23, 0.13],
        ['long', 1.6, 0.35],
        ['ambient', 3.6, 0.87],
      ]) {
        const n = Math.floor(ctx.sampleRate * t),
          b = ctx.createBuffer(1, n, ctx.sampleRate),
          buf = b.getChannelData(0)
        let prev = 0
        for (let i = 0; i < n; i++) {
          prev = brown * prev + (Math.random() * 2 - 1) * (1 - brown)
          buf[i] = prev
        }
        this.noises[label] = b
      }
      const wind = ctx.createBufferSource()
      wind.buffer = this.noises.ambient
      wind.loop = true
      const filter = (this.windFilter = ctx.createBiquadFilter())
      filter.type = 'lowpass'
      filter.frequency.value = 110
      this.windGain = ctx.createGain()
      this.windGain.gain.value = 0.12
      this.wind = wind
      wind.connect(filter)
      filter.connect(this.windGain)
      this.windGain.connect(this.out)
      wind.start()
      ctx.resume().catch(() => {})
    } catch {
      /* No audio device; the game remains playable. */
    }
  }
  settings(volume) {
    this.volume = volume / 100
    if (this.out)
      this.out.gain.setTargetAtTime(
        this.volume * 0.72,
        this.ctx.currentTime,
        0.09,
      )
  }
  voicePan(pan) {
    if (
      !this.ctx ||
      Math.abs(pan) < 0.03 ||
      typeof this.ctx.createStereoPanner !== 'function'
    )
      return this.out
    const p = this.ctx.createStereoPanner()
    p.pan.value = clamp(pan, -1, 1)
    p.connect(this.out)
    return p
  }
  noise(
    length,
    gain,
    hz = 900,
    type = 'bandpass',
    start = 0,
    pan = 0,
    q = 0.7,
  ) {
    const c = this.ctx
    if (!c || c.state !== 'running' || gain < 0.002 || this.volume <= 0) return
    const t = c.currentTime + start,
      src = c.createBufferSource()
    src.buffer = length > 0.2 ? this.noises.long : this.noises.short
    const filter = c.createBiquadFilter()
    filter.type = type
    filter.frequency.value = hz
    filter.Q.value = q
    const env = c.createGain()
    env.gain.setValueAtTime(gain, t)
    env.gain.exponentialRampToValueAtTime(0.0003, t + length)
    const out = this.voicePan(pan)
    src.connect(filter)
    filter.connect(env)
    env.connect(out)
    src.start(t, Math.random() * 0.022)
    src.stop(t + length + 0.005)
    src.onended = () => {
      env.disconnect()
      filter.disconnect()
      if (out !== this.out) out.disconnect()
    }
  }
  tone(freq, to, length, gain, shape = 'sine', delay = 0, pan = 0) {
    const c = this.ctx
    if (!c || c.state !== 'running' || this.volume <= 0 || gain < 0.002) return
    const t = c.currentTime + delay,
      osc = c.createOscillator()
    osc.type = shape
    osc.frequency.setValueAtTime(freq, t)
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, to), t + length)
    const env = c.createGain()
    env.gain.setValueAtTime(0.0003, t)
    env.gain.linearRampToValueAtTime(gain, t + 0.008)
    env.gain.exponentialRampToValueAtTime(0.0003, t + length)
    const out = this.voicePan(pan)
    osc.connect(env)
    env.connect(out)
    osc.start(t)
    osc.stop(t + length + 0.006)
    osc.onended = () => {
      env.disconnect()
      if (out !== this.out) out.disconnect()
    }
  }
  shot(id, volume, pan = 0, near = false) {
    const heavy = id === 'bulwark' || id === 'harrier' || id === 'kestrel'
    const light = id === 'viper' || id === 'mistral' || id === 'spectre'
    const gain = volume * (heavy ? 1.13 : light ? 0.82 : 1),
      bass = heavy ? 148 : light ? 211 : 185
    this.noise(
      near ? 0.18 : 0.26,
      gain * 0.69,
      near ? 2400 : 900,
      'lowpass',
      0,
      pan,
      0.72,
    )
    this.noise(0.062, gain * 0.4, 1960, 'bandpass', 0, pan, 0.42)
    this.tone(bass, 49, 0.102, gain * 0.39, 'triangle', 0, pan)
    if (near) this.noise(0.22, gain * 0.18, 690, 'lowpass', 0.053, pan)
  }
  event(type, event = {}) {
    switch (type) {
      case 'plateStart':
        this.noise(0.29, 0.3, 780, 'bandpass')
        this.noise(0.22, 0.16, 2000, 'lowpass', 0.13)
        break
      case 'plateInsert':
        this.tone(118, 58, 0.13, 0.26, 'triangle')
        this.noise(0.15, 0.31, 550, 'lowpass')
        this.tone(317, 223, 0.085, 0.079, 'triangle', 0.07)
        break
      case 'plateBreak':
        this.noise(0.29, 0.53, 4125, 'highpass')
        this.noise(0.16, 0.42, 1631, 'bandpass', 0, 0, 1.7)
        for (let i = 0; i < 5; i++)
          this.tone(
            1570 + i * 365,
            980 + i * 273,
            0.095 + i * 0.015,
            0.074,
            'triangle',
            i * 0.023,
          )
        break
      case 'damage':
        this.noise(0.16, 0.3, event.armor ? 1970 : 940, 'bandpass')
        this.tone(109, 48, 0.17, 0.26, 'triangle')
        break
      case 'staff':
        this.tone(428, 472, 0.11, 0.13, 'sine')
        this.tone(648, 802, 0.16, 0.1, 'triangle', 0.073)
        break
      case 'pickup':
        this.tone(522, 680, 0.085, 0.14, 'triangle')
        this.tone(765, 902, 0.11, 0.095, 'sine', 0.055)
        break
      case 'crate':
        this.noise(0.32, 0.33, 810, 'bandpass')
        this.tone(118, 67, 0.17, 0.15, 'triangle')
        this.tone(318, 493, 0.15, 0.071, 'triangle', 0.085)
        break
      case 'reload':
        this.noise(0.22, 0.27, 1770, 'bandpass')
        this.noise(0.12, 0.29, 1490, 'bandpass', 0.36)
        this.noise(0.16, 0.32, 730, 'bandpass', 0.88)
        break
      case 'reloadDone':
        this.noise(0.11, 0.29, 2150, 'bandpass')
        this.tone(174, 108, 0.072, 0.12, 'triangle')
        break
      case 'slide':
        this.noise(0.68, 0.36, 540, 'lowpass')
        break
      case 'jump':
      case 'mantle':
        this.noise(0.16, 0.18, 467, 'lowpass')
        break
      case 'land':
        this.noise(0.31, 0.31, 315, 'lowpass')
        this.tone(83, 39, 0.18, 0.155, 'triangle')
        break
      case 'chute':
        this.noise(0.71, 0.42, 520, 'bandpass')
        this.tone(93, 56, 0.13, 0.12, 'triangle', 0.16)
        break
      case 'drop':
      case 'cut':
        this.noise(0.54, 0.3, 320, 'bandpass')
        break
      case 'hit':
        this.tone(
          event.eliminated ? 525 : event.broken ? 655 : 410,
          240,
          0.073,
          0.16,
          'triangle',
        )
        if (event.eliminated) this.tone(775, 580, 0.16, 0.1, 'sine', 0.064)
        break
      case 'contract':
      case 'purchase':
        this.tone(304, 316, 0.15, 0.13, 'triangle')
        this.tone(474, 489, 0.21, 0.11, 'triangle', 0.11)
        break
      case 'contractDone':
      case 'matchEnd':
        ;[330, 440, 554, 660].forEach((f, i) =>
          this.tone(f, f, 0.38, 0.14, 'triangle', i * 0.095),
        )
        break
      case 'launch':
        this.tone(91, 376, 0.45, 0.223, 'triangle')
        this.noise(0.61, 0.22, 700, 'lowpass')
        break
      case 'resupplyIn':
        this.tone(412, 515, 0.2, 0.145, 'sine')
        this.tone(690, 824, 0.24, 0.12, 'triangle', 0.15)
        break
      case 'ping':
        this.tone(705, 615, 0.11, 0.114, 'sine')
        this.tone(945, 925, 0.14, 0.075, 'triangle', 0.055)
        break
      case 'rescued':
        this.tone(288, 434, 0.23, 0.155, 'triangle')
        this.tone(550, 583, 0.21, 0.11, 'sine', 0.14)
        break
      case 'pulse':
        this.tone(423, 1170, 0.32, 0.14, 'sine')
        break
      case 'tactical':
        this.noise(0.36, 0.21, event.item === 'smoke' ? 3000 : 1030, 'bandpass')
        break
      case 'swap':
        this.noise(0.16, 0.16, 1530, 'bandpass')
        break
      case 'relayCaptured':
        this.tone(458, 522, 0.18, 0.16, 'triangle')
        this.tone(612, 742, 0.3, 0.124, 'sine', 0.13)
        break
      case 'relayOvertime':
        this.tone(179, 237, 0.31, 0.19, 'triangle')
        break
      case 'drillStart':
      case 'drillStage':
        this.tone(577, 761, 0.14, 0.13, 'sine')
        break
      case 'drillDone':
        this.tone(
          event.passed ? 716 : 260,
          event.passed ? 988 : 173,
          0.27,
          0.17,
          'sine',
        )
        break
      case 'downed':
        this.tone(123, 59, 0.45, 0.21, 'triangle')
        break
      case 'circle':
        this.tone(178, 166, 0.21, 0.19, 'triangle')
        this.tone(151, 144, 0.25, 0.14, 'triangle', 0.25)
        break
    }
  }
  update(p, dt, wet, paused) {
    if (!this.windGain || !this.ctx) return
    const t = this.ctx.currentTime,
      speed = p ? Math.hypot(p.vx, p.vz) : 0,
      air = p?.air !== 'ground',
      s = paused ? 0.28 : 1
    this.windGain.gain.setTargetAtTime(
      (air ? 0.21 : wet > 0.37 ? 0.19 : 0.076) * s,
      t,
      0.14,
    )
    this.windFilter.frequency.setTargetAtTime(
      air ? 630 : wet > 0.37 ? 420 : 145,
      t,
      0.3,
    )
    this.stepAt -= dt
    if (
      this.stepAt <= 0 &&
      !paused &&
      !air &&
      p?.grounded &&
      speed > 1.36 &&
      p.stance !== 'slide'
    ) {
      const pace = clamp(speed / 9, 0.2, 1.25)
      this.stepAt = 0.52 - pace * 0.25
      this.noise(
        0.18,
        0.13 + pace * 0.12,
        (wet > 0.4 ? 420 : 750) + Math.random() * 330,
        'lowpass',
      )
      this.tone(
        80 + Math.random() * 35,
        42,
        0.074,
        0.07 + pace * 0.04,
        'triangle',
      )
    }
  }
  dispose() {
    this.closed = true
    try {
      this.wind?.stop()
      this.ctx?.close().catch(() => {})
    } catch {
      /* Already closed. */
    }
  }
}
