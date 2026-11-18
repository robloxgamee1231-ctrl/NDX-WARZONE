import { icon } from '../icons.js'
import { DRILLS } from './training.js'
import { clamp, distance } from './world.js'

export const escapeText = (str) =>
  String(str ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
const sec = (n) => `${Math.max(0, n).toFixed(1)}s`

export function mapPanel() {
  return `<div class="field-window-content map-content">
    <div class="map-tools" role="group" aria-label="Waypoint type">
      <button type="button" aria-pressed="true" data-mark-kind="move">${icon('pin', 14)} Waypoint</button>
      <button type="button" aria-pressed="false" data-mark-kind="danger">${icon('info', 14)} Danger</button>
      <button type="button" data-game="clear-ping">${icon('close', 14)} Clear mine</button>
    </div>
    <canvas width="558" height="520" tabindex="0" data-tactical-chart aria-label="Place a squad waypoint on the operation map" aria-describedby="map-tip"></canvas>
    <div class="legend mono"><span><i></i> YOU / SQUAD</span><span><i></i> BUY STATION</span><span><i></i> CONTRACT</span><span><i></i> ENEMY FIRE</span><span class="staff-legend"><i></i> FIELD STAFF</span></div>
    <p class="map-tip" id="map-tip">Click or tap to mark. On keyboard: focus map, use arrows then Enter.</p>
    <output class="map-readout mono" id="map-readout">NO LOCATION SELECTED</output>
  </div>`
}

export class MapInteractions {
  constructor(root, map, callback, signal) {
    this.kind = 'move'
    this.player = null
    this.map = map
    this.callback = callback
    root.addEventListener(
      'click',
      (event) => {
        const kind = event.target.closest?.('[data-mark-kind]')
        if (kind) {
          this.kind = kind.dataset.markKind
          for (const b of root.querySelectorAll('[data-mark-kind]'))
            b.setAttribute('aria-pressed', String(b === kind))
          return
        }
        const canvas = event.target.closest?.('[data-tactical-chart]')
        if (!canvas || event.detail === 0) return
        const point = this.map.pointer(canvas, event)
        if (point) this.place(root, point)
      },
      { signal },
    )
    root.addEventListener(
      'pointermove',
      (event) => {
        const canvas = event.target.closest?.('[data-tactical-chart]')
        if (!canvas || event.pointerType === 'touch') return
        const point = this.map.pointer(canvas, event)
        if (point) this.preview(root, point)
      },
      { signal },
    )
    root.addEventListener(
      'keydown',
      (event) => {
        if (!event.target.matches?.('[data-tactical-chart]')) return
        if (event.key.startsWith('Arrow')) {
          event.preventDefault()
          event.stopPropagation()
          this.preview(root, this.map.keyPoint(event, this.player))
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          this.place(
            root,
            this.map.cursor ??
              this.map.clipPoint(this.player?.x ?? 0, this.player?.z ?? 0),
          )
        }
      },
      { signal },
    )
  }

  reset(player) {
    this.player = player
    this.kind = 'move'
    this.map.cursor = null
  }

  preview(root, point) {
    this.map.cursor = point
    const label = root.querySelector('#map-readout')
    if (label)
      label.textContent = `${this.kind === 'danger' ? 'DANGER' : 'WAYPOINT'}  X ${Math.round(point.x)}  /  Z ${Math.round(point.z)}`
  }

  place(root, point) {
    this.preview(root, point)
    this.callback('map-ping', { ...point, kind: this.kind })
  }
}

export function drillCards(training, records) {
  const active = training && ['countdown', 'active'].includes(training.state)
  return `<div class="field-window-content drills-content">
    <p>Practice scoring, movement, and armor in timed exercises. Personal bests are saved on this device.</p>
    <div class="exercise-list">${Object.values(DRILLS)
      .map((d, i) => {
        const best = records?.[d.id]
        const summary = best
          ? `<b>${escapeText(best.grade)} · ${sec(best.time)}</b><span>PERSONAL BEST</span>`
          : `<b>${d.duration}s LIMIT</b><span>NO RUN RECORDED</span>`
        return `<button type="button" class="exercise-card" data-game="start-drill" data-offer="${d.id}"><span class="exercise-index">0${i + 1}</span><span class="exercise-copy"><small>${d.label}</small><strong>${d.title}</strong><span>${d.brief}</span></span><span class="exercise-best">${summary}</span>${icon('arrow', 16)}</button>`
      })
      .join('')}</div>
    <div class="panel-cta">${active ? '<button type="button" class="btn secondary" data-game="cancel-drill">End current drill</button>' : ''}<button type="button" class="btn secondary" data-game="close">${active ? 'Return to drill' : 'Free practice'}</button></div>
  </div>`
}

export function drillPresentation(state, time, player) {
  const def = DRILLS[state.kind]
  if (!def) return null
  let label =
    state.state === 'countdown'
      ? `STANDBY · ${Math.max(1, Math.ceil(state.begin - time))}`
      : state.state === 'passed'
        ? `${state.grade} · ${sec(state.time)}`
        : state.state === 'failed'
          ? 'NOT QUALIFIED'
          : `${Math.max(0, Math.ceil(state.end - time))}s REMAINING`
  let detail = def.hint
  if (state.state === 'active') {
    if (state.kind === 'course')
      detail = `${state.point?.title ?? 'Finish'} · ${Math.round(distance(player, state.point ?? player))}m`
    if (state.kind === 'steel')
      detail = `Plate ${state.stage + 1} of ${state.goal} · ${state.hits}/${state.shots} hits`
    if (state.kind === 'armor')
      detail =
        state.stage < state.goal
          ? `Incoming test pulse ${state.stage + 1} of ${state.goal}`
          : 'Recover all 150 armor before time runs out'
  }
  if (state.state === 'passed' || state.state === 'failed')
    detail = 'Open Range Drills to rerun or choose a new exercise.'
  return {
    title: def.title,
    label,
    detail,
    fill: state.state === 'passed' ? 1 : clamp(state.stage / state.goal, 0, 1),
  }
}

export function relayTone(relay, team) {
  return relay.contested
    ? 'contested'
    : relay.owner === null
      ? 'neutral'
      : relay.owner === team
        ? 'friendly'
        : 'hostile'
}

export function renderRelays(control, player, scores, goal) {
  const they = player.team === 0 ? 1 : 0
  return `<div class="relay-score"><b>${scores[player.team] ?? 0}</b><span>${control.overtime ? 'OVERTIME' : `FIRST TO ${goal}`}</span><b>${scores[they] ?? 0}</b></div>
    <div class="relay-strip" aria-label="Control points">${control.relays.map((r) => `<span class="relay-chip ${relayTone(r, player.team)}" title="${r.title}${r.contested ? ' (contested)' : ''}">${r.id}<i style="--claim:${Math.round(r.progress * 100)}%"></i></span>`).join('')}</div>`
}

export function flightNumbers(player, world, waypoint, mode) {
  const agl = Math.max(
    0,
    Math.floor(player.y - world.height(player.x, player.z)),
  )
  const speed = Math.max(0, Math.round(Math.abs(player.vy ?? 0)))
  const point =
    waypoint ??
    world.sites
      .filter((s) => s.name !== mode.location)
      .sort((a, b) => distance(a, player) - distance(b, player))[0]
  const closeness = point ? Math.round(distance(player, point)) : null
  return {
    agl,
    speed,
    name: point?.name ?? 'LANDING ZONE',
    distance: closeness,
    pct: Math.min(100, Math.round((agl / 158) * 100)),
  }
}
