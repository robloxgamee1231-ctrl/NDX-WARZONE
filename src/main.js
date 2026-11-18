import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow/latin-500.css'
import '@fontsource/barlow/latin-600.css'
import '@fontsource/barlow/latin-700.css'
import '@fontsource/barlow-condensed/latin-700.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import './launcher.css'
import './game.css'
import './expansion.css'
import './command.css'
import './combat.css'
import { CareerUI } from './career-ui.js'
import { escape } from './markup.js'
import { cosmetic } from './game/cosmetics.js'
import {
  CONTROLS,
  MODE,
  MODES,
  QUALITY,
  TEAM_NAMES,
  WEAPONS,
  initialSettings,
} from './config.js'
import { icon, logo } from './icons.js'
import { RoomConnection } from './network.js'
import { assetUrl, LIVE_ROOMS } from './site.js'
import {
  ATTACHMENT_SLOTS,
  FINISHES,
  OPERATORS,
  TACTICALS,
  normalizeLoadout,
  operatorStyle,
} from './game/loadout.js'
import {
  appendReport,
  calculateReport,
  cleanCallsign,
  dossierBody,
  normalizeProfile,
  progression,
  recordDrill,
} from './game/records.js'
import { armoryBody, updateArmory } from './armory.js'
import { missionSetup } from './mission-setup.js'
import { mapForMode, mapsForMode } from './game/map-catalog.js'
import {
  DIFFICULTIES,
  STANDARD_DIFFICULTY,
  LOCAL_DIFFICULTY,
  normalizeDifficulty,
} from './game/difficulty.js'

const $ = (id) => document.getElementById(id)
const load = (name) => {
  try {
    return JSON.parse(localStorage.getItem(`ndx-${name}`)) ?? {}
  } catch {
    return {}
  }
}
const save = (name, value) => {
  try {
    localStorage.setItem(`ndx-${name}`, JSON.stringify(value))
  } catch {
    /* Private browsing can disable storage. */
  }
}
const profile = normalizeProfile(load('profile'))
const settings = { ...initialSettings(), ...load('settings') }
if (!Object.hasOwn(QUALITY, settings.quality)) settings.quality = 'balanced'
let guestKit = normalizeLoadout(load('loadout'), settings.weapon)
let loadout = guestKit
settings.weapon = guestKit.primary
if (!['dynamic', 'clear', 'rain'].includes(settings.weather))
  settings.weather = 'dynamic'
for (const [key, min, max] of [
  ['fov', 65, 105],
  ['sensitivity', 15, 100],
  ['volume', 0, 100],
])
  settings[key] = Math.max(min, Math.min(max, Number(settings[key]) || 0))
settings.online = LIVE_ROOMS && settings.online === true
settings.difficulty = normalizeDifficulty(settings.difficulty, LOCAL_DIFFICULTY)
settings.reducedMotion = settings.reducedMotion === true
const panel = $('panel'),
  panelContent = $('panel-content'),
  teamMenu = $('team-options')
let mode = MODE['team-deathmatch'],
  teamsPicked = {},
  modalType = null,
  connection = null,
  lobbyTimer = null,
  game = null,
  loading = false,
  toastTimer,
  launchNonce = 0,
  counted = false
const career = new CareerUI({
  panel,
  show: showPanel,
  change: careerChanged,
  notify: toast,
})
const activeKit = () => career.account?.loadout ?? guestKit
const activeName = () => career.account?.callsign ?? profile.name
let operatorPick = null
const playlists = LIVE_ROOMS ? MODES : MODES.filter((item) => item.teams.length)
const mapsPicked = Object.fromEntries(
  MODES.filter((def) => def.teams.length).map((def) => [
    def.id,
    mapForMode(def, load('maps')?.[def.id]).id,
  ]),
)
const teamSize = () => teamsPicked[mode.id] ?? mode.defaultTeam
const mapChoice = (def = mode) => mapForMode(def, mapsPicked[def.id])
const defaultField = (def) => def.defaultMap ?? def.map
const playlistArt = (def) => def.art ?? def.id
const heroArt = (def, map) =>
  assetUrl(
    `media/${map.id !== defaultField(def) && def.teams.length ? map.art : def.id === 'battle-royale' ? 'vantage-hero' : playlistArt(def)}.webp`,
  )
const chosenDifficulty = () =>
  settings.online ? STANDARD_DIFFICULTY : settings.difficulty
function updateMissionStrip() {
  $('deployment-setup').hidden = !mode.teams.length
  $('selected-field').textContent = mapChoice().name
  $('selected-difficulty').textContent =
    mode.map === 'range'
      ? 'NO HOSTILES'
      : `${DIFFICULTIES[chosenDifficulty()].name.toUpperCase()} NPCS`
}

const updateSettings = () => {
  save('settings', settings)
  $('session-status').textContent = settings.online
    ? 'PUBLIC MATCHMAKING'
    : 'LOCAL BOT MATCH'
  updateMissionStrip()
  game?.applySettings(settings)
}
const level = () => progression(profile).level
function updateProfile() {
  const account = career.account
  $('operator-name').textContent = activeName()
  $('operator-level').textContent =
    account?.badge ??
    (account
      ? `RANK ${String(account.rank).padStart(2, '0')}`
      : LIVE_ROOMS
        ? 'GUEST / SIGN IN'
        : `LOCAL LV ${String(level()).padStart(2, '0')}`)
  $('owner-nav').hidden = account?.role !== 'owner'
  $('operator-level').classList.toggle('owner-badge', !!account?.badge)
  $('operator-level').title = account?.username ?? 'Local record'
}
function careerChanged(_account, live, rooms) {
  updateProfile()
  browserStatus()
  const people = $('live-people')
  people.textContent = career.available
    ? `${rooms.humans ?? 0} LIVE PLAYERS  /  ${rooms.bots ?? 0} NPCS`
    : 'LOCAL PLAY READY'
  const bulletin = $('live-bulletin')
  bulletin.hidden = !live.announcement && !live.event
  bulletin.innerHTML =
    live.announcement || live.event
      ? `<i></i><span>${live.event ? `<b>${escape(live.event.label)} · ${live.event.multiplier}× XP</b>` : ''}${live.announcement ? `<span>${escape(live.announcement)}</span>` : ''}</span>`
      : ''
}
for (const node of document.querySelectorAll('[data-icon]'))
  node.innerHTML = node.dataset.icon === 'logo' ? logo : icon(node.dataset.icon)
if (!LIVE_ROOMS) {
  $('site-edition').textContent = 'BROWSER EDITION'
  for (const node of document.querySelectorAll('[data-live-only]'))
    node.hidden = true
}
$('playlist-grid').innerHTML = playlists
  .map(
    (
      item,
      i,
    ) => `<button type="button" class="playlist-card" data-mode="${item.id}" aria-pressed="${item === mode}" aria-label="${item.name}">
  <img src="${assetUrl(`media/${playlistArt(item)}.webp`)}" alt="" width="640" height="357" />
  <span class="card-no">${String(i + 1).padStart(2, '0')}</span><span class="card-check">${icon('check', 13)}</span>
  <span class="card-label"><strong>${item.name}</strong><small>${item.tag}</small></span></button>`,
  )
  .join('')

function setMode(id) {
  if (!playlists.some((item) => item.id === id)) return
  mode = MODE[id]
  closeTeam()
  $('hero').dataset.mode = mode.id
  $('hero').dataset.accent =
    mode.featured || mode.confirms || mode.ladder ? 'ember' : 'ice'
  const map = mapChoice()
  const custom = mode.teams.length && map.id !== defaultField(mode)
  const src = heroArt(mode, map)
  if ($('hero-art').getAttribute('src') !== src) $('hero-art').src = src
  $('hero-kicker').innerHTML =
    `<i></i> ${mode.featured ? 'FEATURED ARENA' : mode.map === 'range' ? 'OPERATOR TRAINING' : mode.control ? 'OBJECTIVE PLAYLIST' : mode.id === 'private-match' ? 'CUSTOM OPERATIONS' : 'AVAILABLE PLAYLIST'}`
  $('hero-title').innerHTML = mode.title
    .map((word) => `<span>${word}</span>`)
    .join('')
  $('hero-description').textContent = custom
    ? map.description
    : mode.description
  $('hero-total').textContent = $('mode-total').textContent = String(
    playlists.length,
  ).padStart(2, '0')
  $('hero-index').textContent = String(playlists.indexOf(mode) + 1).padStart(
    2,
    '0',
  )
  $('hero-location').textContent = custom ? map.name : mode.location
  $('hero-sector').textContent =
    mode.id === 'private-match' ? mode.sector : `${map.sector} / A.O.`
  $('deploy-text').textContent =
    mode.id === 'private-match'
      ? 'Open lobby'
      : mode.map === 'range'
        ? 'Enter range'
        : 'Deploy now'
  $('team-picker').hidden = !mode.teams.length || mode.map === 'range'
  $('team-label').textContent = mode.paired
    ? 'Teams'
    : (TEAM_NAMES[teamSize()] ?? '')
  $('team-toggle').disabled = mode.teams.length === 1
  updateMissionStrip()
  for (const el of $('playlist-grid').children) {
    const active = el.dataset.mode === id
    el.classList.toggle('is-active', active)
    el.setAttribute('aria-pressed', active)
  }
}
function closeTeam(restore = false) {
  if (teamMenu.hidden) return
  teamMenu.hidden = true
  $('team-toggle').setAttribute('aria-expanded', 'false')
  if (restore) $('team-toggle').focus()
}
function toggleTeam() {
  if (mode.teams.length < 2) return
  if (!teamMenu.hidden) return closeTeam(true)
  teamMenu.innerHTML = mode.teams
    .map(
      (n) =>
        `<button type="button" class="team-option" data-team="${n}" aria-pressed="${n === teamSize()}">${TEAM_NAMES[n]}${n === teamSize() ? icon('check', 13) : ''}</button>`,
    )
    .join('')
  teamMenu.hidden = false
  $('team-toggle').setAttribute('aria-expanded', 'true')
  teamMenu.querySelector('[aria-pressed="true"]')?.focus()
}
function browserStatus() {
  const up = navigator.onLine
  $('connection-label').textContent = !up
    ? 'OFFLINE'
    : !LIVE_ROOMS
      ? 'LOCAL PLAY'
      : !career.ready
        ? 'CONNECTING'
        : career.available
          ? 'ROOMS LIVE'
          : 'LOCAL ONLY'
  $('connection-label').parentElement.classList.toggle(
    'offline',
    !up || (LIVE_ROOMS && career.ready && !career.available),
  )
}
window.addEventListener('online', () => {
  browserStatus()
  career.refresh()
})
window.addEventListener('offline', browserStatus)
function toast(text) {
  const node = $('toast')
  node.textContent = text
  node.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    node.hidden = true
  }, 3400)
}
function nav(type) {
  for (const b of document.querySelectorAll(
    '.nav-link, .facility-nav button',
  )) {
    const active = b.dataset.action === type
    b.classList.toggle('is-active', active)
    if (active) b.setAttribute('aria-current', 'page')
    else b.removeAttribute('aria-current')
  }
}
function showPanel(type, title, body, kicker = 'NDX / OPERATIONS') {
  closeTeam()
  career.resetPanel()
  panel.dataset.kind = type
  modalType = type
  panelContent.innerHTML = `<div class="panel-head"><div><small>${kicker}</small><h2 id="panel-title">${title}</h2></div><button type="button" class="icon-button" data-action="close" aria-label="Close">${icon('close', 19)}</button></div><div class="panel-body">${body}</div>`
  nav(
    [
      'loadout',
      'armory',
      'operators',
      'store',
      'events',
      'leaders',
      'multiplayer',
      'settings',
      'owner',
    ].includes(type)
      ? type
      : 'play',
  )
  if (!panel.open) {
    game?.setOverlay(true)
    panel.showModal()
  } else panel.scrollTop = 0
}
const field = (title, desc, control) =>
  `<label class="panel-field"><span><strong>${title}</strong><small>${desc}</small></span>${control}</label>`
const hostLabels = {
  mode: 'Game mode',
  teamSize: 'Team format',
  capacity: 'Room size',
  fill: 'Fill with bots',
  map: 'Battlefield',
  difficulty: 'NPC difficulty',
}
const select = (name, entries, value, attribute = 'data-setting') =>
  `<select ${attribute}="${name}"${attribute === 'data-host' ? ` aria-label="${hostLabels[name]}"` : ''}>${entries.map(([v, t]) => `<option value="${v}" ${String(v) === String(value) ? 'selected' : ''}>${t}</option>`).join('')}</select>`
const range = (name, value, min, max) =>
  `<span class="slider"><input type="range" data-setting="${name}" min="${min}" max="${max}" value="${value}"/><output>${value}</output></span>`
function settingsPanel() {
  showPanel(
    'settings',
    'Game Settings',
    `<p>Tune the battlefield for your device and play style. Settings are saved on this device.</p><div class="fields">
    ${field(
      'Graphics quality',
      'Performance is recommended for mobile. Ultra uses a larger render budget.',
      select(
        'quality',
        Object.entries(QUALITY).map(([id, q]) => [id, q.name]),
        settings.quality,
      ),
    )}
    ${field(
      'Weather',
      'Dynamic weather changes across the operation.',
      select(
        'weather',
        [
          ['dynamic', 'Dynamic'],
          ['clear', 'Clear'],
          ['rain', 'Rain'],
        ],
        settings.weather,
      ),
    )}
    ${field('Field of view', 'Horizontal view while not aiming.', range('fov', settings.fov, 65, 105))}
    ${field('Look sensitivity', 'Mouse, touch swipe, and drag.', range('sensitivity', settings.sensitivity, 15, 100))}
    ${field('Master volume', 'Weapons, armor, footsteps, and ambience.', range('volume', settings.volume, 0, 100))}
    ${field('Reduced camera motion', 'Reduces bob, landing shake, and sprint sway.', `<input type="checkbox" data-setting="reducedMotion" ${settings.reducedMotion ? 'checked' : ''}/>`)}
    ${LIVE_ROOMS ? field('Public matchmaking', 'Off: start instantly with bots. On: find other players and fill with bots.', `<input type="checkbox" data-setting="online" ${settings.online ? 'checked' : ''}/>`) : ''}
    ${document.fullscreenEnabled ? field('Fullscreen', 'Expand the game or launcher to fill this display.', `<button type="button" class="btn secondary" data-action="fullscreen">${document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}</button>`) : ''}
    </div>${LIVE_ROOMS ? '' : `<p class="setup-note">This edition supports local bot matches and training. Online rooms require a multiplayer server.</p>`}<div class="panel-cta"><button type="button" class="btn secondary" data-action="reset-settings">Restore defaults</button><button type="button" class="btn primary" data-action="close">Done ${icon('check', 15)}</button></div>`,
    'SYSTEM / PREFERENCES',
  )
}
function saveKit() {
  if (career.account) return
  guestKit = loadout
  settings.weapon = loadout.primary
  save('loadout', guestKit)
  updateSettings()
}
function drawKitPreview() {
  const host = panel.querySelector('[data-model-preview]')
  if (host) career.inspect(host, { id: loadout.primary, style: loadout.finish })
}
function loadoutPanel(inspect = false, keep = false) {
  if (!keep) loadout = activeKit()
  showPanel(
    inspect ? 'armory' : 'loadout',
    inspect ? 'Armory inspection' : 'Weapon Loadout',
    armoryBody(loadout, { account: career.account, inspect }),
    'ARMORY / DEPLOYMENT KIT',
  )
  drawKitPreview()
}
function operatorsPanel(pick = activeKit().operator) {
  const items = [
    ...Object.values(OPERATORS),
    ...(career.account?.inventory ?? [])
      .map(cosmetic)
      .filter((c) => c?.kind === 'outfit'),
  ]
  const item = items.find((o) => o.id === pick) ?? OPERATORS.auto
  operatorPick = item.id
  showPanel(
    'operators',
    'Operator Locker',
    `<div class="operator-locker"><div class="model-preview" data-model-preview><span class="mono" data-preview-status role="status">Loading 3D model…</span></div><div class="operator-locker-copy"><small class="eyebrow">FIELD RIG / ANIMATED INSPECTION</small><h3>${item.name}</h3><p>${item.desc ?? 'Career palette for the ' + item.target + ' rig. Cosmetic only.'}</p><div class="panel-cta"><button type="button" class="btn primary" data-action="save-operator">${activeKit().operator === item.id ? 'Equipped' : 'Equip operator'}</button>${LIVE_ROOMS ? '<button type="button" class="btn secondary" data-action="outfits">Browse outfits</button>' : ''}</div><p data-career-feedback class="career-feedback" hidden aria-live="polite"></p></div></div><div class="rig-choices" role="group" aria-label="Owned operator skins">${items.map((o) => `<button class="armory-choice" type="button" data-skin="${o.id}" aria-pressed="${o.id === item.id}"><span class="eyebrow">${o.target ?? 'FIELD ISSUE'}</span><strong>${o.name}</strong></button>`).join('')}</div>`,
    'ARMORY / OPERATOR CUSTOMIZATION',
  )
  career.inspect(panel.querySelector('[data-model-preview]'), {
    kind: 'operator',
    id: item.model ?? (item.id === 'nomad' ? 'nomad' : 'warden'),
    style: item.id,
  })
}
async function commitKit(kit, done) {
  if (!career.account) {
    loadout = normalizeLoadout(kit)
    saveKit()
    done?.()
    return
  }
  if (career.account.mustRotate) {
    career.renderAuth('password')
    return
  }
  await career.perform('kit', { loadout: kit }, () => {
    toast('Deployment kit saved.')
    done?.()
  })
}
function controlsPanel() {
  showPanel(
    'controls',
    'Field Controls',
    `<p>Use the mouse to aim. Click the field to capture your cursor; if mouse capture is unavailable, drag to look. Touch devices use the left stick, right-side swipe, and on-screen actions.</p><div class="control-grid">${CONTROLS.map(([keys, label]) => `<div><span>${label}</span><kbd>${keys}</kbd></div>`).join('')}</div><div class="panel-cta"><button type="button" class="btn primary" data-action="close">Understood ${icon('check', 15)}</button></div>`,
    'FIELD MANUAL / INPUT',
  )
}
function localProfilePanel(tab = 'career') {
  showPanel(
    'profile',
    'Service Record',
    dossierBody(profile, tab),
    'NDX / OPERATOR DOSSIER',
  )
}

panel.addEventListener('local-dossier', () => localProfilePanel())
const difficultyOptions = () =>
  Object.entries(DIFFICULTIES).map(([id, d]) => [id, d.name])
const mapOptions = (mode) => mapsForMode(mode).map((m) => [m.id, m.name])
function setupPanel(restore) {
  if (!mode.teams.length) return
  showPanel(
    'setup',
    'Mission Setup',
    missionSetup(mode, mapChoice(), settings.difficulty, settings.online),
    'FIELD COMMAND / PRE-DEPLOYMENT',
  )
  if (restore) panel.querySelector(restore)?.focus()
}
function privatePanel(code = '', error = '') {
  if (!LIVE_ROOMS) return
  const hostModes = MODES.filter(
    (i) =>
      i.teams.length &&
      i.map !== 'range' &&
      (career.account?.role === 'owner' ||
        !career.live.disabled.includes(i.id)),
  )
  const hostMode = hostModes.includes(mode)
    ? mode
    : (hostModes.find((i) => i.id === 'battle-royale') ?? hostModes[0])
  showPanel(
    'private',
    'Private Match',
    `<p>Create a room for your crew, or use an invite code to join someone else's lobby on this server.</p>${
      hostMode
        ? `<form id="host-form"><div class="room-form"><label>Game mode ${select(
            'mode',
            hostModes.map((i) => [i.id, i.name]),
            hostMode.id,
            'data-host',
          )}</label><label>Battlefield <span id="host-map">${select('map', mapOptions(hostMode), mapChoice(hostMode).id, 'data-host')}</span></label><label>Team format <span id="host-team">${select(
            'teamSize',
            hostMode.teams.map((n) => [
              n,
              hostMode.paired ? 'Teams' : TEAM_NAMES[n],
            ]),
            hostMode.defaultTeam,
            'data-host',
          )}</span></label><label>Room size ${select(
            'capacity',
            [
              [12, '12 operators'],
              [24, '24 operators'],
              [48, '48 operators'],
              [100, '100 operators'],
            ],
            24,
            'data-host',
          )}</label><label>Fill with bots ${select(
            'fill',
            [
              [1, 'Enabled'],
              [0, 'Disabled'],
            ],
            1,
            'data-host',
          )}</label><label>NPC difficulty ${select('difficulty', difficultyOptions(), settings.difficulty, 'data-host')}</label></div><div class="panel-cta"><button class="btn primary" type="submit">${icon('lock', 16)} Create room</button></div></form>`
        : '<p>All public playlists are closed by the server owner.</p>'
    }<form class="room-join" id="join-form"><input name="code" value="${escape(code)}" placeholder="ROOM CODE" maxlength="5" pattern="[A-Za-z0-9]{5}" aria-label="Room code" required autocomplete="off"/><button class="btn secondary" type="submit">Join room ${icon('arrow', 15)}</button></form>${error ? `<p class="form-message" role="alert">${escape(error)}</p>` : ''}`,
    'OPERATIONS / SECURE CHANNEL',
  )
}
function renderLobby(info) {
  if (!connection || game || loading) return
  clearInterval(lobbyTimer)
  const host = info.host === connection.id,
    def = MODE[info.mode],
    format = def.paired ? 'Teams' : (TEAM_NAMES[info.teamSize] ?? 'Operators'),
    map = mapForMode(def, info.map),
    difficulty = DIFFICULTIES[normalizeDifficulty(info.difficulty)]
  showPanel(
    info.public ? 'queue' : 'lobby',
    info.public ? 'Finding a Match' : 'Operation Lobby',
    `${info.public ? `<div class="room-banner"><div class="room-state"><small class="eyebrow">PUBLIC MATCHMAKING</small><strong>${def.name} / ${format}</strong></div><span id="queue-count" class="mono"></span></div>` : `<div class="room-banner"><div><span class="eyebrow">ROOM CODE</span><b>${info.code}</b></div><button class="btn secondary" type="button" data-action="invite">${icon('copy', 15)} Copy invite</button></div><p>${def.name} · ${format} · ${info.fill ? 'Bot fill enabled' : 'Human operators only'}</p>`}
    <div class="lobby-operation mono">${icon('pin', 16)} <b>${map.name}</b>${info.fill ? `<i></i><span>${difficulty.name} NPCs</span>` : ''}</div>
    <div class="fields"><span class="eyebrow">${info.players.length} / ${info.cap} CONNECTED</span><ul class="roster">${info.players.map((p) => `<li><span>${escape(p.name)}${p.id === connection.id ? ' (you)' : ''}</span><em>${p.owner ? 'NDX OWNER · ' : p.guest ? 'GUEST · ' : ''}${p.id === info.host ? 'HOST' : 'HUMAN'}</em></li>`).join('')}</ul></div>
    <p class="form-message" id="room-error" hidden role="alert"></p>
    <div class="panel-cta"><button class="btn secondary" type="button" data-action="leave-room">Leave ${icon('exit', 14)}</button>${host && !info.public ? `<button class="btn secondary" type="button" data-action="toggle-fill">${info.fill ? 'Disable' : 'Enable'} bots</button><button class="btn primary" type="button" data-action="start-room">${icon('play', 15)} Start match</button>` : !info.public ? '<span class="eyebrow" style="align-self:center">WAITING FOR HOST</span>' : ''}</div>`,
    'MATCH CONTROL / LOBBY',
  )
  if (info.public) {
    const tick = () => {
      if ($('queue-count'))
        $('queue-count').textContent =
          `T−${String(Math.max(0, Math.ceil((info.startAt - Date.now()) / 1000))).padStart(2, '0')}s`
    }
    tick()
    lobbyTimer = setInterval(tick, 250)
  }
}
function clearRoom() {
  clearInterval(lobbyTimer)
  connection?.close()
  connection = null
}
function connect(operation) {
  if (!LIVE_ROOMS) return
  clearRoom()
  const net = new RoomConnection()
  connection = net
  showPanel(
    operation.op === 'quick' ? 'queue' : 'joining',
    'Contacting HQ',
    `<p>Opening a live connection to the operations network…</p><div class="panel-cta"><button type="button" class="btn secondary" data-action="leave-room">Cancel</button></div>`,
    'MATCH CONTROL / NETWORK',
  )
  net.addEventListener('lobby', (e) => {
    if (connection === net) renderLobby(e.detail)
  })
  net.addEventListener('error', (e) => {
    if (connection !== net) return
    const msg = $('room-error')
    if (msg && net.lobby) {
      msg.textContent = e.detail
      msg.hidden = false
      return
    }
    clearRoom()
    if (operation.op === 'quick')
      showPanel(
        'error',
        'Matchmaking Unavailable',
        `<p>${escape(e.detail)}</p><div class="panel-cta"><button class="btn secondary" type="button" data-action="close">Back</button><button class="btn primary" type="button" data-action="local">Deploy locally</button></div>`,
        'MATCH CONTROL / NETWORK',
      )
    else privatePanel(operation.code ?? '', e.detail)
  })
  net.addEventListener('disconnect', (e) => {
    if (connection !== net || game || loading) return
    clearRoom()
    if (operation.op === 'quick')
      showPanel(
        'error',
        'Connection Lost',
        `<p>${escape(e.detail)}</p><div class="panel-cta"><button class="btn primary" type="button" data-action="local">Deploy locally</button></div>`,
        'MATCH CONTROL / NETWORK',
      )
    else privatePanel(operation.code ?? '', e.detail)
  })
  net.addEventListener('begin', (e) => {
    if (connection === net)
      launch({
        mode: e.detail.mode,
        teamSize: e.detail.teamSize,
        seed: e.detail.seed,
        map: e.detail.map,
        difficulty: e.detail.difficulty,
        network: net,
      })
  })
  const kit = activeKit()
  net.open({
    ...operation,
    name: activeName(),
    weapon: kit.primary,
    loadout: kit,
  })
}
function closePanel() {
  if (panel.open) panel.close()
}
panel.addEventListener('close', () => {
  if (panel.open) return
  if (['lobby', 'queue', 'joining'].includes(modalType) && !loading && !game)
    clearRoom()
  modalType = null
  nav('home')
  game?.setOverlay(false)
})
function record(p, result) {
  if (counted || !p || !game || game.mode.map === 'range') return
  counted = true
  if (game.network && career.account) {
    if (result) career.refresh()
    return
  }
  const details = calculateReport(
    { ...p, inField: game.snap?.time ?? p.inField },
    result,
    game.mode.id,
  )
  if (appendReport(profile, details)) {
    save('profile', profile)
    updateProfile()
  }
}
function drillRecord(state) {
  if (!recordDrill(profile, state)) return false
  save('profile', profile)
  return true
}
function returnToMenu() {
  launchNonce++
  loading = false
  if (game) {
    record(game.me, game.result)
    game.destroy()
    game = null
  }
  clearRoom()
  $('game').hidden = true
  $('game').replaceChildren()
  $('launcher').hidden = false
  document.body.classList.remove('playing')
  closePanel()
  $('deploy').focus({ preventScroll: true })
}
function replay(id, size, privateRoom) {
  returnToMenu()
  if (privateRoom) {
    setMode('private-match')
    privatePanel()
    return
  }
  teamsPicked[id] = size
  setMode(id)
  actions.deploy()
}
async function launch(options = {}) {
  if (loading || game) return
  const nonce = ++launchNonce
  loading = true
  counted = false
  clearInterval(lobbyTimer)
  closePanel()
  closeTeam()
  const def = MODE[options.mode ?? mode.id]
  const map = mapForMode(def, options.map ?? mapChoice(def).id)
  $('launcher').hidden = true
  document.body.classList.add('playing')
  $('game').hidden = false
  $('game').innerHTML =
    `<div class="deploy-screen"><img src="${heroArt(def, map)}" alt=""/><div><span class="boot-mark">${logo}</span><span class="eyebrow">FIELD LINK / ${map.sector}</span><h2>${map.name}</h2><p role="status">Establishing field connection</p><div class="boot-line"></div><button type="button" class="btn secondary" data-action="cancel-deploy">Cancel</button></div></div>`
  try {
    const { startGame } = await import('./game/client.js')
    await new Promise((resolve) =>
      requestAnimationFrame(() => setTimeout(resolve, 0)),
    )
    if (nonce !== launchNonce) return
    game = startGame(
      $('game'),
      {
        mode: def.id,
        teamSize: options.teamSize ?? teamSize(),
        seed: options.seed,
        map: map.id,
        difficulty: options.difficulty ?? settings.difficulty,
        network: options.network,
        name: activeName(),
        owner: career.account?.role === 'owner' && !career.account.mustRotate,
        settings: { ...settings, weapon: activeKit().primary },
        loadout: activeKit(),
        drillRecords: profile.drills,
      },
      {
        exit: returnToMenu,
        replay,
        settings: settingsPanel,
        controls: controlsPanel,
        notify: toast,
        record,
        drillRecord,
      },
    )
    loading = false
  } catch (err) {
    if (nonce !== launchNonce) return
    console.error(err)
    returnToMenu()
    showPanel(
      'error',
      'Unable to Deploy',
      `<p>${escape(err.message || 'The battlefield could not be initialized.')}</p><p style="margin-top:10px">Try the Performance graphics setting or a browser with WebGL 2 support.</p><div class="panel-cta"><button class="btn secondary" type="button" data-action="close">Back</button><button class="btn primary" type="button" data-action="settings">Graphics settings</button></div>`,
      'FIELD LINK / ERROR',
    )
  }
}
async function invite() {
  if (!connection?.lobby) return
  const url = new URL(location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('room', connection.lobby.code)
  try {
    await navigator.clipboard.writeText(url.href)
    const btn = panel.querySelector('[data-action="invite"]')
    if (btn) btn.textContent = 'Invite copied'
  } catch {
    const btn = panel.querySelector('[data-action="invite"]')
    if (btn) btn.textContent = `Code: ${connection.lobby.code}`
  }
}
const actions = {
  home: () => {
    closePanel()
    closeTeam()
    nav('home')
    window.scrollTo({ top: 0, behavior: 'instant' })
  },
  play: () => {
    closePanel()
    closeTeam()
    nav('play')
    $('playlist-heading').scrollIntoView({ block: 'start' })
  },
  multiplayer: async () => {
    if (!LIVE_ROOMS) return
    career.multiplayer()
    await career.refresh()
    if (modalType === 'multiplayer') career.multiplayer()
  },
  'enable-online': () => {
    if (!LIVE_ROOMS) return
    settings.online = true
    updateSettings()
    closePanel()
    toast('Public matchmaking enabled. Select a playlist and deploy.')
  },
  loadout: () => loadoutPanel(),
  armory: () => loadoutPanel(true),
  operators: () => operatorsPanel(),
  'save-operator': () =>
    commitKit({ ...activeKit(), operator: operatorPick }, () =>
      operatorsPanel(operatorPick),
    ),
  store: () => career.catalog('finish', 'store'),
  outfits: () => career.catalog('outfit', 'operators'),
  events: () => career.events(),
  leaders: () => career.leaders(),
  owner: () => career.owner(),
  private: () => privatePanel(),
  fullscreen: async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
      settingsPanel()
    } catch {
      toast('Fullscreen is unavailable in this preview or browser.')
    }
  },
  settings: settingsPanel,
  controls: controlsPanel,
  profile: () => (LIVE_ROOMS ? career.profile() : localProfilePanel()),
  setup: () => setupPanel(),
  close: closePanel,
  team: toggleTeam,
  deploy: () => {
    if (mode.id === 'private-match') privatePanel()
    else if (settings.online && mode.map !== 'range') {
      if (career.account?.mustRotate) {
        career.renderAuth('password')
        return
      }
      if (career.live.disabled.includes(mode.id)) {
        showPanel(
          'error',
          'Online playlist closed',
          '<p>This playlist is currently closed on the live network.</p><div class="panel-cta"><button type="button" class="btn primary" data-action="local">Play locally</button></div>',
        )
        return
      }
      connect({
        op: 'quick',
        mode: mode.id,
        teamSize: teamSize(),
        map: mapChoice().id,
      })
    } else launch()
  },
  local: () => launch(),
  'cancel-deploy': returnToMenu,
  'reset-kit': () => {
    loadout = normalizeLoadout({})
    saveKit()
    loadoutPanel(modalType === 'armory', true)
  },
  'commit-kit': () => commitKit(loadout, closePanel),
  'reset-settings': () => {
    const weapon = settings.weapon
    Object.assign(settings, initialSettings(), { weapon })
    updateSettings()
    settingsPanel()
  },
  'leave-room': () => {
    const publicRoom = modalType === 'queue' || connection?.lobby?.public
    clearRoom()
    if (publicRoom) closePanel()
    else privatePanel()
  },
  'start-room': () => connection?.send({ op: 'start' }),
  'toggle-fill': () => {
    if (connection?.lobby)
      connection.send({ op: 'fill', fill: !connection.lobby.fill })
  },
  invite,
}
document.addEventListener('click', (e) => {
  const button = e.target.closest('button')
  if (!e.target.closest('.team-picker')) closeTeam()
  if (!button) return
  if (button.dataset.mode) setMode(button.dataset.mode)
  else if (modalType === 'setup' && button.dataset.battlefield) {
    const map = mapForMode(mode, button.dataset.battlefield)
    mapsPicked[mode.id] = map.id
    save('maps', mapsPicked)
    setMode(mode.id)
    setupPanel(`[data-battlefield="${map.id}"]`)
  } else if (
    modalType === 'setup' &&
    button.dataset.difficulty &&
    !settings.online
  ) {
    settings.difficulty = normalizeDifficulty(button.dataset.difficulty)
    updateSettings()
    setupPanel(`[data-difficulty="${settings.difficulty}"]`)
  } else if (button.dataset.team) {
    teamsPicked[mode.id] = Number(button.dataset.team)
    setMode(mode.id)
    $('team-toggle').focus()
  } else if (
    button.dataset.skin &&
    modalType === 'operators' &&
    operatorStyle(button.dataset.skin)
  ) {
    operatorsPanel(button.dataset.skin)
  } else if (
    button.dataset.dossier &&
    ['career', 'archive', 'trials'].includes(button.dataset.dossier)
  ) {
    const tab = button.dataset.dossier
    localProfilePanel(tab)
    panel.querySelector(`[data-dossier="${tab}"]`)?.focus()
  } else if (
    button.dataset.weapon &&
    Object.hasOwn(WEAPONS, button.dataset.weapon)
  ) {
    loadout = normalizeLoadout({ ...loadout, primary: button.dataset.weapon })
    saveKit()
    for (const b of panel.querySelectorAll('[data-weapon]')) {
      const pick = b === button
      b.setAttribute('aria-pressed', String(pick))
      b.querySelector('.eyebrow').textContent =
        WEAPONS[b.dataset.weapon].type + (pick ? ' / EQUIPPED' : '')
    }
    updateArmory(panel, loadout)
    drawKitPreview()
  } else if (button.dataset.kit) {
    const { kit, value } = button.dataset
    const choices =
      kit === 'tactical'
        ? TACTICALS
        : kit === 'operator'
          ? OPERATORS
          : kit === 'finish'
            ? FINISHES
            : null
    if (choices && Object.hasOwn(choices, value)) {
      loadout = normalizeLoadout({ ...loadout, [kit]: value })
      saveKit()
      for (const b of panel.querySelectorAll(`[data-kit="${kit}"]`))
        b.setAttribute('aria-pressed', String(b === button))
      if (kit === 'finish') drawKitPreview()
    }
  } else if (button.dataset.action) actions[button.dataset.action]?.()
})
document.addEventListener('input', (e) => {
  const k = e.target.dataset.setting
  if (!k || !Object.hasOwn(settings, k) || (k === 'online' && !LIVE_ROOMS))
    return
  settings[k] =
    e.target.type === 'range'
      ? Number(e.target.value)
      : e.target.type === 'checkbox'
        ? e.target.checked
        : e.target.value
  if (e.target.type === 'range')
    e.target.parentElement.querySelector('output').textContent = e.target.value
  updateSettings()
})
panel.addEventListener('change', (e) => {
  const slot = ATTACHMENT_SLOTS.find(
    (s) => s.id === e.target.dataset.attachment,
  )
  if (slot && slot.choices.some((c) => c.id === e.target.value)) {
    loadout = normalizeLoadout({
      ...loadout,
      attachments: { ...loadout.attachments, [slot.id]: e.target.value },
    })
    saveKit()
    updateArmory(panel, loadout)
    return
  }
  if (e.target.dataset.host !== 'mode') return
  const m = MODE[e.target.value]
  if (!m) return
  $('host-map').innerHTML = select(
    'map',
    mapOptions(m),
    mapChoice(m).id,
    'data-host',
  )
  $('host-team').innerHTML = select(
    'teamSize',
    m.teams.map((t) => [t, m.paired ? 'Teams' : TEAM_NAMES[t]]),
    m.defaultTeam,
    'data-host',
  )
})
panel.addEventListener('submit', (e) => {
  e.preventDefault()
  if (e.target.id === 'host-form') {
    const data = Object.fromEntries(
      [...e.target.querySelectorAll('[data-host]')].map((n) => [
        n.dataset.host,
        n.value,
      ]),
    )
    connect({
      op: 'create',
      mode: data.mode,
      map: data.map,
      difficulty: data.difficulty,
      teamSize: Number(data.teamSize),
      capacity: Number(data.capacity),
      fill: data.fill === '1',
    })
  } else if (e.target.id === 'join-form') {
    const code = new FormData(e.target).get('code').toUpperCase().trim()
    connect({ op: 'join', code })
  } else if (e.target.id === 'profile-form') {
    profile.name = cleanCallsign(new FormData(e.target).get('name'))
    save('profile', profile)
    updateProfile()
    closePanel()
    toast('Operator callsign saved.')
  }
})
document.addEventListener('keydown', (e) => {
  if (
    e.target.closest?.('input, select, textarea') ||
    panel.open ||
    game ||
    loading
  )
    return
  if (e.key === '?') {
    e.preventDefault()
    controlsPanel()
  }
  if (e.key === 'Escape' && !teamMenu.hidden) closeTeam(true)
  if (
    e.target.closest?.('.playlist-card') &&
    ['ArrowLeft', 'ArrowRight'].includes(e.key)
  ) {
    e.preventDefault()
    const cards = [...$('playlist-grid').children],
      i = cards.indexOf(e.target)
    const next =
      cards[
        (i + (e.key === 'ArrowLeft' ? -1 : 1) + cards.length) % cards.length
      ]
    next.focus()
    setMode(next.dataset.mode)
  }
  if (
    e.target.closest?.('.team-options') &&
    ['ArrowUp', 'ArrowDown'].includes(e.key)
  ) {
    e.preventDefault()
    const buttons = [...teamMenu.children],
      i = buttons.indexOf(e.target)
    buttons[
      (i + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length
    ].focus()
  }
})

setMode(mode.id)
updateSettings()
updateProfile()
browserStatus()
if (LIVE_ROOMS) {
  career.refresh()
  setInterval(() => {
    if (!document.hidden && !game) career.refresh()
  }, 25_000)
}
const inviteCode = new URL(location.href).searchParams.get('room')
if (/^[A-Z0-9]{5}$/i.test(inviteCode ?? '')) {
  if (LIVE_ROOMS) {
    setMode('private-match')
    privatePanel(inviteCode.toUpperCase())
  } else {
    toast('Open room invites on the multiplayer server that created them.')
  }
}
