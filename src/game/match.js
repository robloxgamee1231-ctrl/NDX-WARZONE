import {
  startContract,
  advanceContract,
  recordContractKill,
  recordContractCrate,
} from './contracts.js'
import {
  MODE,
  WEAPONS,
  CALLSIGNS,
  HEALTH_MAX,
  SHOP,
  LOOT,
  ROOM_LIMIT,
} from '../config.js'
import {
  addPlates,
  armorState,
  damageVitals,
  equipSatchel,
  updatePlating,
  cancelPlating,
} from './armor.js'
import {
  claimResupply,
  reinforcements,
  updateReinforcements,
} from './reinforcements.js'
import { dropTag, GUN_LADDER, ladderEquip, takeTags } from './arcade.js'
import { AIM_STATES, MOVE_STATES } from './wire.js'
import { mapForMode } from './map-catalog.js'
import { DIFFICULTIES, normalizeDifficulty } from './difficulty.js'
import { BotNavigator } from './bot-navigation.js'
import { nearestStaff, talkToStaff } from './support.js'
import { botInput, BOT_PROFILES, botProfileAt } from './bot-ai.js'
import { controlWire, createControl, updateControl } from './control.js'
import {
  PRIMARY_IDS,
  applyPreset,
  equippedSpec,
  normalizeLoadout,
  replacePrimary,
  swapWeapon,
} from './loadout.js'
import {
  canFallDown,
  knockDown,
  rescueState,
  rescueTarget,
  updateRescues,
} from './squad.js'
import {
  MASK_CAPACITY,
  reduceGas,
  restockTactical,
  setSquadPing,
  tacticalWire,
  trimTactics,
  useTactical,
} from './tactics.js'
import {
  cancelDrill,
  drillAllowsTarget,
  drillHit,
  drillLocksInput,
  drillPickupAllowed,
  practiceShot,
  startDrill,
  updateDrill,
} from './training.js'
import {
  ACTIONS,
  aimVector,
  cleanInput,
  EMPTY_INPUT,
  eyeHeight,
  forward,
  integrate,
  moveState,
} from './movement.js'
import {
  clamp,
  createWorld,
  distance,
  lerp,
  planeAt,
  randomSource,
  rayWorld,
} from './world.js'

const RINGS = [
  { radius: 295, wait: 43, close: 35, damage: 5 },
  { radius: 183, wait: 31, close: 29, damage: 9 },
  { radius: 102, wait: 21, close: 23, damage: 13 },
  { radius: 52, wait: 15, close: 19, damage: 19 },
  { radius: 22, wait: 10, close: 13, damage: 26 },
  { radius: 4.5, wait: 6, close: 12, damage: 34 },
]
const bool = (v) => (v ? 1 : 0)
const round = (v, p = 100) => Math.round(v * p) / p
const cashText = (n) => `$${n.toLocaleString('en-US')}`

export class Match {
  constructor({
    mode = 'battle-royale',
    teamSize: requested,
    seed = 173,
    map,
    difficulty,
    bots,
    capacity = ROOM_LIMIT,
    players = [{ id: 'local', name: 'Operator', weapon: 'raven' }],
  } = {}) {
    this.mode =
      typeof mode === 'string' &&
      Object.hasOwn(MODE, mode) &&
      mode !== 'private-match'
        ? MODE[mode]
        : MODE['battle-royale']
    this.teamSize = this.mode.teams.includes(requested)
      ? requested
      : this.mode.defaultTeam
    this.seed = seed
    this.world = createWorld(mapForMode(this.mode, map).id, seed)
    this.difficulty = normalizeDifficulty(difficulty)
    this.botRules = DIFFICULTIES[this.difficulty]
    this.navigator = new BotNavigator(this.world)
    this.rand = randomSource(seed ^ 0x7ae4)
    this.time = 0
    this.players = new Map()
    this.slots = 0
    this.loot = new Map(
      this.world.pickups.map((item) => [item.id, { ...item }]),
    )
    this.changedLoot = new Map()
    this.lootVersion = 0
    this.dropIndex = 0
    this.targetDown = {}
    this.events = []
    this.eventId = 0
    this.lastGasTick = 0
    this.scores = { 0: 0, 1: 0 }
    this.result = null
    this.tags = this.mode.confirms ? new Map() : null
    this.control = this.mode.control ? createControl(this.world) : null
    if (this.control) this.scores = this.control.points
    this.training = null
    this.reinforcements = this.mode.gas ? reinforcements() : null
    this.fields = []
    this.fieldIndex = 0
    this.pings = new Map()
    this.contacts = new Map()
    this.capacity = clamp(Math.floor(capacity) || ROOM_LIMIT, 1, ROOM_LIMIT)
    this.botCount = clamp(Math.floor(bots ?? this.mode.bots), 0, this.capacity)
    this.rings = this.mode.gas ? this.makeRings() : []
    this.gas = this.mode.gas ? this.gasAt(0) : null
    for (const info of players.slice(0, this.capacity)) this.addPlayer(info)
    const slotsForBots = Math.min(
      this.botCount,
      this.capacity - this.players.size,
    )
    for (let i = 0; i < slotsForBots; i++) {
      const name =
        CALLSIGNS[i % CALLSIGNS.length] +
        (i >= CALLSIGNS.length
          ? `-${1 + Math.floor(i / CALLSIGNS.length)}`
          : '')
      // Alternate the kit split every six seats so team parity doesn't
      // permanently give one side all of a given role in a large arena.
      const pairOffset = this.mode.paired && Math.floor(i / 6) % 2
      const role = botProfileAt(pairOffset ? i ^ 1 : i)
      const kit = BOT_PROFILES[role]
      this.addPlayer({
        id: `bot${i + 1}`,
        name,
        role,
        weapon: kit.weapon,
        loadout: { tactical: kit.tactical },
        bot: true,
      })
    }
    this.initialTeams = new Set(
      [...this.players.values()].map((p) => p.team),
    ).size
  }
  makeRings() {
    const rings = []
    const scale = this.world.half / 389
    let start = 0,
      x = 0,
      z = 0,
      radius = 553 * scale
    for (const [i, phase] of RINGS.entries()) {
      const ringRadius = phase.radius * scale
      const angle = this.rand() * Math.PI * 2,
        offset = (radius - ringRadius) * (0.18 + this.rand() * 0.34)
      const nx = clamp(x + Math.cos(angle) * offset, -255 * scale, 255 * scale),
        nz = clamp(z + Math.sin(angle) * offset, -255 * scale, 255 * scale)
      rings.push({
        ...phase,
        radius: ringRadius,
        x,
        z,
        previous: radius,
        nx,
        nz,
        start,
        closing: start + phase.wait,
        end: start + phase.wait + phase.close,
        stage: i + 1,
      })
      x = nx
      z = nz
      radius = ringRadius
      start += phase.wait + phase.close
    }
    return rings
  }
  gasAt(time) {
    const phase =
      this.rings.find((ring) => time < ring.end) ?? this.rings.at(-1)
    const u = clamp((time - phase.closing) / phase.close, 0, 1)
    const overtime = clamp((time - phase.end) / 17, 0, 1)
    return {
      x: lerp(phase.x, phase.nx, u),
      z: lerp(phase.z, phase.nz, u),
      r: lerp(phase.previous, phase.radius, u) * (1 - overtime),
      nx: phase.nx,
      nz: phase.nz,
      nr: phase.radius * (1 - overtime),
      stage: phase.stage,
      damage: phase.damage + Math.round(overtime * 16),
      state: u >= 1 ? 'final' : time < phase.closing ? 'waiting' : 'closing',
      left: Math.max(
        0,
        (time < phase.closing ? phase.closing : phase.end) - time,
      ),
    }
  }
  event(type, data = {}) {
    this.events.push({
      id: ++this.eventId,
      time: round(this.time),
      type,
      ...data,
    })
    if (this.events.length > 900)
      this.events.splice(0, this.events.length - 900)
  }
  notice(p, text, tone = 'info') {
    this.event('notice', { actor: p.id, text, tone })
  }
  addPlayer(info) {
    if (this.players.size >= this.capacity || this.players.has(info.id))
      return null
    const index = this.slots++,
      tdm = this.mode.paired
    const team = this.mode.survival
      ? Number(Boolean(info.bot))
      : tdm
        ? index % 2
        : this.teamSize > 1
          ? Math.floor(index / this.teamSize)
          : index
    const loadout = normalizeLoadout(info.loadout, info.weapon)
    const p = {
      id: info.id,
      name: info.name ?? 'Operator',
      team,
      bot: Boolean(info.bot),
      owner: !info.bot && info.owner === true,
      role:
        info.bot && Object.hasOwn(BOT_PROFILES, info.role) ? info.role : null,
      index,
      alive: true,
      health: HEALTH_MAX,
      ...armorState(this.mode.drop || this.mode.map === 'range' ? 50 : 100, 2),
      cash: 0,
      kills: 0,
      streak: 0,
      bestStreak: 0,
      activeTime: 0,
      confirms: 0,
      denies: 0,
      deaths: 0,
      assists: 0,
      damageDone: 0,
      targets: 0,
      shots: 0,
      hits: 0,
      ...rescueState(),
      loadout,
      operator: loadout.operator,
      objective: 0,
      captures: 0,
      revives: 0,
      contracts: 0,
      pingReady: 0,
      services: 0,
      serviceReady: 0,
      shotAt: -10,
      lastDamage: -25,
      lastAttacker: null,
      input: { ...EMPTY_INPUT },
      ack: 0,
      received: 0,
      inputAt: 0,
      pending: {},
      respawnAt: 0,
      contract: null,
      shopId: null,
      killer: null,
      recentHits: {},
      brain: {
        next: 0,
        target: null,
        wx: 0,
        wz: 0,
        drop: 2.1 + this.rand() * 13.5,
        lean: this.rand() < 0.5 ? -1 : 1,
        aimLock: 0,
        missX: 0,
        missY: 0,
      },
    }
    if (this.mode.ladder) {
      p.gunStage = 0
      p.ladderPreset = loadout
      ladderEquip(p)
    } else applyPreset(p)
    if (p.bot && this.mode.drop) {
      const site =
        this.world.sites[
          (p.team * 3 + (this.seed % 11)) % this.world.sites.length
        ]
      const a = planeAt(0, this.world),
        b = planeAt(17.5, this.world),
        dx = b.x - a.x,
        dz = b.z - a.z
      const offset = this.teamSize > 1 ? 34 : 49
      p.brain.wx = site.x + (this.rand() * 2 - 1) * offset
      p.brain.wz = site.z + (this.rand() * 2 - 1) * offset
      const travel =
        ((p.brain.wx - a.x) * dx + (p.brain.wz - a.z) * dz) /
        (dx * dx + dz * dz)
      p.brain.drop = clamp(
        travel * 17.5 + (this.rand() - 0.5) * 1.95,
        1.5,
        15.9,
      )
    }
    Object.assign(p, this.spawn(p, this.mode.drop))
    p.input.yaw = p.yaw
    p.input.pitch = p.pitch
    this.players.set(p.id, p)
    return p
  }
  spawn(p, drop = false, near = null) {
    if (drop) {
      const plane = planeAt(this.time, this.world)
      return moveState(plane.x, plane.y, plane.z, 'plane', plane.yaw)
    }
    if (near) {
      const spot = this.safePoint(near.x + 6, near.z + 4)
      return moveState(
        spot.x,
        this.world.height(spot.x, spot.z) + 52,
        spot.z,
        'freefall',
        near.yaw,
      )
    }
    if (this.mode.map === 'range') {
      const s = this.world.spawns[0]
      return moveState(s.x, this.world.height(s.x, s.z), s.z, 'ground', 0)
    }
    const lane = this.mode.paired
      ? this.world.spawns.filter((s) => (p.team === 0 ? s.x < -18 : s.x > 18))
      : null
    const candidates = lane?.length ? lane : this.world.spawns
    let s = candidates[p.index % candidates.length],
      score = -Infinity
    for (const c of candidates) {
      if (!this.players.size) break
      let nearest = 260
      for (const foe of this.players.values())
        if (foe.alive && foe.team !== p.team && foe.id !== p.id)
          nearest = Math.min(nearest, distance(c, foe))
      const r = Math.min(nearest, 31) + this.rand() * 6
      if (r > score) {
        score = r
        s = c
      }
    }
    if (
      this.mode.gas &&
      this.gas.r < 140 &&
      distance(s, this.gas) > this.gas.r * 0.78
    ) {
      s = this.safePoint(
        this.gas.x + this.rand() * 15 - 7,
        this.gas.z + this.rand() * 15 - 7,
      )
    }
    return moveState(
      s.x,
      this.world.height(s.x, s.z),
      s.z,
      'ground',
      s.yaw ?? Math.atan2(s.x, s.z),
    )
  }
  safePoint(x, z) {
    let a = x,
      b = z
    for (let i = 0; i < 16; i++) {
      a = clamp(
        x + (i ? Math.sin(i * 2.4) * i * 1.45 : 0),
        -this.world.half + 2,
        this.world.half - 2,
      )
      b = clamp(
        z + (i ? Math.cos(i * 2.4) * i * 1.45 : 0),
        -this.world.half + 2,
        this.world.half - 2,
      )
      const y = this.world.height(a, b)
      if (
        ![...this.world.grid.nearby(a, b, 1.5)].some(
          (q) =>
            Math.abs(q.x - a) < q.w / 2 + 0.6 &&
            Math.abs(q.z - b) < q.d / 2 + 0.6 &&
            q.y < y + 1.3 &&
            q.y + q.h > y + 0.22,
        )
      )
        return { x: a, z: b }
    }
    return { x: a, z: b }
  }
  command(id, raw, sequence) {
    const p = this.players.get(id)
    if (!p || p.bot) return
    if (
      sequence !== undefined &&
      (!Number.isSafeInteger(sequence) ||
        sequence <= p.received ||
        sequence > p.received + 600)
    )
      return
    const input = cleanInput(raw)
    for (const key of ACTIONS) if (input[key]) p.pending[key] = true
    if (input.fire) p.pending.fire = true
    p.input = input
    p.inputAt = this.time
    p.received = sequence ?? p.received + 1
  }
  removePlayer(id) {
    const p = this.players.get(id)
    if (!p) return
    this.players.delete(id)
    this.pings.delete(id)
    this.event('leave', { actor: id, name: p.name })
  }
  respawn(p, by = null) {
    const near =
      by ||
      (this.mode.gas
        ? [...this.players.values()].find(
            (a) => a.alive && a.id !== p.id && a.team === p.team,
          )
        : null)
    Object.assign(
      p,
      this.spawn(p, false, near),
      armorState(50, 2),
      rescueState(),
      {
        alive: true,
        health: HEALTH_MAX,
        respawnAt: 0,
        shotAt: -10,
        lastDamage: this.time - 7,
        lastAttacker: null,
        killer: null,
        recentHits: {},
        shopId: null,
      },
    )
    applyPreset(p)
    if (this.mode.ladder) ladderEquip(p)
    p.input = { ...EMPTY_INPUT, yaw: p.yaw, pitch: p.pitch }
    p.pending = {}
    this.event('redeploy', { actor: p.id, yaw: p.yaw })
  }
  step(dt) {
    if (this.result) return
    this.time += dt
    if (this.gas) {
      const next = this.gasAt(this.time)
      if (next.state !== this.gas.state || next.stage !== this.gas.stage)
        this.event('circle', { state: next.state, stage: next.stage })
      this.gas = next
    }
    trimTactics(this)
    this.navigator.beginTick()
    updateReinforcements(this)
    const living = [...this.players.values()].filter((p) => p.alive)
    const reviveIntents = new Map()
    const trainee =
      this.mode.map === 'range' ? living.find((p) => !p.bot) : null
    if (trainee && this.training?.state === 'countdown')
      updateDrill(this, trainee)
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnAt > 0 && this.time >= p.respawnAt) {
          if (
            this.mode.id === 'resurgence' &&
            (this.gas.stage > 3 ||
              (this.teamSize > 1 && !living.some((a) => a.team === p.team)))
          )
            p.respawnAt = 0
          else this.respawn(p)
        }
        continue
      }
      let input = p.bot
        ? this.botInput(p, living)
        : {
            ...(this.time - p.inputAt > 0.44
              ? { ...EMPTY_INPUT, yaw: p.yaw, pitch: p.pitch }
              : p.input),
            ...Object.fromEntries(
              ACTIONS.map((key) => [key, Boolean(p.pending[key])]),
            ),
          }
      if (p.pending.fire) input.fire = true
      p.pending = {}
      p.ack = p.received
      if (
        !p.bot &&
        !p.downed &&
        (input.x ||
          input.z ||
          input.jump ||
          input.fire ||
          input.plate ||
          input.interact ||
          Math.abs(input.yaw - p.yaw) > 1e-3 ||
          Math.abs(input.pitch - p.pitch) > 1e-3)
      )
        p.activeTime += dt
      if (drillLocksInput(this, p))
        input = { ...EMPTY_INPUT, yaw: input.yaw, pitch: input.pitch }
      if (input.revive || p.downed) reviveIntents.set(p.id, input)
      const prevAir = p.air
      integrate(p, input, this.world, dt, this.time, (type) =>
        this.event(type, {
          actor: p.id,
          x: round(p.x),
          y: round(p.y),
          z: round(p.z),
        }),
      )
      if (prevAir === 'plane' && p.air !== 'plane' && !p.bot)
        this.notice(p, 'Freefall · deploy your parachute when ready')
      if (input.ping) setSquadPing(this, p, { kind: 'look' })
      if (p.downed) {
        if (p.contract && this.time >= p.contract.end) this.updateContract(p, 0)
        p.burstLeft = 0
        continue
      }
      const canUse = p.air === 'ground' && !p.climbing && !p.mantle
      const assisting =
        input.revive && rescueTarget(this.players.values(), p, this.world)
      if (assisting) {
        cancelPlating(p)
        p.reloadEnd = 0
        p.burstLeft = 0
        continue
      }
      if (
        canUse &&
        !this.mode.ladder &&
        (input.swap ||
          (input.primary && p.slot === 1) ||
          (input.sidearm && p.slot === 0)) &&
        swapWeapon(p, this.time)
      ) {
        cancelPlating(p)
        this.event('swap', { actor: p.id, weapon: p.weapon })
      }
      const weapon = equippedSpec(p)
      if (p.reloadEnd && this.time + 1e-7 >= p.reloadEnd) {
        const count = Math.min(weapon.mag - p.ammo, p.stock)
        p.ammo += count
        p.stock -= count
        p.reloadEnd = 0
        this.event('reloadDone', { actor: p.id })
      }
      updatePlating(
        p,
        input.plate,
        canUse && p.slide <= 0 && !p.reloadEnd,
        dt,
        (type) => this.event(type, { actor: p.id }),
      )
      if (
        !canUse ||
        p.plateActive ||
        input.plate ||
        (p.sprinting && p.slide <= 0)
      )
        p.burstLeft = 0
      if (canUse) {
        if (input.interact) this.interact(p)
        if (this.tags) takeTags(this, p)
        if (input.equipment) this.deployBox(p)
        if (input.tacticalUse) useTactical(this, p)
        if (!p.plateActive && !input.plate) {
          if (input.reload || (input.fire && p.ammo === 0)) this.startReload(p)
          if (
            (input.fire || p.burstLeft > 0) &&
            !p.reloadEnd &&
            p.swapReady <= this.time &&
            (!p.sprinting || p.slide > 0)
          )
            this.fire(p, input)
        }
      }
      if (this.time - p.lastDamage > 6.6 && p.health < HEALTH_MAX)
        p.health = Math.min(HEALTH_MAX, p.health + dt * 13)
      if (p.contract) this.updateContract(p, dt)
    }
    if (reviveIntents.size || living.some((p) => p.downed))
      updateRescues(this, reviveIntents, dt)
    if (this.training)
      updateDrill(
        this,
        trainee ?? [...this.players.values()].find((p) => !p.bot),
      )
    if (this.gas && this.time - this.lastGasTick >= 0.94) {
      this.lastGasTick = this.time
      for (const p of living)
        if (p.alive && p.air !== 'plane' && distance(p, this.gas) > this.gas.r)
          this.damage(p, this.gas.damage, null, 'gas')
    }
    for (const item of this.loot.values())
      if (item.endAt && item.endAt <= this.time && !item.removed) {
        item.removed = true
        this.markLoot(item)
        this.tags?.delete(item.id)
      }
    if (this.control) {
      const winner = updateControl(
        this.control,
        living,
        this.time,
        dt,
        (type, data) => this.event(type, data),
      )
      if (winner !== undefined) this.finish(winner)
    } else this.checkEnd()
    if (this.events.length && this.events[0].time < this.time - 7) {
      const index = this.events.findIndex((e) => e.time >= this.time - 7)
      this.events.splice(0, index < 0 ? this.events.length : index)
    }
  }
  startReload(p) {
    const w = equippedSpec(p)
    if (
      p.swapReady > this.time ||
      p.reloadEnd ||
      p.plateActive ||
      p.ammo === w.mag ||
      p.stock <= 0
    )
      return
    p.reloadStart = this.time
    p.reloadEnd = this.time + w.reload
    p.burstLeft = 0
    p.tactical = 0
    this.event('reload', { actor: p.id })
  }
  traceProjectile(p, o, dir, max) {
    let len = rayWorld(this.world, o, dir, max),
      hit = null,
      head = false
    for (const q of this.players.values()) {
      if (
        q === p ||
        !q.alive ||
        q.air === 'plane' ||
        q.team === p.team ||
        Math.abs(q.x - p.x) > len ||
        Math.abs(q.z - p.z) > len
      )
        continue
      const a = sphereRay(o, dir, q.x, q.y + q.height - 0.16, q.z, 0.235, len)
      const b = sphereRay(o, dir, q.x, q.y + q.height * 0.59, q.z, 0.345, len)
      const c = sphereRay(o, dir, q.x, q.y + q.height * 0.27, q.z, 0.25, len)
      if (Math.min(a, b, c) < len) {
        head = a <= b && a <= c
        hit = q
        len = Math.min(a, b, c)
      }
    }
    let target = null
    for (const t of this.world.targets) {
      if (
        (this.targetDown[t.id] ?? 0) > this.time ||
        !drillAllowsTarget(this, t)
      )
        continue
      const d = (t.z - o.z) / dir.z
      if (d <= 0.001 || d >= len) continue
      const r = Math.hypot(o.x + dir.x * d - t.x, o.y + dir.y * d - t.y)
      if (r < t.radius) {
        target = t
        hit = null
        len = d
        head = r < t.radius * 0.31
      }
    }
    return { hit, target, head, len, dir }
  }
  fire(p, input) {
    const w = equippedSpec(p)
    if (p.ammo <= 0 || this.time - p.shotAt + 0.012 < 60 / w.rpm) return
    if (w.burst && !p.burstLeft) {
      if (p.burstReady > this.time) return
      p.burstLeft = Math.min(p.ammo, w.burst)
    }
    p.shotAt = this.time
    p.ammo--
    p.shots++
    practiceShot(this)
    if (w.burst && --p.burstLeft === 0) p.burstReady = this.time + w.burstPause
    const spread =
      w.spread *
      (input.aim ? (w.pellets ? 0.75 : 0.3) * (w.aimSpread ?? 1) : 1) *
      (p.slide > 0 ? 1.45 : 1)
    const o = { x: p.x, y: p.y + eyeHeight(p), z: p.z }
    const strikes = new Map(),
      steel = new Map()
    let leading = null
    const pellets = w.pellets ?? 1,
      angle = pellets > 1 ? this.rand() * Math.PI * 2 : 0
    for (let i = 0; i < pellets; i++) {
      // Scatter uses a rotated disk with one central pellet. The pattern is
      // authoritative and represents a single ammunition/accuracy transaction.
      const theta = angle + i * 2.399963
      const radius = i === 0 ? 0 : spread * Math.sqrt(i / (pellets - 1))
      const jitter = pellets > 1 ? spread * 0.16 : spread
      const dir = aimVector(
        input.yaw + Math.cos(theta) * radius + (this.rand() * 2 - 1) * jitter,
        input.pitch + Math.sin(theta) * radius + (this.rand() * 2 - 1) * jitter,
      )
      const ray = this.traceProjectile(p, o, dir, w.distance)
      if (
        !leading ||
        ((ray.hit || ray.target) && !(leading.hit || leading.target))
      )
        leading = ray
      if (ray.target) {
        const previous = steel.get(ray.target.id)
        if (!previous || ray.head) steel.set(ray.target.id, ray)
      } else if (ray.hit) {
        const peer = ray.hit
        const balance = !p.bot
          ? 1
          : peer.bot
            ? this.mode.gas
              ? 0.58
              : 0.8
            : this.botRules.damage
        const falloff = lerp(
          1,
          w.pellets ? 0.31 : 0.56,
          clamp(
            (ray.len - w.falloff) / Math.max(1, w.distance - w.falloff),
            0,
            1,
          ),
        )
        const damage =
          w.damage *
          falloff *
          (ray.head ? (w.pellets ? 1.2 : 1.53) : 1) *
          balance
        const strike = strikes.get(peer.id) ?? { peer, damage: 0, head: false }
        strike.damage += damage
        strike.head ||= ray.head
        strikes.set(peer.id, strike)
      }
    }
    const { dir, len } = leading
    this.event('shot', {
      actor: p.id,
      weapon: p.weapon,
      start: [round(o.x), round(o.y), round(o.z)],
      end: [
        round(o.x + dir.x * len),
        round(o.y + dir.y * len),
        round(o.z + dir.z * len),
      ],
      impact: len < w.distance - 0.01,
      trace: p.shots % 3 === 1,
    })
    if (steel.size || strikes.size) p.hits++
    for (const ray of steel.values()) {
      const { target, head } = ray
      this.targetDown[target.id] = round(this.time + 1.22)
      p.targets++
      this.event('hit', { actor: p.id, target: target.id, head })
      drillHit(this, p, target, head)
    }
    for (const { peer, damage, head } of strikes.values()) {
      const status = this.damage(
        peer,
        Math.max(1, Math.round(damage)),
        p,
        'fire',
      )
      this.event('hit', {
        actor: p.id,
        target: peer.id,
        head,
        armor: status.absorbed > 0,
        broken: status.broken,
        eliminated: !peer.alive,
        downed: status.downed === true,
      })
    }
  }
  damage(p, amount, attacker = null, cause = 'fire') {
    if (!p.alive || amount <= 0) return { absorbed: 0, broken: false }
    if (cause === 'gas' && p.mask > 0) {
      amount = reduceGas(p, amount)
      if (!p.mask) this.notice(p, 'Gas filter depleted', 'warn')
      if (amount <= 0) return { absorbed: 0, broken: false }
    }
    const applied = Math.min(
      cause === 'gas' ? p.health : p.health + p.armor,
      amount,
    )
    const status = damageVitals(p, amount, cause === 'gas')
    p.lastDamage = this.time
    p.lastAttacker = attacker?.id ?? null
    if (attacker && attacker !== p) {
      p.recentHits[attacker.id] = this.time
      attacker.damageDone += applied
    }
    this.event('damage', {
      actor: p.id,
      from: attacker?.id ?? null,
      yaw: attacker ? Math.atan2(p.x - attacker.x, p.z - attacker.z) : null,
      amount: applied,
      cause,
      armor: status.absorbed > 0,
      broken: status.broken,
      interrupted: status.interrupted,
    })
    if (p.downed) {
      p.bleedHealth = p.health
      p.reviveProgress = 0
      p.reviver = null
    }
    if (p.health <= 0) {
      if (canFallDown(this, p, cause)) {
        knockDown(p, this.time, attacker)
        status.downed = true
        this.event('downed', {
          actor: p.id,
          target: attacker?.id ?? null,
          team: p.team,
          name: p.name,
        })
      } else
        this.eliminate(
          p,
          attacker ?? this.players.get(p.downedBy) ?? null,
          cause,
        )
    }
    return status
  }
  eliminate(p, by = null, cause = 'fire') {
    if (!p.alive) return
    p.alive = false
    p.downed = false
    p.bleedUntil = 0
    p.reviveProgress = 0
    p.reviver = p.reviving = null
    p.deaths++
    p.streak = 0
    p.killer = by?.id ?? null
    p.reloadEnd = 0
    p.vx = p.vy = p.vz = 0
    cancelPlating(p)
    p.contract = null
    recordContractKill(this, p, by)
    p.shopId = null
    if (by && by !== p && by.team !== p.team) {
      by.kills++
      by.streak++
      by.bestStreak = Math.max(by.bestStreak, by.streak)
      if (this.mode.ladder) {
        by.gunStage = Math.min(GUN_LADDER.length, by.gunStage + 1)
        ladderEquip(by)
        by.swapReady = this.time + 0.28
        if (by.gunStage < GUN_LADDER.length)
          this.event('promoted', {
            actor: by.id,
            weapon: by.weapon,
            stage: by.gunStage,
          })
      } else if ([3, 5, 8, 12].includes(by.streak))
        this.event('streak', { actor: by.id, count: by.streak })
      by.cash += this.mode.gas ? 350 : 0
      if (this.mode.id === 'team-deathmatch') this.scores[by.team]++
    } else if (this.mode.id === 'team-deathmatch') this.scores[1 - p.team]++
    for (const [id, time] of Object.entries(p.recentHits))
      if (id !== p.killer && this.time - time < 13) {
        const teammate = this.players.get(id)
        if (teammate) teammate.assists++
      }
    const allies = [...this.players.values()].some(
      (q) => q.alive && q.id !== p.id && q.team === p.team,
    )
    if (this.mode.survival && p.bot) p.respawnAt = this.time + 6
    else if (this.mode.goal || this.mode.map === 'range')
      p.respawnAt = this.time + 3.15
    else if (
      this.mode.id === 'resurgence' &&
      this.gas.stage <= 3 &&
      (this.teamSize === 1 ? p.deaths <= 2 : allies)
    )
      p.respawnAt = this.time + 7.5
    if (this.tags) dropTag(this, p)
    if (this.mode.gas) {
      if (p.cash)
        this.spawnLoot('cash', p.x + 0.28, p.z, {
          amount: Math.round(p.cash * 0.55),
        })
      if (p.plates)
        this.spawnLoot('plate', p.x - 0.58, p.z - 0.18, { amount: p.plates })
      if (p.armorBox) this.spawnLoot('box', p.x + 0.55, p.z - 0.64)
      if (p.mask > 0)
        this.spawnLoot('mask', p.x - 0.67, p.z + 0.6, { amount: p.mask })
      if (p.selfRevive) this.spawnLoot('revive', p.x + 0.8, p.z + 0.2)
      this.spawnLoot('ammo', p.x + 0.42, p.z + 0.56)
      p.cash = 0
    }
    this.event('kill', {
      actor: by?.id ?? null,
      target: p.id,
      attacker:
        by?.name ??
        (cause === 'gas'
          ? 'GAS'
          : cause === 'bleedout'
            ? 'BLEEDOUT'
            : 'FIELD TEST'),
      victim: p.name,
      cause,
    })
  }
  nearbyLoot(p) {
    return nearbyLoot(this.loot.values(), p, this.world)
  }
  markLoot(item) {
    item.rev = ++this.lootVersion
    this.changedLoot.set(item.id, item)
  }
  spawnLoot(type, x, z, extra = {}) {
    const item = {
      id: `d${++this.dropIndex}`,
      type,
      x: round(x),
      y: round(this.world.height(x, z)),
      z: round(z),
      ...extra,
    }
    this.loot.set(item.id, item)
    this.markLoot(item)
    return item
  }
  interact(p) {
    const item = this.nearbyLoot(p)
    if (
      !p.bot &&
      nearestStaff(this.world, p, item) &&
      !['countdown', 'active'].includes(this.training?.state)
    )
      return talkToStaff(this, p, item)
    if (!item || !drillPickupAllowed(this, item)) return
    switch (item.type) {
      case 'crate': {
        item.opened = true
        this.markLoot(item)
        const supplies = [
          ['plate', { amount: this.rand() < 0.52 ? 2 : 1 }],
          ['cash', { amount: Math.floor(3 + this.rand() * 7) * 100 }],
          ['ammo', {}],
        ]
        if (this.rand() < 0.36)
          supplies.push([this.rand() > 0.56 ? 'satchel' : 'box', {}])
        else if (this.rand() < 0.28)
          supplies.push([
            'weapon',
            {
              weapon:
                PRIMARY_IDS[
                  1 + Math.floor(this.rand() * (PRIMARY_IDS.length - 1))
                ],
            },
          ])
        if (this.mode.gas && this.rand() < 0.2)
          supplies.push([
            this.mode.id === 'battle-royale' && this.rand() < 0.24
              ? 'revive'
              : 'mask',
            {},
          ])
        if (this.rand() < 0.16) supplies.push(['tactical', {}])
        const playerAngle = Math.atan2(p.z - item.z, p.x - item.x)
        supplies.forEach(([type, extra], i) => {
          const angle = playerAngle + (i - (supplies.length - 1) * 0.5) * 0.89
          const s = this.safePoint(
            item.x + Math.cos(angle) * 1.24,
            item.z + Math.sin(angle) * 1.24,
          )
          this.spawnLoot(type, s.x, s.z, {
            ...extra,
            y: Math.max(item.y, this.world.height(s.x, s.z)),
          })
        })
        recordContractCrate(this, p, item)
        this.event('crate', { actor: p.id, x: item.x, y: item.y, z: item.z })
        this.notice(p, 'Supply crate opened')
        return
      }
      case 'plate': {
        const n = addPlates(p, item.amount ?? 1)
        if (!n) return this.notice(p, 'Armor reserves full', 'warn')
        item.amount = (item.amount ?? 1) - n
        this.notice(p, `+${n} armor plate${n === 1 ? '' : 's'}`, 'armor')
        if (item.amount > 0) {
          this.markLoot(item)
          this.event('pickup', { actor: p.id, item: 'plate' })
          return
        }
        break
      }
      case 'cash':
        p.cash += item.amount ?? 600
        this.notice(p, `+${cashText(item.amount ?? 600)} collected`, 'green')
        break
      case 'ammo': {
        const w = equippedSpec(p)
        let n = Math.min(w.stock - p.stock, Math.round(w.mag * 1.5))
        if (n < 1) return this.notice(p, 'Reserve ammunition full', 'warn')
        p.stock += n
        this.notice(p, `+${n} reserve ammunition`)
        break
      }
      case 'satchel':
        if (!equipSatchel(p))
          return this.notice(p, 'Armor satchel already equipped', 'warn')
        this.notice(p, 'Armor satchel equipped · 8 plate capacity', 'armor')
        break
      case 'box':
        if (p.armorBox)
          return this.notice(p, 'Armor box already equipped', 'warn')
        p.armorBox = true
        this.notice(p, 'Armor box equipped · Q to deploy', 'armor')
        break
      case 'refill': {
        if (item.usedBy?.includes(p.id))
          return this.notice(p, 'You already used this armor box', 'warn')
        if (item.team !== p.team)
          return this.notice(
            p,
            'This armor box belongs to another squad',
            'warn',
          )
        const amount = addPlates(p, p.capacity)
        if (!amount) return this.notice(p, 'Armor reserves full', 'warn')
        ;(item.usedBy ??= []).push(p.id)
        this.markLoot(item)
        this.notice(p, `+${amount} armor plates replenished`, 'armor')
        this.event('pickup', { actor: p.id, item: 'plate' })
        return
      }
      case 'supply':
        claimResupply(this, p, item)
        return
      case 'tactical':
        if (!restockTactical(p))
          return this.notice(p, 'Tactical equipment full', 'warn')
        this.notice(p, 'Tactical equipment restocked', 'green')
        break
      case 'mask':
        if (!this.gas || p.mask >= (item.amount ?? MASK_CAPACITY))
          return this.notice(p, 'No better gas filter available', 'warn')
        p.mask = item.amount ?? MASK_CAPACITY
        this.notice(p, 'Gas filter equipped', 'green')
        break
      case 'revive':
        if (this.mode.id !== 'battle-royale' || p.selfRevive)
          return this.notice(p, 'Self-revive unavailable', 'warn')
        p.selfRevive = true
        this.notice(p, 'Self-revive equipped · hold F when downed', 'green')
        break
      case 'weapon': {
        if (this.mode.ladder) return
        if (!replacePrimary(p, item))
          return this.notice(p, 'That primary is already equipped', 'warn')
        this.markLoot(item)
        this.event('pickup', { actor: p.id, item: 'weapon' })
        this.notice(p, `${equippedSpec(p).name} equipped`)
        return
      }
      case 'station':
        p.shopId = item.id
        this.event('shop', { actor: p.id, station: item.id })
        return
      case 'contract':
        if (p.contract)
          return this.notice(p, 'Finish your current contract first', 'warn')
        if (!this.acceptContract(p, item)) return
        break
      case 'dummy':
        this.rangeHit(p)
        return
      case 'reset':
        this.resetRange(p)
        return
      default:
        return
    }
    item.removed = true
    this.markLoot(item)
    this.event('pickup', { actor: p.id, item: item.type })
  }
  deployBox(p) {
    if (!p.armorBox || p.downed) return
    p.armorBox = false
    const f = forward(p.yaw),
      x = clamp(p.x + f.x * 1.36, -this.world.half, this.world.half),
      z = clamp(p.z + f.z * 1.36, -this.world.half, this.world.half)
    this.spawnLoot('refill', x, z, {
      y: Math.max(this.world.height(x, z), p.y - 0.15),
      team: p.team,
      endAt: this.time + 58,
      usedBy: [],
    })
    this.event('crate', { actor: p.id, x, y: p.y, z })
    this.notice(p, 'Armor box deployed · interact to refill', 'armor')
  }
  purchase(id, offerId) {
    const p = this.players.get(id),
      offer = SHOP.find((o) => o.id === offerId)
    if (this.result || !p?.alive || p.downed || !offer) return false
    const station = this.loot.get(p.shopId)
    if (
      !station ||
      distance(station, p) > 4.25 ||
      Math.abs(station.y - p.y) > 2.4
    )
      return (this.notice(p, 'Move closer to the Buy Station', 'warn'), false)
    if (p.cash < offer.price)
      return (
        this.notice(p, 'Insufficient cash for this purchase', 'warn'),
        false
      )
    const w = equippedSpec(p)
    if (offerId === 'plate' && !addPlates(p, 3))
      return (this.notice(p, 'Armor reserves full', 'warn'), false)
    if (offerId === 'box') {
      if (p.armorBox)
        return (this.notice(p, 'Armor box already equipped', 'warn'), false)
      p.armorBox = true
    }
    if (offerId === 'satchel' && !equipSatchel(p))
      return (this.notice(p, 'Armor satchel already equipped', 'warn'), false)
    if (offerId === 'ammo') {
      if (p.stock >= w.stock)
        return (this.notice(p, 'Reserve ammunition full', 'warn'), false)
      p.stock = w.stock
    }
    if (offerId === 'tactical' && !restockTactical(p))
      return (this.notice(p, 'Tactical equipment full', 'warn'), false)
    if (offerId === 'mask') {
      if (!this.gas || p.mask >= MASK_CAPACITY)
        return (this.notice(p, 'Gas filter unavailable', 'warn'), false)
      p.mask = MASK_CAPACITY
    }
    if (offerId === 'revive') {
      if (this.mode.id !== 'battle-royale' || p.selfRevive)
        return (this.notice(p, 'Self-revive unavailable', 'warn'), false)
      p.selfRevive = true
    }
    if (offerId === 'redeploy') {
      const ally = [...this.players.values()].find(
        (q) => !q.alive && q.team === p.team && q.id !== p.id,
      )
      if (!ally || !this.gas || this.gas.stage >= 5)
        return (
          this.notice(p, 'No eligible squadmate to redeploy', 'warn'),
          false
        )
      this.respawn(ally, p)
    }
    p.cash -= offer.price
    this.notice(p, `Purchased ${offer.name.toLowerCase()}`, 'green')
    this.event('purchase', { actor: p.id, item: offerId })
    return true
  }
  acceptContract(p, item) {
    return startContract(this, p, item)
  }
  updateContract(p, dt) {
    advanceContract(this, p, dt)
  }
  rangeHit(p) {
    if (
      this.mode.map !== 'range' ||
      !p.alive ||
      ['active', 'countdown'].includes(this.training?.state)
    )
      return
    this.damage(p, 64, null, 'test')
    if (p.alive) this.notice(p, 'Range hit simulated · 64 damage', 'warn')
  }
  resetRange(p, { silent = false } = {}) {
    this.training = null
    this.targetDown = {}
    this.loot = new Map(
      this.world.pickups.map((item) => [item.id, { ...item }]),
    )
    for (const item of this.changedLoot.values())
      if (String(item.id).startsWith('d')) {
        item.removed = true
        item.rev = ++this.lootVersion
      }
    for (const i of this.loot.values()) this.markLoot(i)
    p.health = HEALTH_MAX
    Object.assign(p, armorState(50, 2))
    p.cash = 0
    p.targets = 0
    p.shots = 0
    p.hits = 0
    p.lastDamage = -10
    const spec = equippedSpec(p)
    p.ammo = spec.mag
    p.stock = spec.stock
    p.contract = null
    p.reloadEnd = 0
    p.shopId = null
    if (!silent) this.notice(p, 'Training range reset', 'green')
  }
  drill(id, request) {
    const p = this.players.get(id)
    if (this.mode.map !== 'range' || !p) return false
    return request === 'cancel'
      ? cancelDrill(this, p)
      : startDrill(this, p, request)
  }
  ping(id, point) {
    return setSquadPing(this, this.players.get(id), point)
  }
  checkEnd() {
    if (this.mode.map === 'range') return
    const standings = [...this.players.values()]
    if (this.mode.survival) {
      if (!standings.some((p) => !p.bot && p.alive)) this.finish(1)
      else if (this.time >= this.mode.duration) this.finish(0)
      return
    }
    if (this.mode.gas) {
      const living = standings.filter((p) => p.alive)
      const teams = new Set(living.map((p) => p.team))
      const pendingNewTeam = standings.some(
        (p) =>
          !p.alive &&
          p.respawnAt > this.time &&
          !teams.has(p.team) &&
          this.gas.stage <= 3 &&
          this.teamSize === 1,
      )
      if (
        this.initialTeams > 1 &&
        this.time > 25 &&
        teams.size <= 1 &&
        !pendingNewTeam
      )
        this.finish(teams.size ? [...teams][0] : null)
    } else if (this.mode.paired) {
      if (
        Math.max(this.scores[0], this.scores[1]) >= this.mode.goal ||
        this.time >= this.mode.duration
      )
        this.finish(
          this.scores[0] === this.scores[1]
            ? null
            : this.scores[0] > this.scores[1]
              ? 0
              : 1,
        )
    } else {
      const count = (p) => (this.mode.ladder ? p.gunStage : p.kills)
      const r = standings.sort(
        (a, b) => count(b) - count(a) || a.deaths - b.deaths,
      )
      if (
        (r[0] && count(r[0]) >= this.mode.goal) ||
        this.time >= this.mode.duration
      )
        this.finish(
          r.length === 0 ||
            (r[1] && count(r[0]) === count(r[1]) && r[0].deaths === r[1].deaths)
            ? null
            : r[0].team,
        )
    }
  }
  finish(team) {
    this.result = {
      team,
      time: round(this.time),
      scores: { ...this.scores },
      mode: this.mode.id,
    }
    this.event('matchEnd', { team })
  }
  botInput(p, living) {
    return botInput(this, p, living)
  }
  snapshot() {
    return {
      time: this.time,
      players: [...this.players.values()],
      gas: this.gas,
      scores: this.scores,
      result: this.result,
      targetDown: this.targetDown,
      loot: this.loot,
      events: this.events,
      control: controlWire(this.control),
      training: this.training,
      fields: this.fields,
      pings: [...this.pings.values()],
      contacts: this.contacts,
    }
  }
  sharedWire() {
    return {
      kind: 'state',
      time: round(this.time, 1000),
      players: [...this.players.values()].map(wireActor),
      gas: this.gas,
      scores: this.scores,
      result: this.result,
      targets: this.targetDown,
      control: controlWire(this.control),
      fields: this.fields,
    }
  }
  selfWire(p) {
    const {
      brain,
      input,
      received,
      inputAt,
      pending,
      recentHits,
      ladderPreset,
      activeTime,
      ...self
    } = p
    return { ...self, inField: this.time, ...tacticalWire(this, p) }
  }
  lootSince(version = 0) {
    return [...this.changedLoot.values()].filter((i) => i.rev > version)
  }
}

export function nearbyLoot(items, p, world = null) {
  if (!p?.alive || p.downed || p.air !== 'ground' || p.mantle || p.climbing)
    return null
  const f = forward(p.yaw)
  let best = Infinity,
    choice = null
  for (const it of items) {
    if (
      it.removed ||
      it.opened ||
      it.falling ||
      (it.type === 'supply' && it.usedBy?.includes(p.id)) ||
      !LOOT[it.type] ||
      it.type === 'tag' ||
      it.type === 'friendlyTag' ||
      Math.abs(p.y - it.y) > 1.9 ||
      (it.type === 'refill' &&
        (p.team !== it.team || it.usedBy?.includes(p.id)))
    )
      continue
    const dx = it.x - p.x,
      dz = it.z - p.z
    if (Math.abs(dx) > 3.1 || Math.abs(dz) > 3.1) continue
    const d = Math.hypot(dx, dz)
    if (d > (it.type === 'station' ? 3.1 : 2.72)) continue
    const facing = d > 0.03 ? (dx * f.x + dz * f.z) / d : 1
    if (facing < -0.22 && d > 1.24) continue
    const score = d - facing * 0.94 + (it.type === 'crate' ? -0.06 : 0)
    if (score < best) {
      if (world && d > 0.42) {
        const o = { x: p.x, y: p.y + eyeHeight(p) * 0.82, z: p.z }
        const dy = it.y + (it.type === 'station' ? 1 : 0.26) - o.y,
          len = Math.hypot(dx, dy, dz)
        if (
          world.grid.rayHit(o, { x: dx / len, y: dy / len, z: dz / len }, len) <
          len - 0.27
        )
          continue
      }
      best = score
      choice = it
    }
  }
  return choice
}
function sphereRay(o, v, x, y, z, r, max) {
  const dx = x - o.x,
    dy = y - o.y,
    dz = z - o.z,
    t = dx * v.x + dy * v.y + dz * v.z
  if (t < -r || t - r > max) return max
  const d = dx * dx + dy * dy + dz * dz - t * t
  if (d > r * r) return max
  const first = t - Math.sqrt(Math.max(0, r * r - d))
  return first > 0 ? Math.min(max, first) : max
}
function wireActor(p) {
  return [
    p.id,
    p.name,
    p.team,
    round(p.x),
    round(p.y),
    round(p.z),
    round(p.yaw, 1000),
    round(p.pitch, 1000),
    round(p.height),
    AIM_STATES.indexOf(p.air),
    MOVE_STATES.indexOf(p.stance),
    Math.ceil(p.health),
    Math.ceil(p.armor),
    p.kills,
    p.deaths,
    bool(p.alive),
    p.weapon,
    round(p.vx),
    round(p.vz),
    round(p.shotAt),
    bool(p.bot),
    p.assists,
    bool(p.downed),
    p.operator,
    p.captures,
    p.revives,
    p.objective,
    round(p.reviveProgress ?? 0),
    p.role,
    bool(p.owner),
    p.confirms,
    p.denies,
    p.gunStage ?? 0,
    p.streak,
    p.loadout?.finish,
    p.loadout?.sideFinish,
  ]
}
