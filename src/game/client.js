import { MODE } from '../config.js'
import { equippedSpec } from './loadout.js'
import { nearestLaunchPad } from './launch-pads.js'
import { nearestStaff } from './support.js'
import { rescueTarget } from './squad.js'
import { FieldAudio } from './audio.js'
import { FieldHUD } from './hud.js'
import { FieldInput } from './input.js'
import { Match, nearbyLoot } from './match.js'
import { EMPTY_INPUT, integrate, yawWrap } from './movement.js'
import { FieldRenderer } from './render.js'
import { clamp, distance, lerp } from './world.js'

const STEP = 1 / 30
const noPlayer = {
  id: 'local',
  name: 'Operator',
  weapon: 'raven',
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  pitch: 0,
  vx: 0,
  vz: 0,
  health: 100,
  armor: 50,
  plates: 2,
  capacity: 5,
  ammo: 30,
  stock: 120,
  kills: 0,
  deaths: 0,
  targets: 0,
  damageDone: 0,
  assists: 0,
  alive: true,
  air: 'plane',
  stance: 'plane',
  team: 0,
  height: 1.74,
  cash: 0,
}

class FieldClient {
  constructor(root, opts, hooks) {
    this.root = root
    this.mode = MODE[opts.mode]
    this.settings = opts.settings
    this.hooks = hooks
    this.network = opts.network ?? null
    this.panel = null
    this.overlay = false
    this.spectating = false
    this.spectateId = null
    this.captured = false
    this.pointerWasLocked = false
    this.dead = false
    this.lost = false
    this.timeAcc = 0
    this.lastFrame = performance.now()
    this.lastEvent = 0
    this.nextSequence = 0
    this.commands = []
    this.netSeen = false
    this.interp = new Map()
    this.fps = 60
    this.cut = false
    this.result = null
    this.abort = new AbortController()
    this.id = this.network?.id ?? 'local'
    this.local = this.network
      ? null
      : new Match({
          mode: opts.mode,
          teamSize: opts.teamSize,
          map: opts.map,
          difficulty: opts.difficulty,
          seed:
            opts.seed ??
            (this.mode.map === 'range'
              ? 173
              : Math.floor(10000 + Math.random() * 800000)),
          players: [
            {
              id: this.id,
              name: opts.name,
              weapon: opts.settings.weapon,
              loadout: opts.loadout,
            },
          ],
        })
    this.teamSize =
      opts.teamSize ?? this.local?.teamSize ?? this.mode.defaultTeam
    this.world = this.network?.world ?? this.local.world
    this.difficulty = this.network?.info?.difficulty ?? this.local?.difficulty
    this.audio = new FieldAudio(this.settings.volume)
    this.hud = new FieldHUD(
      root,
      this.mode,
      this.teamSize,
      this.world,
      this.network?.info?.room ?? null,
      (id, offer) => this.action(id, offer),
      opts.drillRecords,
      this.difficulty,
    )
    this.renderer = new FieldRenderer(root, this.world, this.settings)
    this.input = new FieldInput(root, this.renderer.canvas, this.settings, {
      gesture: (kind) => {
        this.audio.enable()
        if (kind === 'pointer') this.captured = true
      },
      pause: () => this.action('pause'),
      score: () => this.action('score'),
      map: () => this.action('map'),
      rangeTest: () => this.action('range-test'),
      drills: () => this.action('drills'),
      external: () => this.overlay,
      lock: (locked) => {
        if (
          !locked &&
          this.pointerWasLocked &&
          !this.panel &&
          !this.overlay &&
          this.me?.alive &&
          this.me.air === 'ground'
        )
          this.setPanel('pause')
        this.pointerWasLocked = locked
        if (locked) this.captured = true
      },
      blur: () => {
        if (
          !this.network &&
          !this.panel &&
          !this.overlay &&
          this.me?.air === 'ground'
        )
          this.setPanel('pause')
      },
    })
    if (this.network) {
      this.network.addEventListener('snapshot', (e) => this.sync(e.detail), {
        signal: this.abort.signal,
      })
      this.network.addEventListener(
        'disconnect',
        () => {
          this.lost = true
          if (this.me) this.setPanel('lost')
        },
        { signal: this.abort.signal },
      )
      if (this.network.state && this.network.me)
        this.sync(this.network.snapshot())
      if (this.network.closed) {
        this.lost = true
      }
    } else this.input.setLook(this.me.yaw, this.me.pitch)
    this.renderer.canvas.addEventListener(
      'webglcontextlost',
      (e) => {
        e.preventDefault()
        this.hooks.notify?.(
          'Rendering context lost. Return to operations and try Performance mode.',
        )
        this.setPanel('pause')
      },
      { signal: this.abort.signal },
    )
    if (!this.input.isTouch) this.renderer.canvas.focus({ preventScroll: true })
    this.frame = this.frame.bind(this)
    this.animation = requestAnimationFrame(this.frame)
  }
  get me() {
    return (
      this.local?.players.get(this.id) ?? this.predicted ?? this.network?.me
    )
  }
  get snap() {
    return (
      this.local?.snapshot() ?? this.lastSnapshot ?? this.network?.snapshot()
    )
  }
  sync(snap) {
    const authoritative = this.network.me
    if (!authoritative || !snap) return
    const newLife =
      !this.netSeen || (this.predicted?.alive === false && authoritative.alive)
    if (newLife) {
      this.commands = []
      this.input.setLook(authoritative.yaw, authoritative.pitch)
      this.nextSequence = Math.max(this.nextSequence, authoritative.ack)
    }
    this.netSeen = true
    this.lastSnapshot = snap
    this.lastSync = performance.now()
    this.predicted = {
      ...authoritative,
      mantle: authoritative.mantle ? { ...authoritative.mantle } : null,
    }
    this.commands = this.commands.filter((c) => c.seq > authoritative.ack)
    if (authoritative.alive && !snap.result && !this.lost) {
      for (const [i, c] of this.commands.entries())
        integrate(
          this.predicted,
          c.input,
          this.world,
          STEP,
          snap.time + STEP * (i + 1),
        )
    }
  }
  applySettings(settings) {
    Object.assign(this.settings, settings)
    this.renderer.setSettings(this.settings)
    this.audio.settings(this.settings.volume)
  }
  setOverlay(active) {
    this.overlay = active
    this.input.enable(
      !active && !this.panel && this.me?.alive && !this.result && !this.lost,
    )
  }
  setPanel(panel) {
    const before = this.panel
    if (before === panel) return
    this.panel = panel
    const s = this.snap,
      p = this.me ?? noPlayer
    this.input.enable(
      !panel && !this.overlay && p.alive && !this.result && !this.lost,
    )
    if (!s && panel !== 'lost') return
    const friends = s?.players?.some(
      (a) => a.alive && a.team === p.team && a.id !== p.id,
    )
    this.hud.show(panel, p, s, {
      fps: Math.round(this.fps),
      online: !!this.network,
      ally: friends,
      result: this.result,
    })
    if (!panel && !this.overlay) {
      this.input.reset()
      if (!this.input.isTouch)
        this.renderer.canvas.focus({ preventScroll: true })
    }
  }
  action(id, offer) {
    if (this.overlay) return
    this.audio.enable()
    const active = this.panel
    if (id === 'exit') {
      this.hooks.exit()
      return
    }
    if (id === 'replay') {
      ;(this.hooks.replay ?? this.hooks.exit)(
        this.mode.id,
        this.teamSize,
        Boolean(this.network?.info?.private),
      )
      return
    }
    if (id === 'settings') {
      this.hooks.settings()
      return
    }
    if (id === 'controls') {
      this.hooks.controls()
      return
    }
    if (id === 'pause') {
      if (
        this.result ||
        this.lost ||
        ['eliminated', 'respawn'].includes(active)
      )
        return
      this.setPanel(active ? null : 'pause')
      return
    }
    if (id === 'close') {
      if (!['ended', 'eliminated', 'respawn', 'lost'].includes(this.panel))
        this.setPanel(null)
      return
    }
    if (id === 'drills' && this.mode.map !== 'range') return
    if (id === 'score' || id === 'map' || id === 'drills') {
      if (
        this.result ||
        this.lost ||
        ['eliminated', 'respawn'].includes(active)
      )
        return
      this.setPanel(active === id ? null : id)
      return
    }
    if (active === 'map' && (id === 'map-ping' || id === 'clear-ping')) {
      const point = id === 'clear-ping' ? { kind: 'clear' } : offer
      if (this.local) this.local.ping(this.id, point)
      else this.network.send({ op: 'ping', point })
      return
    }
    if (
      active === 'drills' &&
      this.local &&
      ['start-drill', 'cancel-drill'].includes(id)
    ) {
      if (this.local.drill(this.id, id === 'cancel-drill' ? 'cancel' : offer))
        this.setPanel(null)
      return
    }
    if (id === 'buy' && active === 'shop') {
      if (this.local) this.local.purchase(this.id, offer)
      else this.network.send({ op: 'buy', offer })
      return
    }
    if (id === 'spectate' && active === 'eliminated') {
      this.spectating = true
      this.setPanel(null)
      return
    }
    if (id === 'spec-next' && this.spectating) {
      this.pickSpec(this.snap, this.me, true)
      return
    }
    if (!active && this.me?.alive && !this.lost) {
      if (id === 'jump' || id === 'interact') this.input.tap(id)
      if (id === 'cut') this.cut = true
      if (id === 'range-test') this.local?.rangeHit(this.me)
    }
  }
  pickSpec(s, p, next = false) {
    const candidates = s.players
      .filter((a) => a.alive && a.id !== p.id)
      .sort(
        (a, b) =>
          Number(b.team === p.team) - Number(a.team === p.team) ||
          Number(b.id === p.killer) - Number(a.id === p.killer) ||
          distance(a, p) - distance(b, p),
      )
    const i = candidates.findIndex((a) => a.id === this.spectateId)
    const target = candidates.length
      ? candidates[next ? (i + 1) % candidates.length : Math.max(0, i)]
      : null
    this.spectateId = target?.id ?? null
    return target
  }
  get interpolationTime() {
    return this.network
      ? Math.min(
          0.12,
          (performance.now() - (this.lastSync ?? performance.now())) / 1000,
        )
      : this.timeAcc
  }
  step() {
    const frozen =
      this.overlay ||
      ['pause', 'drills'].includes(this.panel) ||
      this.result ||
      this.lost
    if (this.local && frozen) return
    const allow =
      !this.panel &&
      !this.overlay &&
      this.me?.alive &&
      !this.result &&
      !this.lost
    const input = this.input.read(STEP, allow)
    if (this.cut) {
      this.cut = false
      input.crouch = true
    }
    if (this.local) {
      this.local.command(this.id, input)
      this.local.step(STEP)
    } else if (this.network.me && !this.lost && !this.result) {
      const seq = ++this.nextSequence
      this.network.send({ op: 'input', seq, input })
      if (this.predicted?.alive)
        integrate(
          this.predicted,
          input,
          this.world,
          STEP,
          this.lastSnapshot.time + this.interpolationTime,
        )
      if (this.commands.length > 26) this.commands.shift()
      this.commands.push({ seq, input })
    }
  }
  consumeEvents(s, p, focus) {
    for (const e of s.events) {
      if (e.id <= this.lastEvent) continue
      this.lastEvent = e.id
      if (e.time < s.time - 1.15 && e.type !== 'kill') continue
      this.hud.event(e, p, s.time)
      const local = e.actor === this.id
      if (e.type === 'shot') {
        const d = Math.hypot(
          e.start[0] - focus.x,
          e.start[1] - focus.y,
          e.start[2] - focus.z,
        )
        if (d > 310 && !local) continue
        this.renderer.shot(e, local)
        const pan = local
          ? 0
          : clamp(
              ((e.start[0] - focus.x) * Math.cos(focus.yaw) -
                (e.start[2] - focus.z) * Math.sin(focus.yaw)) /
                Math.max(8, d),
              -1,
              1,
            )
        this.audio.shot(
          e.weapon,
          local ? 1 : clamp(1 - d / 242, 0.0, 1) ** 2 * 0.55,
          pan,
          local,
        )
        if (local && !this.overlay && !this.panel && this.input.enabled) {
          const kick = equippedSpec(p).kick
          this.input.setLook(
            this.input.yaw + Math.sin(e.id * 1.9) * kick * 0.067,
            this.input.pitch + kick * (p.aim ? 0.105 : 0.135),
          )
        }
      } else if (local) {
        this.audio.event(e.type, e)
        if (e.broken) this.audio.event('plateBreak', e)
        if (
          ['plateInsert', 'crate', 'reload', 'tactical', 'swap'].includes(
            e.type,
          )
        )
          this.renderer.modelEvent(e)
        if (
          e.type === 'staff' &&
          e.service === 'coach' &&
          !this.panel &&
          !this.overlay
        )
          this.setPanel('drills')
        if (e.type === 'drillReady') {
          this.input.setLook(e.yaw, e.pitch)
          this.renderer.poseKey = null
        }
        if (e.type === 'drillDone' && this.hooks.drillRecord?.(e.drill))
          this.hud.alert(`PERSONAL BEST · ${e.drill.grade}`, 'gold', 2.8)
        if (
          e.type === 'shop' &&
          p.alive &&
          !['ended', 'pause'].includes(this.panel) &&
          !this.overlay
        )
          this.setPanel('shop')
        if (e.type === 'redeploy') {
          this.input.setLook(e.yaw, p.pitch ?? 0)
          this.renderer.poseKey = null
        }
      } else if (
        [
          'circle',
          'matchEnd',
          'relayCaptured',
          'relayOvertime',
          'resupplyIn',
        ].includes(e.type) ||
        (['ping', 'rescued', 'pulse'].includes(e.type) && e.team === p.team)
      )
        this.audio.event(e.type, e)
    }
  }
  smoothPlayers(s, dt, p) {
    const set = new Set(),
      k = 1 - Math.exp(-dt * (this.network ? 12 : 25))
    const next = s.players.map((q) => {
      if (q.id === p.id) return p
      set.add(q.id)
      const old = this.interp.get(q.id),
        yBlend = old && old.air !== 'plane' && Math.abs(old.y - q.y) < 24
      const ex =
        this.network && q.alive && q.air !== 'plane'
          ? Math.min(this.interpolationTime * 0.65, 0.063)
          : 0
      const item = { ...q }
      if (
        old &&
        old.alive === q.alive &&
        old.air === q.air &&
        distance(q, old) < 22 &&
        q.air !== 'plane'
      ) {
        item.x = lerp(old.x, q.x + q.vx * ex, k)
        item.y = yBlend ? lerp(old.y, q.y, k) : q.y
        item.z = lerp(old.z, q.z + q.vz * ex, k)
        item.yaw = yawWrap(old.yaw + yawWrap(q.yaw - old.yaw) * k)
        item.height = lerp(old.height, q.height, k)
      }
      this.interp.set(q.id, item)
      return item
    })
    for (const id of this.interp.keys())
      if (!set.has(id)) this.interp.delete(id)
    return next
  }
  frame(now) {
    if (this.destroyed) return
    this.animation = requestAnimationFrame(this.frame)
    const delta = Math.min(0.1, Math.max(0.001, (now - this.lastFrame) / 1000))
    this.lastFrame = now
    this.fps = lerp(this.fps, 1 / delta, 0.05)
    this.timeAcc = Math.min(0.166, this.timeAcc + delta)
    while (this.timeAcc >= STEP) {
      this.timeAcc -= STEP
      this.step()
    }
    const p = this.me,
      s = this.snap
    if (!p || !s) {
      if (this.lost) this.setPanel('lost')
      return
    }
    if (s.result && !this.result) {
      this.result = s.result
      this.hooks.record?.(p, s.result)
      this.setPanel('ended')
    } else if (!p.alive && !this.dead && !this.result) {
      this.dead = true
      this.spectating = false
      this.spectateId = null
      this.setPanel(p.respawnAt > s.time ? 'respawn' : 'eliminated')
    } else if (p.alive && this.dead && !this.result) {
      this.dead = false
      this.spectating = false
      this.setPanel(null)
    } else if (
      !p.alive &&
      this.panel === 'respawn' &&
      !p.respawnAt &&
      !this.result
    )
      this.setPanel('eliminated')
    if (this.lost && !this.result && this.panel !== 'lost')
      this.setPanel('lost')
    const showTime =
      s.time +
      (!this.result &&
      !this.lost &&
      (this.network ||
        (!this.overlay && !['pause', 'drills'].includes(this.panel)))
        ? this.interpolationTime
        : 0)
    const snapshot = { ...s, time: showTime }
    const players = this.smoothPlayers(s, delta, p)
    const focus = p.alive ? p : this.pickSpec(s, p)
    const smoothFocus = (focus && players.find((q) => q.id === focus.id)) ?? p
    this.consumeEvents(s, p, smoothFocus)
    const look = this.input
    if (!this.panel && !this.overlay)
      this.renderer.adaptResolution(this.fps, delta)
    this.renderer.frame(snapshot, p, smoothFocus, look, delta, players)
    const facing = p.alive ? { ...p, yaw: look.yaw, pitch: look.pitch } : p
    const nearby = nearbyLoot(s.loot.values(), facing, this.world)
    this.hud.update(
      { ...snapshot, players },
      facing,
      p.alive ? facing : smoothFocus,
      this.renderer,
      {
        fps: Math.round(this.fps),
        online: !!this.network,
        nearby,
        staff: ['countdown', 'active'].includes(s.training?.state)
          ? null
          : nearestStaff(this.world, facing, nearby),
        revive:
          this.mode.id === 'battle-royale'
            ? rescueTarget(players, facing, this.world)
            : null,
        pad: nearestLaunchPad(this.world, facing, s.time),
        capture: this.captured,
        touch: this.input.isTouch,
        pause: !!this.panel,
        lockedPanel: !!this.panel || this.overlay,
        spectating: this.spectating,
        result: this.result,
      },
      delta,
    )
    this.audio.update(
      p,
      delta,
      this.renderer.env.wet,
      !!this.panel || this.overlay || !p.alive,
    )
  }
  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.animation)
    this.abort.abort()
    this.input.dispose()
    this.renderer.dispose()
    this.audio.dispose()
    this.hud.dispose()
    this.root.className = 'game'
    this.root.replaceChildren()
  }
}

export function startGame(root, options, hooks) {
  return new FieldClient(root, options, hooks)
}
