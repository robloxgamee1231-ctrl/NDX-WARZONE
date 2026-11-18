import { GUN_LADDER } from './arcade.js'
import { DIFFICULTIES } from './difficulty.js'
import { BOT_PROFILES } from './bot-ai.js'
import { SERVICES, canSeeStaff } from './support.js'
import { ARMOR_MAX, LOOT, SHOP, TEAM_NAMES, WEAPONS } from '../config.js'
import { icon, logo, weaponArt } from '../icons.js'
import { clamp, distance } from './world.js'
import { MapView } from './map-view.js'
import {
  MapInteractions,
  drillCards,
  drillPresentation,
  flightNumbers,
  mapPanel,
  relayTone,
  renderRelays,
} from './field-ui.js'
import { TACTICALS } from './loadout.js'
import { crateHeight } from './reinforcements.js'
import { onRelay } from './control.js'
import { calculateReport, formatSpecialties } from './records.js'

const esc = (n) =>
  String(n ?? '').replace(
    /[&<>'"]/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        c
      ],
  )
const num = (n) => Math.round(n ?? 0).toLocaleString('en-US')
const fmtTime = (n) => {
  const t = Math.max(0, Math.ceil(n))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const action = (id, text, style = 'secondary', glyph = '') =>
  `<button type="button" class="btn ${style}" data-game="${id}">${glyph ? icon(glyph, 16) : ''}${text}</button>`
const hudButton = (name, label, glyph) =>
  `<button type="button" class="hud-icon" data-game="${name}" aria-label="${label}" title="${label}">${icon(glyph, 17)}</button>`
const mid = (p) => (((360 - (p.yaw * 180) / Math.PI) % 360) + 360) % 360
const formatName = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const headings = (yaw) => formatName[Math.round(yaw / 45) % 8]
const touch = (key, label, glyph) =>
  `<button type="button" data-touch="${key}" aria-label="${label}">${icon(glyph, 22)}<small>${label}</small></button>`
const lootIcon = {
  crate: 'box',
  plate: 'plate',
  cash: 'cash',
  ammo: 'ammo',
  box: 'box',
  refill: 'box',
  satchel: 'pack',
  contract: 'diamond',
  station: 'cart',
  weapon: 'aim',
  reset: 'rotate',
  dummy: 'crosshair',
  tactical: 'bolt',
  mask: 'weather',
  revive: 'person',
  supply: 'box',
}

export class FieldHUD {
  constructor(
    root,
    mode,
    teamSize,
    world,
    room,
    callback,
    records,
    difficulty,
  ) {
    this.drillRecords = records ?? {}
    this.root = root
    this.mode = mode
    this.teamSize = teamSize
    this.room = room
    this.difficulty =
      DIFFICULTIES[difficulty]?.name ?? DIFFICULTIES.standard.name
    this.callback = callback
    this.map = new MapView(world)
    this.world = world
    this.toasts = []
    this.feed = []
    this.prevHud = -100
    this.live = 0
    this.pausePanel = null
    this.inspect = null
    this.markers = new Map()
    this.squadKey = ''
    this.weap = null
    this.panelKey = null
    const training = world.kind === 'range'
    root.innerHTML = `<div class="hud" aria-label="Combat heads-up display">
      <div class="effects-ui" id="hud-effects" aria-hidden="true">
        <div class="hurt-vignette" id="hud-hurt"></div><div class="gas-vignette" id="hud-gas"></div><div class="armor-crack" id="hud-crack">
          <svg viewBox="0 0 1600 900" preserveAspectRatio="none" fill="none"><g stroke="currentColor" stroke-width="1.7"><path d="M0 60l88 148 74 29 39 91m-113-120 3 110L0 397m88-189 82-77L134 0m28 237 70-21 63 63M1600 63l-108 128-22 114-78 69m100-183 108-23m-130 137 103 2 27 36M0 817l121-94 60-9 58-95m-118 104-9 127 40 50m1448-88-106-120-86-38-42-87m128 125-6 93 55 115m-135-246-33 40-80 16"/></g><g stroke="currentColor" opacity=".45"><path d="M91 318l55 59-36 116m122-277 18-64-37-65m1257 218-37-58-81-19M121 723l59 62 52 4m1262-97 83 18 23 39"/></g></svg>
        </div>
      </div>
      <div class="hud-nw"><button type="button" class="minimap" data-game="map" aria-label="Open tactical map" title="Tactical map (M)"><span class="map-header"><i></i><b>${world.map.chart}</b>${icon('reticle', 12)}</span><canvas id="hud-map" width="248" height="220" aria-hidden="true"></canvas><span class="map-footer"><b id="hud-geo">GRID 00 / 00</b><span>M ${icon('reticle', 11)}</span></span></button>
        <div class="phase-box" id="hud-phase">${icon(training ? 'crosshair' : 'clock', 15)}<span id="hud-phase-label">${training ? 'Live fire' : 'Safe zone'}</span><strong id="hud-timer">${training ? '00' : '00:00'}</strong></div>
        <div class="contract-card" id="hud-contract" hidden><span>${icon('diamond', 16)} <b id="hud-contract-name"></b><small id="hud-contract-range"></small></span><span id="hud-contract-info"></span><i><b id="hud-contract-progress"></b></i></div>
      </div>
      <div class="hud-n"><div class="compass" id="hud-compass"><div class="compass-ticks" id="hud-ticks"></div><i></i><strong id="hud-bearing">N <span>000</span></strong></div><div id="hud-match-tag" class="match-tag mono">${training ? 'ECHO PROVING GROUND' : `${mode.name} / ${mode.paired ? 'TEAMS' : (TEAM_NAMES[teamSize] ?? 'OPS')}`}</div><div id="hud-team-score" class="team-score" hidden></div><div id="hud-relays" class="relay-board" hidden></div><div class="drill-status" id="hud-drill" hidden><div><strong id="hud-drill-name"></strong><b id="hud-drill-timer" class="mono"></b></div><small id="hud-drill-hint"></small><i><b id="hud-drill-bar"></b></i></div></div>
      <div class="hud-ne"><div class="hud-topline"><span class="live-metric" title="Live teams or operators">${icon(mode.gas ? 'squad' : 'person', 15)}<b id="hud-count">—</b></span><span class="live-metric" title="Eliminations or targets hit">${icon(training ? 'crosshair' : 'skull', 15)}<b id="hud-elims">0</b></span>${training ? hudButton('drills', 'Range Drills (B)', 'reticle') : ''}${hudButton('score', 'Scoreboard (Tab)', 'network')}${hudButton('pause', 'Pause (P)', 'settings')}</div><div id="hud-feed" class="killfeed"></div></div>
      <div id="hud-marks" class="world-markers" aria-hidden="true"></div>
      <div class="crosshair" id="hud-crosshair" aria-hidden="true"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hit-marker" id="hud-hit" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="bearing-hit" id="hud-direction" aria-hidden="true"><i></i></div>
      <div class="center-messages"><div id="hud-zone" class="zone-warning" hidden>${icon('info', 15)} <b>You are in the gas</b></div><div id="hud-center" class="center-alert" hidden></div></div>
      <div class="hud-actions">
        <div class="rescue-card" id="hud-rescue" hidden><span>${icon('person', 18)} <strong id="hud-rescue-label"></strong><b id="hud-rescue-clock" class="mono"></b></span><small id="hud-rescue-hint"></small><i><b id="hud-rescue-fill"></b></i></div>
        <div class="relay-action" id="hud-relay-action" hidden><span>${icon('radio', 16)} <strong id="hud-relay-name"></strong></span><b id="hud-relay-status" class="mono"></b><i><b id="hud-relay-bar"></b></i></div>
        <div class="flight-instruments mono" id="hud-instruments" hidden><span><small>AGL</small><b id="hud-flight-alt">–</b></span><i><b id="hud-flight-bar"></b></i><span><small>VERTICAL</small><b id="hud-flight-speed">–</b></span><span><small>LANDING</small><b id="hud-flight-site">–</b></span></div>
        <div class="infil-box" id="hud-flight" hidden><div class="infil-icon">${icon('parachute', 25)}</div><div class="infil-info"><small class="mono" id="hud-flight-tag">INSERTION / FLIGHT PATH</small><strong id="hud-flight-label">Vantage Ridge</strong><span id="hud-flight-note"></span></div><button type="button" data-game="jump" class="btn primary" id="hud-flight-button"><kbd>SPACE</kbd> <span id="hud-flight-action">Jump</span></button><button type="button" data-game="cut" class="btn secondary" id="hud-cut" hidden><kbd>C</kbd> Cut chute</button></div>
        <button class="loot-prompt" id="hud-loot" type="button" data-game="interact" hidden><kbd>E</kbd><span id="hud-loot-icon"></span><span class="loot-text"><strong id="hud-loot-name"></strong><small id="hud-loot-meta"></small></span></button>
        <div id="hud-plate-work" class="plate-work" hidden>${icon('plate', 17)}<div><b>Inserting armor plate</b><i><span id="hud-plate-progress"></span></i></div></div>
        <div class="reload-hint" id="hud-reload" hidden></div>
        <div id="hud-spec" class="spec-box" hidden><div>${icon('eye', 18)} <span><small>SPECTATING</small><strong id="hud-spec-name"></strong></span></div><button type="button" class="btn secondary" data-game="spec-next">Next ${icon('arrow', 14)}</button></div>
      </div>
      <div class="hud-sw" id="hud-vitals">
        <div class="squad-stack" id="hud-squad"></div>
        <div class="player-card"><div class="player-main"><span class="player-emblem">${icon('reticle', 21)}</span><span><small id="hud-squad-title">${training ? 'RANGE OPERATOR' : 'SQUAD / 01'}</small><strong id="hud-name">OPERATOR</strong></span><b id="hud-cash" class="cash-counter">$0</b></div>
          <div class="armor-line"><div class="armor-segs" id="hud-armor" role="progressbar" aria-label="Armor" aria-valuemin="0" aria-valuemax="150" aria-valuenow="50"><i><span></span></i><i><span></span></i><i><span></span></i></div><div class="plate-reserve" title="Hold G or 4 to insert armor plates">${icon('plate', 14)}<b id="hud-plates" aria-label="Reserve armor plates">2</b><kbd>G</kbd></div></div>
          <div class="health-line"><div id="hud-health" role="progressbar" aria-label="Health" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span></span></div><b id="hud-hp">100 HP</b></div>
        </div>
        <div class="mini-notes" id="hud-toasts"></div>
      </div>
      <div class="hud-se" id="hud-weapon"><div id="hud-weapon-art" class="hud-weapon-art"></div><div class="weapon-card"><div class="weapon-label"><small id="hud-weapon-type">ASSAULT RIFLE</small><strong id="hud-weapon-name">RAVEN-4</strong></div><div class="ammo" aria-label="Ammunition"><b id="hud-mag">30</b><span>/</span><small id="hud-stock">120</small></div></div><div class="equipment" id="hud-equipment">${icon('box', 14)}<span id="hud-equip-name">NO ARMOR BOX</span><kbd>Q</kbd></div><div class="gear-indicators mono" id="hud-gear"></div></div>
      <div class="field-guide mono" id="hud-guide"><span>${training ? 'LIVE FIRE / SHOOT THE STEEL' : 'NDX / FIELD LINK'}</span><span id="hud-guide-input">${training ? 'E LOOT  ·  HOLD G PLATE' : 'WASD MOVE  ·  MOUSE LOOK'}</span>${training ? '<button type="button" class="range-test" data-game="range-test" title="Simulate a hit while practicing (T)"><kbd>T</kbd> Armor test</button>' : ''}</div>
      <div class="field-capture" id="hud-capture" hidden>${icon('aim', 13)} CLICK TO AIM <i></i> DRAG TO LOOK</div>
      <div class="touch-controls" aria-label="Touch controls"><div class="stick" aria-label="Move joystick"><span class="stick-cap"></span></div><div class="touch-gear">${touch('sprint', 'Sprint', 'bolt')}${touch('equipment', 'Box', 'box')}${touch('plate', 'Armor', 'plate')}${touch('tacticalUse', 'Gear', 'bolt')}${touch('ping', 'Mark', 'pin')}${mode.ladder ? '' : touch('swap', 'Swap', 'rotate')}</div><div class="touch-rescue" id="hud-revive-touch" hidden>${touch('revive', 'Revive', 'person')}</div><div class="touch-actions">${touch('interact', 'Loot', 'box')}${touch('jump', 'Jump', 'jump')}${touch('fire', 'Fire', 'crosshair')}${touch('crouch', 'Slide', 'slide')}${touch('aim', 'Aim', 'aim')}${touch('reload', 'Reload', 'rotate')}</div></div>
      </div><div class="field-panel" id="hud-panel" hidden></div>`
    this.nodes = Object.fromEntries(
      [...root.querySelectorAll('[id]')].map((n) => [n.id.slice(4), n]),
    )
    this.segments = [...this.nodes.armor.querySelectorAll('span')]
    this.health = this.nodes.health.firstElementChild
    this.abort = new AbortController()
    this.mapInteractions = new MapInteractions(
      root,
      this.map,
      callback,
      this.abort.signal,
    )
    root.addEventListener(
      'click',
      (e) => {
        const b = e.target.closest('[data-game]')
        if (b && !b.disabled) callback(b.dataset.game, b.dataset.offer)
      },
      { signal: this.abort.signal },
    )
  }
  text(key, value) {
    const el = this.nodes[key]
    if (el && el.textContent !== String(value)) el.textContent = value
  }
  html(key, value) {
    const n = this.nodes[key]
    if (this[`$${key}`] !== value && n) {
      this[`$${key}`] = value
      n.innerHTML = value
    }
  }
  toggle(key, on) {
    const n = this.nodes[key]
    if (n) n.hidden = !on
  }
  flash(key, cl = 'is-flashing', ms = 525) {
    const n = this.nodes[key]
    if (!n) return
    clearTimeout(this[`${key}Timeout`])
    n.classList.remove(cl)
    void n.offsetWidth
    n.classList.add(cl)
    this[`${key}Timeout`] = setTimeout(() => n.classList.remove(cl), ms)
  }
  event(e, me, gameTime) {
    if (e.type === 'kill') {
      this.feed.unshift({
        label: `<b>${esc(e.attacker)}</b>${icon(e.cause === 'gas' ? 'info' : 'skull', 13)}<span>${esc(e.victim)}</span>`,
        until: this.live + 5.8,
        own: e.actor === me.id || e.target === me.id,
      })
      this.feed = this.feed.slice(0, 5)
    }
    if (e.type === 'circle') {
      this.alert(
        e.state === 'final'
          ? 'FINAL CIRCLE'
          : e.state === 'closing'
            ? 'GAS IS CLOSING'
            : 'NEW SAFE ZONE',
        e.state === 'closing' ? 'warn' : 'gold',
        2.7,
      )
    }
    if (e.type === 'relayCaptured')
      this.alert(
        `${e.relay} ${e.team === me.team ? 'SECURED' : 'LOST'}`,
        e.team === me.team ? 'armor' : 'warn',
        1.7,
      )
    if (e.type === 'resupplyIn')
      this.alert('REINFORCEMENT DROP INBOUND', 'armor', 2.4)
    if (e.type === 'relayOvertime')
      this.alert('OVERTIME · CLAIM THE RELAYS', 'gold', 2.4)
    if (e.actor === me.id && e.type === 'tag')
      this.alert(
        e.denied ? 'TAG DENIED' : 'KILL CONFIRMED',
        e.denied ? 'armor' : 'gold',
        1.8,
      )
    if (e.actor === me.id && e.type === 'promoted')
      this.alert(`PROMOTED · ${WEAPONS[e.weapon].name}`, 'gold', 2.3)
    if (e.actor === me.id && e.type === 'streak')
      this.alert(`${e.count} ELIMINATION STREAK`, 'gold', 2)
    if (e.type === 'ping' && e.team === me.team) {
      this.toasts.unshift({
        text:
          e.actor === me.id
            ? 'Waypoint placed'
            : `${e.name} marked ${e.kind === 'danger' ? 'danger' : 'a waypoint'}`,
        tone: e.kind === 'danger' ? 'warn' : 'info',
        until: this.live + 2.55,
      })
      this.toasts = this.toasts.slice(0, 3)
    }
    if (e.type === 'rescued' && e.target === me.id)
      this.alert('BACK IN ACTION', 'armor', 1.6)
    if (e.actor !== me.id) return
    switch (e.type) {
      case 'notice':
        this.toasts.unshift({
          text: e.text,
          tone: e.tone,
          until: this.live + 3.85,
        })
        this.toasts = this.toasts.slice(0, 3)
        if (this.pausePanel === 'shop' && this.nodes['buy-note']) {
          this.text('buy-note', e.text)
          this.toggle('buy-note', true)
        }
        break
      case 'damage':
        this.flash('hurt', e.armor ? 'armor-hit' : 'is-flashing', 510)
        if (e.yaw !== null) {
          this.nodes.direction.style.transform = `translate(-50%,-50%) rotate(${((me.yaw - e.yaw) * 180) / Math.PI}deg)`
          this.flash('direction', 'is-flashing', 600)
        }
        if (e.broken) {
          this.flash('crack', 'is-flashing', 1000)
          this.alert('ARMOR BROKEN', 'armor', 1.8)
        } else if (e.interrupted)
          this.alert('PLATING INTERRUPTED', 'warn', 1.35)
        break
      case 'hit':
        this.nodes.hit.dataset.hit = e.eliminated
          ? 'kill'
          : e.broken
            ? 'armor'
            : e.head
              ? 'head'
              : 'normal'
        this.flash('hit', 'is-flashing', 220)
        if (e.eliminated) this.alert('ELIMINATION', 'armor', 1.42)
        break
      case 'land':
        if (gameTime < 33 && this.mode.drop)
          this.alert('OPERATION LIVE', 'armor', 2.1)
        break
      case 'downed':
        this.alert('OPERATOR DOWN', 'warn', 1.8)
        break
      case 'drillStart':
        this.alert('DRILL LIVE', 'armor', 1.3)
        break
      case 'drillDone':
        this.alert(
          e.passed ? `QUALIFIED · ${e.drill.grade}` : 'DRILL FAILED',
          e.passed ? 'gold' : 'warn',
          2.4,
        )
        break
      case 'redeploy':
        this.alert('REDEPLOYED', 'armor', 1.6)
        break
    }
  }
  alert(text, tone, duration) {
    this.alertUntil = this.live + duration
    this.nodes.center.dataset.tone = tone
    this.text('center', text)
    this.toggle('center', true)
  }
  update(s, me, focus, renderer, ui, dt) {
    this.live += dt
    const { time, gas } = s,
      p = focus ?? me
    const ground = p.air === 'ground',
      playing = me.alive && !ui.result,
      training = this.world.kind === 'range'
    const yaw = mid(p),
      direction = headings(yaw),
      display = String(Math.floor(yaw)).padStart(3, '0')
    this.root.classList.toggle('on-ground', ground)
    this.root.classList.toggle('on-air', !ground)
    this.root.classList.toggle('eliminated', !me.alive)
    this.root.classList.toggle('is-downed', !!me.downed)
    const spread = me.sprinting ? 8 : me.stance === 'slide' ? 4 : 0
    this.nodes.crosshair.style.setProperty(
      '--spread',
      `${spread + (WEAPONS[me.weapon]?.pellets ? 11 : 0)}px`,
    )
    this.toggle(
      'crosshair',
      playing &&
        ground &&
        !me.downed &&
        !me.plateActive &&
        !ui.lockedPanel &&
        !me.aim &&
        me.stance !== 'climb' &&
        me.stance !== 'mantle',
    )
    this.toggle('zone', !!gas && distance(p, gas) > gas.r && p.air !== 'plane')
    this.nodes.gas.classList.toggle(
      'active',
      !!gas && distance(p, gas) > gas.r && p.air !== 'plane',
    )
    this.toggle('center', this.alertUntil > this.live && !ui.result)
    this.toggle(
      'capture',
      !ui.capture &&
        !ui.touch &&
        !ui.lockedPanel &&
        playing &&
        ground &&
        this.live < 16,
    )
    this.toggle('vitals', !ui.result)
    this.toggle('weapon', playing && ground && !me.downed)
    this.toggle(
      'guide',
      playing &&
        ground &&
        !ui.touch &&
        !ui.lockedPanel &&
        (training || this.live < 25),
    )
    this.toggle('spec', !playing && !ui.result && ui.spectating && !ui.pause)
    this.text(
      'spec-name',
      focus?.id !== me.id
        ? (focus?.name ?? 'No active operator')
        : 'No active operator',
    )
    this.toggle('plate-work', playing && me.plateActive && !ui.lockedPanel)
    this.nodes['plate-progress'].style.width =
      `${clamp(me.plateProgress ?? 0, 0, 1) * 100}%`
    const doFlight = playing && !ground && !ui.lockedPanel
    this.toggle('flight', doFlight)
    this.toggle('instruments', doFlight && me.air !== 'plane')
    if (doFlight && me.air !== 'plane') {
      const pin = (s.pings ?? []).find((m) => m.id === me.id)
      const metrics = flightNumbers(
        me,
        this.world,
        pin ? { ...pin, name: 'WAYPOINT' } : null,
        this.mode,
      )
      this.text('flight-alt', `${metrics.agl}m`)
      this.text('flight-speed', `${metrics.speed} m/s`)
      this.text(
        'flight-site',
        `${metrics.name}${metrics.distance === null ? '' : ` · ${metrics.distance}m`}`,
      )
      this.nodes['flight-bar'].style.width = `${metrics.pct}%`
    }
    this.updateRescue(s, me, playing && !ui.lockedPanel, ui.revive)
    this.updateRelayFocus(s, me, playing && ground && !ui.lockedPanel)
    this.updateDrillState(s, me)
    if (doFlight) {
      const h = Math.floor(me.y - this.world.height(me.x, me.z))
      this.text(
        'flight-tag',
        me.air === 'plane'
          ? 'INSERTION / FLIGHT PATH'
          : `ALTITUDE / ${Math.max(0, h)} M`,
      )
      this.text(
        'flight-label',
        me.air === 'plane'
          ? this.world.map.name
          : me.air === 'chute'
            ? 'Parachute open'
            : 'Freefall',
      )
      this.text(
        'flight-note',
        me.air === 'plane'
          ? 'Open the map to mark a drop point.'
          : me.air === 'chute'
            ? 'Steer to your landing zone.'
            : 'Use movement keys to steer.',
      )
      this.toggle('flight-button', me.air !== 'chute')
      this.toggle('cut', me.air === 'chute' && h > 37)
      this.text('flight-action', me.air === 'plane' ? 'Jump' : 'Deploy chute')
    }
    const item = ui.nearby,
      openLoot =
        playing &&
        ground &&
        !!(item || ui.pad || ui.staff) &&
        !ui.lockedPanel &&
        !me.plateActive
    this.toggle('loot', openLoot)
    if (openLoot && ui.pad) {
      this.nodes.loot.style.setProperty('--loot', '#a1e9ec')
      this.html('loot-icon', icon('bolt', 21))
      this.text('loot-name', `Use ${ui.pad.label}`)
      this.text('loot-meta', 'AERIAL TRAVERSAL · DEPLOY CHUTE MID-AIR')
    } else if (openLoot && ui.staff) {
      const service = SERVICES[ui.staff.kind]
      this.nodes.loot.style.setProperty('--loot', service.tint)
      this.html('loot-icon', icon(service.icon, 21))
      this.text('loot-name', service.action)
      this.text('loot-meta', service.detail)
    } else if (openLoot) {
      const loot = LOOT[item.type],
        amount = item.amount
      this.nodes.loot.style.setProperty('--loot', loot.hex)
      this.html('loot-icon', icon(lootIcon[item.type], 21))
      this.text('loot-name', loot.action)
      this.text(
        'loot-meta',
        item.type === 'supply'
          ? `${item.count} CLAIMS LEFT · PRESET / AMMO / GEAR`
          : item.type === 'weapon'
            ? (WEAPONS[item.weapon]?.name ?? 'PRIMARY WEAPON')
            : item.type === 'cash'
              ? `$${num(amount ?? 600)}`
              : item.type === 'plate'
                ? `×${amount ?? 1}  ·  +50 ARMOR PER PLATE`
                : item.type === 'satchel'
                  ? 'CARRY UP TO 8'
                  : item.type === 'dummy'
                    ? '64 DAMAGE / ARMOR TEST'
                    : item.type === 'station'
                      ? 'GEAR & REDEPLOY'
                      : loot.name.toUpperCase(),
      )
    }
    const loading = me.reloadEnd > time
    const reload =
      playing &&
      ground &&
      !me.downed &&
      !openLoot &&
      !ui.lockedPanel &&
      (loading || me.ammo < 5) &&
      !me.plateActive
    this.toggle('reload', reload)
    if (reload)
      this.html(
        'reload',
        loading
          ? `<i style="--reload:${clamp((time - me.reloadStart) / (me.reloadEnd - me.reloadStart), 0, 1) * 100}%"></i> RELOADING`
          : `<kbd>R</kbd> ${me.stock > 0 ? 'RELOAD' : 'NO RESERVE AMMO'}`,
      )
    const contract = me.contract
    this.toggle('contract', !!contract)
    if (contract) {
      this.text('contract-name', contract.name)
      this.text('contract-range', `${Math.round(distance(p, contract))}m`)
      this.text(
        'contract-info',
        `${Math.floor(contract.progress)} / ${contract.goal} ${contract.task === 'recon' ? 'SECURED' : 'OPENED'}  ·  ${fmtTime(contract.end - time)}`,
      )
      this.nodes['contract-progress'].style.width =
        `${clamp(contract.progress / contract.goal, 0, 1) * 100}%`
    }
    this.updateMarkers(renderer, p, s, me)
    if (this.live - this.prevHud < 0.08) return
    this.prevHud = this.live
    this.text(
      'geo',
      `GRID ${String(clamp(1 + Math.floor(((p.x + this.world.half) / this.world.half) * 5), 1, 10)).padStart(2, '0')} / ${String(clamp(1 + Math.floor(((p.z + this.world.half) / this.world.half) * 5), 1, 10)).padStart(2, '0')}`,
    )
    this.map.draw(this.nodes.map, s, me, p)
    const mapCanvas = this.nodes.panel.querySelector('canvas')
    if (mapCanvas) this.map.draw(mapCanvas, s, me, p, true)
    this.html('bearing', `${direction} <span>${display}</span>`)
    const angle = ((yaw % 5) / 5) * 16
    this.nodes.ticks.style.transform = `translateX(${-angle}px)`
    const nearHeading = Math.floor(yaw / 5) * 5
    if (this.nearHeading !== nearHeading) {
      this.nearHeading = nearHeading
      this.html(
        'ticks',
        Array.from({ length: 23 }, (_, i) => {
          const a = (nearHeading + (i - 11) * 5 + 360) % 360
          return `<b class="${a % 15 === 0 ? 'major' : ''}">${a % 45 === 0 ? headings(a) : a % 30 === 0 ? a : ''}</b>`
        }).join(''),
      )
    }
    const alive = s.players.filter((q) => q.alive)
    const teams = new Set(alive.map((q) => q.team)).size
    this.text(
      'count',
      training
        ? '01'
        : `${String(alive.length).padStart(2, '0')}${this.mode.gas && this.teamSize > 1 ? ` / ${teams}` : ''}`,
    )
    this.text('elims', training ? me.targets : me.kills)
    this.text(
      'phase-label',
      gas
        ? gas.state === 'final'
          ? 'Final circle'
          : gas.state === 'closing'
            ? `Circle ${gas.stage} closing`
            : `Circle ${gas.stage} starts`
        : training
          ? 'Targets hit'
          : 'Time left',
    )
    this.text(
      'timer',
      gas
        ? fmtTime(gas.left)
        : training
          ? String(me.targets).padStart(2, '0')
          : fmtTime(this.mode.duration - time),
    )
    this.nodes.phase.classList.toggle(
      'warning',
      gas?.state === 'closing' || gas?.state === 'final',
    )
    const tdm = this.mode.paired && !s.control
    this.toggle('team-score', tdm || this.mode.ladder)
    this.toggle('relays', !!s.control)
    if (s.control)
      this.html('relays', renderRelays(s.control, me, s.scores, this.mode.goal))
    if (tdm) {
      this.html(
        'team-score',
        `<span>${String(s.scores[me.team] ?? 0).padStart(2, '0')}</span><small>${this.mode.confirms ? 'TAG RACE' : 'FIRST TO'} ${this.mode.goal}</small><span>${String(s.scores[1 - me.team] ?? 0).padStart(2, '0')}</span>`,
      )
    }
    if (this.mode.ladder)
      this.html(
        'team-score',
        `<span title="Your weapon tier">${Math.min((me.gunStage ?? 0) + 1, GUN_LADDER.length)}</span><small>WEAPON TIER / ${GUN_LADDER.length}</small><span title="Leader's weapon tier">${Math.min(1 + Math.max(0, ...s.players.map((p) => p.gunStage ?? 0)), GUN_LADDER.length)}</span>`,
      )
    this.text('name', me.name)
    this.text('cash', `$${num(me.cash)}`)
    this.text('hp', `${Math.ceil(me.health)} HP`)
    this.text('plates', me.plates)
    this.nodes.plates.setAttribute(
      'title',
      `${me.plates} / ${me.capacity} reserve plates${me.satchel ? ' · Satchel equipped' : ''}`,
    )
    this.nodes.plates.classList.toggle('has-satchel', !!me.satchel)
    this.nodes.health.setAttribute('aria-valuenow', Math.ceil(me.health))
    this.health.style.width = `${me.health}%`
    this.nodes.health.classList.toggle('critical', me.health < 30)
    this.nodes.armor.setAttribute('aria-valuenow', Math.ceil(me.armor))
    this.nodes.armor.setAttribute(
      'aria-valuetext',
      `${Math.ceil(me.armor)} of ${ARMOR_MAX} armor, ${me.plates} reserve plates`,
    )
    for (const [i, seg] of this.segments.entries())
      seg.style.width = `${clamp((me.armor - i * 50) * 2, 0, 100)}%`
    this.html(
      'squad',
      s.players
        .filter((q) => q.id !== me.id && q.team === me.team)
        .slice(0, 5)
        .map(
          (q, i) =>
            `<div class="squad-member ${q.downed ? 'downed-member' : q.alive ? '' : 'offline'}"><b>${i + 2}</b><span>${esc(q.name)}</span><i><span style="--hp:${q.health}%;--armor:${q.armor / 1.5}%"></span></i>${q.downed ? icon('person', 12) : q.alive ? '' : icon('skull', 12)}</div>`,
        )
        .join(''),
    )
    const gun = WEAPONS[me.weapon]
    if (this.weap !== gun.id) {
      this.weap = gun.id
      this.html('weapon-art', weaponArt(gun.id))
      this.text('weapon-name', gun.name)
      this.text(
        'weapon-type',
        gun.burst ? `${gun.type} / ×${gun.burst}` : gun.type,
      )
    }
    this.text('mag', String(me.ammo).padStart(2, '0'))
    this.text('stock', me.stock)
    this.nodes.mag.classList.toggle('low', me.ammo < 5)
    this.text('equip-name', me.armorBox ? 'ARMOR BOX' : 'NO ARMOR BOX')
    this.nodes.equipment.classList.toggle('equipped', me.armorBox)
    const gadget = TACTICALS[me.tacticalType]
    if (gadget)
      this.html(
        'gear',
        `<span title="${gadget.name}">${icon(gadget.icon, 13)} ${me.tacticalCharges} <kbd>V</kbd></span>${this.mode.ladder ? '<span>FIXED LADDER KIT</span>' : `<span title="Switch weapon slots">${me.slot === 1 ? 'SIDEARM' : 'PRIMARY'} <kbd>${me.slot === 1 ? '1' : '2'}</kbd></span>`}${me.mask > 0 ? `<span title="Gas filter durability">${icon('weather', 13)} ${Math.ceil((me.mask / 35) * 100)}%</span>` : ''}${me.selfRevive ? `<span title="Self-revive equipped">${icon('person', 13)} KIT</span>` : ''}`,
      )
    this.feed = this.feed.filter((event) => event.until > this.live)
    this.toasts = this.toasts.filter((n) => n.until > this.live)
    this.html(
      'feed',
      this.feed
        .map(
          (item) => `<div class="${item.own ? 'own' : ''}">${item.label}</div>`,
        )
        .join(''),
    )
    this.html(
      'toasts',
      this.toasts
        .map(
          (t) =>
            `<div class="field-toast ${t.tone}">${icon(t.tone === 'armor' ? 'plate' : t.tone === 'green' ? 'check' : t.tone === 'gold' ? 'diamond' : 'info', 13)}<span>${esc(t.text)}</span></div>`,
        )
        .join(''),
    )
    if (this.pausePanel === 'score') this.fillScore(s, me)
    if (this.pausePanel === 'shop') this.updateShop(me)
    if (this.pausePanel === 'respawn')
      this.text(
        'respawn-time',
        `${Math.max(0, Math.ceil(me.respawnAt - time))}s`,
      )
    if (this.pausePanel === 'pause')
      this.text(
        'fps-line',
        `${ui.fps} FPS · ${ui.online ? 'LIVE SERVER' : 'LOCAL SESSION'}${this.room ? ` · ROOM ${this.room}` : ''}`,
      )
  }
  updateRescue(s, me, show, target) {
    const working = me.reviving && s.players.find((p) => p.id === me.reviving)
    const visible = show && (me.downed || target || working)
    this.toggle('rescue', !!visible)
    this.toggle('revive-touch', !!visible && (!me.downed || me.selfRevive))
    if (!visible) return
    this.nodes.rescue.dataset.downed = String(!!me.downed)
    const targetName = working?.name ?? target?.name ?? ''
    const countdown = me.downed
      ? `${Math.max(0, Math.ceil(me.bleedUntil - s.time))}s`
      : ''
    this.text(
      'rescue-label',
      me.downed ? 'DOWNED' : `REVIVE ${targetName.toUpperCase()}`,
    )
    this.text('rescue-clock', countdown)
    const label = me.downed
      ? me.reviver && me.reviver !== me.id
        ? 'A squadmate is reviving you'
        : me.selfRevive
          ? 'Hold F or Revive to use your kit'
          : 'Crawl to cover · wait for a squadmate'
      : 'Hold F or Revive · stay still'
    this.text('rescue-hint', label)
    const progress = me.downed
      ? me.reviveProgress
      : (target?.reviveProgress ?? 0)
    this.nodes['rescue-fill'].style.width =
      `${clamp(progress ?? 0, 0, 1) * 100}%`
  }
  updateRelayFocus(s, me, show) {
    const r = show && s.control?.relays.find((relay) => onRelay(me, relay))
    this.toggle('relay-action', !!r)
    if (!r) return
    this.nodes['relay-action'].dataset.tone = relayTone(r, me.team)
    this.text('relay-name', `${r.id} · ${r.title}`)
    this.text(
      'relay-status',
      r.contested
        ? 'CONTESTED'
        : r.owner === me.team
          ? 'DEFENDING'
          : 'CAPTURING',
    )
    this.nodes['relay-bar'].style.width =
      `${r.owner === me.team ? 100 : Math.round(r.progress * 100)}%`
  }
  updateDrillState(s, me) {
    const status = s.training && drillPresentation(s.training, s.time, me)
    this.toggle('drill', !!status)
    if (!status) return
    this.nodes.drill.dataset.state = s.training.state
    this.text('drill-name', status.title)
    this.text('drill-timer', status.label)
    this.text('drill-hint', status.detail)
    this.nodes['drill-bar'].style.width = `${status.fill * 100}%`
  }
  updateMarkers(renderer, p, s, me) {
    const seen = new Set()
    const marker = (id, point, label, tone, glyph, range) => {
      const proj = renderer.project(point.x, point.y, point.z)
      if (!proj) return
      let m = this.markers.get(id)
      if (!m) {
        m = document.createElement('div')
        m.className = `world-marker ${tone}`
        m.innerHTML = `${icon(glyph, 13)}<span></span><small></small>`
        this.nodes.marks.append(m)
        this.markers.set(id, m)
      }
      m.className = `world-marker ${tone}`
      seen.add(id)
      m.style.left = `${proj.x}%`
      m.style.top = `${proj.y}%`
      if (m.children[1].textContent !== label) m.children[1].textContent = label
      if (m.children[2].textContent !== range) m.children[2].textContent = range
    }
    if (!this.pausePanel && p.air !== 'plane') {
      for (const m of s.pings ?? [])
        if (m.team === me.team && m.until > s.time)
          marker(
            `ping-${m.id}`,
            { ...m, y: m.y + 2.1 },
            m.kind === 'danger'
              ? 'DANGER'
              : m.id === me.id
                ? 'WAYPOINT'
                : `${m.name.toUpperCase()} MARK`,
            m.kind === 'danger' ? 'hostile' : 'waypoint',
            'pin',
            `${Math.round(distance(p, m))}m`,
          )
      for (const r of s.control?.relays ?? [])
        marker(
          `relay-${r.id}`,
          { ...r, y: r.y + 3.55 },
          `${r.id} / ${r.title.toUpperCase()}`,
          relayTone(r, me.team),
          'radio',
          `${Math.round(distance(p, r))}m`,
        )
      const t = s.training?.point
      if (t)
        marker(
          'drill',
          { ...t, y: t.y + (s.training.kind === 'steel' ? 1.03 : 2.15) },
          t.title?.toUpperCase() ?? `PLATE ${s.training.stage + 1}`,
          'waypoint',
          'reticle',
          `${Math.round(distance(p, t))}m`,
        )
      for (const item of s.loot.values())
        if (
          item.type === 'supply' &&
          !item.removed &&
          !item.opened &&
          distance(p, item) < 300
        ) {
          marker(
            item.id,
            {
              ...item,
              y: crateHeight(item, s.time) + (item.falling ? 6 : 2.3),
            },
            item.falling ? 'DROP INBOUND' : 'REINFORCEMENT DROP',
            'waypoint',
            'box',
            `${Math.round(distance(p, item))}m`,
          )
        }
    }
    if (p.air === 'ground' && !this.pausePanel) {
      for (const npc of this.world.staff)
        if (distance(p, npc) < 23 && canSeeStaff(this.world, p, npc)) {
          const service = SERVICES[npc.kind]
          const used = (me.services & service.flag) !== 0
          marker(
            `staff-${npc.id}`,
            { ...npc, y: npc.y + 2.46 },
            service.title.toUpperCase(),
            used ? 'neutral' : 'friendly',
            service.icon,
            used ? 'VISITED' : `${Math.ceil(distance(p, npc))}m`,
          )
        }
      if (me.contract) {
        const { x, z } = me.contract
        marker(
          'contract',
          { x, y: this.world.height(x, z) + 2.8, z },
          me.contract.task === 'recon' ? 'RECON' : 'SUPPLY RUN',
          'gold',
          'diamond',
          `${Math.round(distance(p, { x, z }))}m`,
        )
      }
      for (const q of s.players)
        if (
          q.team === me.team &&
          q.id !== p.id &&
          q.alive &&
          q.air !== 'plane' &&
          distance(p, q) < 118
        )
          marker(
            q.id,
            { x: q.x, y: q.y + q.height + 0.31, z: q.z },
            q.downed ? `${q.name} · DOWN` : q.name,
            q.downed ? 'contested' : 'friendly',
            'person',
            '',
          )
    }
    for (const [id, node] of this.markers)
      if (!seen.has(id)) {
        node.remove()
        this.markers.delete(id)
      }
  }
  show(type, me, s, opts = {}) {
    if (this.pausePanel === type && type !== 'shop') return
    this.pausePanel = type
    this.toggle('panel', !!type)
    this.root.classList.toggle('field-paused', !!type)
    if (!type) {
      this.nodes.panel.replaceChildren()
      return
    }
    const existing = this.nodes.panel
    const shell = (title, sub, inner, kind = '', close = true) =>
      `<section class="field-window ${kind}" role="dialog" aria-label="${title}"><div class="field-window-head"><div><span class="eyebrow">${sub}</span><h2>${title}</h2></div>${close ? hudButton('close', 'Close panel', 'close') : ''}</div>${inner}</section>`
    if (type === 'pause')
      existing.innerHTML = shell(
        'Operation Paused',
        'NDX / FIELD LINK',
        `<div class="field-window-content"><p>${opts.online ? 'The online operation continues while this menu is open.' : 'The local operation is paused. Resume when ready.'}</p><div class="pause-items">${action('close', 'Resume operation', 'primary', 'play')}${action('settings', 'Settings', 'secondary', 'settings')}${action('controls', 'Field controls', 'secondary', 'keyboard')}${action('exit', 'Exit to operations', 'danger', 'exit')}</div><span class="field-data mono" id="hud-fps-line"></span><small class="field-operation mono">${this.world.map.name}${this.mode.map === 'range' ? '' : ` / ${this.difficulty.toUpperCase()} NPC RULES`}</small></div>`,
      )
    if (type === 'score')
      existing.innerHTML = shell(
        'Scoreboard',
        this.mode.name,
        `<div class="field-window-content"><div id="hud-score-table" class="score-scroll"></div></div>`,
        'wide',
      )
    if (type === 'drills')
      existing.innerHTML = shell(
        'Range Drills',
        'ECHO / CERTIFICATION',
        drillCards(s.training, this.drillRecords),
        'drill-window',
      )
    if (type === 'map') {
      this.mapInteractions.reset(me)
      existing.innerHTML = shell(
        'Tactical Map',
        this.world.map.name,
        mapPanel(),
        'map-window',
      )
    }
    if (type === 'shop')
      existing.innerHTML = shell(
        'Buy Station',
        'FIELD SUPPLY / EXCHANGE',
        `<div class="field-window-content"><p>Available funds <strong class="shop-cash mono" id="hud-shop-cash">$${num(me.cash)}</strong></p><div class="shop-list">${SHOP.map((i) => `<button type="button" class="shop-item" data-game="buy" data-offer="${i.id}" ${me.cash < i.price ? 'disabled' : ''}><span>${icon(i.icon, 20)}</span><div><strong>${i.name}</strong><small>${i.desc}</small></div><b>$${num(i.price)}</b></button>`).join('')}</div><p id="hud-buy-note" class="buy-note" hidden></p></div>`,
      )
    if (type === 'eliminated')
      existing.innerHTML = shell(
        this.teamSize > 1 ? 'Operator Down' : 'Eliminated',
        'FIELD REPORT / OPERATOR LOST',
        `<div class="field-window-content"><p>${opts.ally ? 'Your squad is still active. Spectate while they work to bring you back.' : 'Stay to spectate the remaining operators or return to the operations center.'}</p><div class="pause-items">${action('spectate', 'Spectate match', 'primary', 'eye')}${action('replay', 'Deploy again', 'secondary', 'rotate')}${action('exit', 'Return to operations', 'secondary', 'exit')}</div></div>`,
        'elimination',
        false,
      )
    if (type === 'respawn')
      existing.innerHTML = shell(
        'Redeploying',
        'FIELD REPORT / OPERATOR LOST',
        `<div class="field-window-content"><p>Return to the operation in <strong class="shop-cash mono" id="hud-respawn-time">${Math.ceil(me.respawnAt - s.time)}s</strong></p><div class="panel-cta">${action('spectate', 'Spectate until respawn', 'primary', 'eye')}${action('exit', 'Exit to operations', 'secondary', 'exit')}</div></div>`,
        'respawn-window',
        false,
      )
    if (type === 'ended') {
      const win = opts.result?.team === me.team,
        draw = opts.result?.team === null
      const report = win
        ? this.mode.gas
          ? 'SURVIVAL VICTORY'
          : 'VICTORY'
        : draw
          ? 'DRAW'
          : 'OPERATION COMPLETE'
      const reportData = calculateReport(me, opts.result, this.mode.id)
      existing.innerHTML = `<section class="result-window ${win ? 'victory' : ''}" role="dialog" aria-label="${report}"><div class="result-icon">${win ? icon('trophy', 33) : logo}</div><div class="eyebrow">AFTER ACTION / ${esc(this.world.map.name)}</div><h2>${report}</h2><p>${win ? (this.mode.gas ? 'Your squad was the last one standing.' : this.mode.paired ? 'Your team secured the win.' : 'You led the operation.') : draw ? 'No side secured a decisive win.' : 'Review the results and prepare for the next operation.'}</p><div class="result-stats"><span><b>${me.kills}</b><small>ELIMINATIONS</small></span><span><b>${num(me.damageDone)}</b><small>DAMAGE DEALT</small></span><span><b>${fmtTime(s.time)}</b><small>TIME IN FIELD</small></span></div>${formatSpecialties(reportData, { localXp: !opts.online })}${this.mode.confirms ? `<p>${me.confirms} confirmed · ${me.denies} denied</p>` : ''}${opts.award ? `<p class="earned-result">+${opts.award.xp} CAREER XP · +${opts.award.credits} CR</p>` : opts.online ? '<p>No career reward this round.</p>' : ''}<div class="panel-cta">${action('exit', 'Return to operations', 'secondary', 'exit')}${action('replay', 'Deploy again', 'primary', 'rotate')}</div></section>`
    }
    if (type === 'lost')
      existing.innerHTML = shell(
        'Connection Lost',
        'NDX / FIELD LINK',
        `<div class="field-window-content"><p>The live connection ended. Return to operations to reconnect or deploy locally with bots.</p><div class="panel-cta">${action('exit', 'Return to operations', 'primary', 'exit')}</div></div>`,
        'elimination',
        false,
      )
    for (const node of existing.querySelectorAll('[id]'))
      this.nodes[node.id.slice(4)] = node
    if (type === 'score') this.fillScore(s, me)
    if (type === 'map')
      this.map.draw(existing.querySelector('canvas'), s, me, me, true)
    if (type === 'shop') this.updateShop(me)
    if (type === 'pause')
      this.text(
        'fps-line',
        `${opts.fps ?? 60} FPS · ${opts.online ? 'LIVE SERVER' : 'LOCAL SESSION'}${this.room ? ` · ROOM ${this.room}` : ''}`,
      )
    existing
      .querySelector(
        '.field-window-head button, .result-window .btn, .pause-items .btn, .panel-cta .btn',
      )
      ?.focus({ preventScroll: true })
  }
  updateShop(me) {
    this.text('shop-cash', `$${num(me.cash)}`)
    for (const b of this.nodes.panel.querySelectorAll('[data-offer]')) {
      const offer = SHOP.find((i) => i.id === b.dataset.offer)
      b.disabled =
        me.cash < offer.price ||
        (offer.id === 'satchel' && me.satchel) ||
        (offer.id === 'box' && me.armorBox) ||
        (offer.id === 'mask' && (!this.mode.gas || me.mask >= 35)) ||
        (offer.id === 'revive' &&
          (this.mode.id !== 'battle-royale' || me.selfRevive)) ||
        (offer.id === 'redeploy' && !this.mode.gas) ||
        (offer.id === 'tactical' &&
          me.tacticalCharges >= TACTICALS[me.tacticalType]?.count)
    }
  }
  fillScore(s, me) {
    const node = this.nodes['score-table']
    if (!node) return
    const ordered = [...s.players].sort(
      (a, b) =>
        (this.mode.confirms ? (b.confirms ?? 0) - (a.confirms ?? 0) : 0) ||
        b.kills - a.kills ||
        a.deaths - b.deaths ||
        a.name.localeCompare(b.name),
    )
    let html = `<table class="score-table"><thead><tr><th>OPERATOR</th><th>ELIMS</th><th>DEATHS</th><th>ASSISTS</th>${this.mode.confirms ? '<th>TAGS</th>' : this.mode.ladder ? '<th>TIER</th>' : this.mode.control ? '<th>RELAYS</th>' : this.mode.gas ? '<th>REVIVES</th>' : ''}<th>STATUS</th></tr></thead><tbody>`
    html += ordered
      .map(
        (p) =>
          `<tr class="${p.id === me.id ? 'score-you' : ''}"><td>${esc(p.name)}${p.id === me.id ? ' <small>YOU</small>' : ''}${p.bot ? ` <small title="NPC operator">NPC · ${BOT_PROFILES[p.role]?.name.toUpperCase() ?? 'OPERATOR'}</small>` : p.owner ? ' <small title="NDX owner">OWNER</small>' : ' <small>HUMAN</small>'}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td>${this.mode.confirms ? `<td>${p.confirms ?? 0} / ${p.denies ?? 0}</td>` : this.mode.ladder ? `<td>${Math.min((p.gunStage ?? 0) + 1, GUN_LADDER.length)}</td>` : this.mode.control ? `<td>${p.captures ?? 0}</td>` : this.mode.gas ? `<td>${p.revives ?? 0}</td>` : ''}<td>${p.downed ? 'DOWNED' : p.alive ? 'ACTIVE' : 'OUT'}</td></tr>`,
      )
      .join('')
    this.html('score-table', `${html}</tbody></table>`)
  }
  dispose() {
    this.abort.abort()
    for (const k of Object.keys(this))
      if (k.endsWith('Timeout')) clearTimeout(this[k])
  }
}
