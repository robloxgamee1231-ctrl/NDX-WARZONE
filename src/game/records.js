import { MODE } from '../config.js'
import { icon } from '../icons.js'

const PROFILE_STATS = [
  'games',
  'completed',
  'kills',
  'wins',
  'assists',
  'damage',
  'revives',
  'captures',
  'contracts',
  'objective',
  'xp',
]
const ABANDONED_CAP = 30
const ARCHIVE_LENGTH = 8
const MAX = 20_000_000
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  )
const num = (value) =>
  Math.max(0, Math.min(MAX, Math.floor(Number.isFinite(value) ? value : 0)))
const comma = (value) => num(value).toLocaleString('en-US')
const GRADE = new Set(['GOLD', 'SILVER', 'BRONZE'])
const DRILL_IDS = new Set(['steel', 'course', 'armor'])
const COLORS = { win: 'WON', loss: 'FINISHED', tie: 'DRAW', left: 'LEFT EARLY' }

export const BADGES = [
  {
    id: 'tour',
    label: 'First Tour',
    desc: 'Finish one operation',
    goal: 1,
    stat: 'completed',
    icon: 'diamond',
  },
  {
    id: 'standard',
    label: 'Ridge Regular',
    desc: 'Finish ten operations',
    goal: 10,
    stat: 'completed',
    icon: 'radio',
  },
  {
    id: 'victor',
    label: 'Last Light',
    desc: 'Win three operations',
    goal: 3,
    stat: 'wins',
    icon: 'trophy',
  },
  {
    id: 'dispatch',
    label: 'Signal Chief',
    desc: 'Capture twelve relays',
    goal: 12,
    stat: 'captures',
    icon: 'pin',
  },
  {
    id: 'rescue',
    label: 'No One Left',
    desc: 'Revive five squadmates',
    goal: 5,
    stat: 'revives',
    icon: 'person',
  },
  {
    id: 'supply',
    label: 'Quartermaster',
    desc: 'Finish eight contracts',
    goal: 8,
    stat: 'contracts',
    icon: 'box',
  },
]

export const cleanCallsign = (value) =>
  typeof value === 'string'
    ? value
        .trim()
        .replace(/[^\p{L}\p{N} _.-]/gu, '')
        .slice(0, 16) || 'Operator'
    : 'Operator'

function gradeRecord(id, value) {
  if (
    !DRILL_IDS.has(id) ||
    !value ||
    !GRADE.has(value.grade) ||
    !Number.isFinite(value.time) ||
    value.time < 0 ||
    value.time > 90
  )
    return null
  return {
    time: Math.round(value.time * 100) / 100,
    grade: value.grade,
    hits: num(value.hits),
    shots: num(value.shots),
    precision: num(value.precision),
  }
}

function archiveRecord(value) {
  if (
    !value ||
    typeof value.mode !== 'string' ||
    !Object.hasOwn(MODE, value.mode) ||
    typeof value.status !== 'string' ||
    !Object.hasOwn(COLORS, value.status)
  )
    return null
  return {
    mode: value.mode,
    status: value.status,
    time: num(value.time),
    kills: num(value.kills),
    objective: num(value.objective),
    accuracy: Math.min(100, num(value.accuracy)),
    xp: num(value.xp),
  }
}

export function normalizeProfile(raw) {
  const profile = Object.fromEntries(
    PROFILE_STATS.map((stat) => [stat, num(raw?.[stat])]),
  )
  profile.name = cleanCallsign(raw?.name)
  // Existing v0.1 save files used only games/kills/wins.
  if (raw && !Object.hasOwn(raw, 'xp')) {
    profile.completed = profile.wins
    profile.xp = Math.min(
      MAX,
      profile.games * 45 + profile.kills * 18 + profile.wins * 120,
    )
  }
  profile.games = Math.max(profile.completed, profile.wins, profile.games)
  profile.wins = Math.min(profile.completed, profile.wins)
  profile.drills = {}
  for (const id of DRILL_IDS) {
    const value = gradeRecord(id, raw?.drills?.[id])
    if (value) profile.drills[id] = value
  }
  profile.archive = Array.isArray(raw?.archive)
    ? raw.archive.slice(0, ARCHIVE_LENGTH).map(archiveRecord).filter(Boolean)
    : []
  return profile
}

export function calculateReport(p, result, mode) {
  const status = !result
    ? 'left'
    : result.team === p.team
      ? 'win'
      : result.team === null
        ? 'tie'
        : 'loss'
  const kills = num(p.kills),
    assists = num(p.assists),
    damage = num(p.damageDone)
  const revives = num(p.revives),
    captures = num(p.captures),
    contracts = num(p.contracts)
  const objective = num(p.objective)
  const shots = num(p.shots),
    hits = Math.min(num(p.hits), shots)
  const accuracy = shots ? Math.round((100 * hits) / shots) : 0
  const time = num(result?.time ?? p.inField)
  const recognition = []
  if (shots >= 12 && accuracy >= 48)
    recognition.push({
      label: 'Precision',
      value: `${accuracy}%`,
      icon: 'reticle',
    })
  if (captures)
    recognition.push({
      label: 'Relays captured',
      value: captures,
      icon: 'radio',
    })
  if (revives)
    recognition.push({
      label: 'Squadmates revived',
      value: revives,
      icon: 'person',
    })
  if (contracts)
    recognition.push({
      label: 'Contracts cleared',
      value: contracts,
      icon: 'diamond',
    })
  if (assists && recognition.length < 3)
    recognition.push({ label: 'Assists', value: assists, icon: 'squad' })
  const duty = Math.min(250, Math.round(objective / 3) + revives * 38)
  const contribution = Math.min(
    300,
    kills * 18 + assists * 9 + Math.floor(damage / 45),
  )
  const completion = status === 'win' ? 220 : result ? 92 : 0
  const presence = Math.min(90, Math.floor(time / 3))
  const xp = result
    ? duty + contribution + completion + presence
    : Math.min(
        ABANDONED_CAP,
        Math.floor((duty + contribution + presence) * 0.18),
      )
  return {
    mode,
    status,
    time,
    kills,
    assists,
    damage,
    revives,
    captures,
    contracts,
    objective,
    accuracy,
    xp,
    recognition,
  }
}

export function appendReport(profile, report) {
  const entry = archiveRecord(report)
  if (!entry) return false
  if (entry.status === 'left' && entry.time < 15 && entry.xp === 0) return false
  const award = {
    games: 1,
    completed: Number(entry.status !== 'left'),
    wins: Number(entry.status === 'win'),
    kills: report.kills,
    assists: report.assists,
    damage: report.damage,
    revives: report.revives,
    captures: report.captures,
    contracts: report.contracts,
    objective: report.objective,
    xp: entry.xp,
  }
  for (const key of PROFILE_STATS)
    profile[key] = Math.min(MAX, profile[key] + num(award[key]))
  profile.archive = [entry, ...profile.archive].slice(0, ARCHIVE_LENGTH)
  return true
}

export function recordDrill(profile, state) {
  if (state?.state !== 'passed') return false
  const next = gradeRecord(state.kind, state)
  if (!next) return false
  const prior = profile.drills[state.kind]
  if (prior) {
    if (next.time > prior.time) return false
    if (next.time === prior.time) {
      if (
        next.hits / Math.max(1, next.shots) <
        prior.hits / Math.max(1, prior.shots)
      )
        return false
      if (
        next.hits / Math.max(1, next.shots) ===
          prior.hits / Math.max(1, prior.shots) &&
        next.precision <= prior.precision
      )
        return false
    }
  }
  profile.drills[state.kind] = next
  return true
}

function threshold(level) {
  return (level - 1) * 350 + (level - 1) * (level - 2) * 38
}

export function progression(profile) {
  const xp = num(profile.xp)
  let level = 1
  while (level < 40 && xp >= threshold(level + 1)) level++
  const target = threshold(level + 1) - threshold(level)
  const earned = level === 40 ? target : xp - threshold(level)
  return { level, target, earned, pct: Math.round((earned / target) * 100), xp }
}

export function formatSpecialties(report, { localXp = true } = {}) {
  const badges = report.recognition.slice(0, 3)
  if (!localXp && !badges.length) return ''
  return `<div class="report-gains">${localXp ? `<span>${icon('diamond', 15)} <b>+${comma(report.xp)} LOCAL XP</b></span>` : ''}${badges.map((b) => `<span title="${b.label}">${icon(b.icon, 14)} ${b.value} ${b.label}</span>`).join('')}</div>`
}

function renderBadges(profile) {
  return `<div class="badge-grid">${BADGES.map((b) => {
    const now = Math.min(b.goal, profile[b.stat])
    return `<article class="record-badge ${now >= b.goal ? 'earned' : ''}"><span>${icon(b.icon, 19)}</span><div><strong>${b.label}</strong><small>${b.desc}</small></div><b class="mono">${now}/${b.goal}</b><i><b style="width:${(100 * now) / b.goal}%"></b></i></article>`
  }).join('')}</div>`
}

function prettyTime(time) {
  const seconds = Math.floor(time)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function renderArchive(profile) {
  if (!profile.archive.length)
    return '<p class="dossier-empty">Deploy into a match to begin your service record.</p>'
  return `<div class="record-history">${profile.archive.map((e) => `<article><div><strong>${MODE[e.mode].name}</strong><small>${e.kills} ELIMS · ${e.accuracy}% ACCURACY · ${prettyTime(e.time)}</small></div><span class="archive-status ${e.status}">${COLORS[e.status]}</span><b>+${comma(e.xp)} XP</b></article>`).join('')}</div>`
}

export function dossierBody(profile, tab) {
  const progress = progression(profile)
  return `<nav class="dossier-nav" aria-label="Service record sections">${[
    ['career', 'Career'],
    ['archive', 'Match history'],
    ['trials', 'Range bests'],
  ]
    .map(
      ([id, name]) =>
        `<button type="button" data-dossier="${id}" aria-pressed="${id === tab}">${name}</button>`,
    )
    .join('')}</nav>
    <div class="career-summary"><span class="career-emblem">${icon('diamond', 26)}</span><div><small class="eyebrow">OPERATOR / ${esc(profile.name)}</small><b>LEVEL ${String(progress.level).padStart(2, '0')}</b><i><b style="width:${progress.pct}%"></b></i><span>${comma(progress.xp)} LOCAL XP · ${comma(progress.earned)} / ${comma(progress.target)} TO NEXT LEVEL</span></div></div>
    ${
      tab === 'career'
        ? `<form id="profile-form" class="career-form"><label class="panel-field"><span><strong>Callsign</strong><small>Displayed in lobbies and the squad HUD.</small></span><input name="name" maxlength="16" value="${esc(profile.name)}" required autocomplete="off"/></label><button class="btn secondary" type="submit">Save callsign ${icon('check', 14)}</button></form><div class="career-stats">${[
            ['OPERATION WINS', profile.wins],
            ['MATCHES FINISHED', profile.completed],
            ['ELIMINATIONS', profile.kills],
            ['SUPPORT REVIVES', profile.revives],
          ]
            .map(
              ([name, value]) =>
                `<span><b>${comma(value)}</b><small>${name}</small></span>`,
            )
            .join(
              '',
            )}</div><h3 class="panel-subtitle">Service commendations</h3>${renderBadges(profile)}`
        : ''
    }
    ${tab === 'archive' ? renderArchive(profile) : ''}
    ${
      tab === 'trials'
        ? `<div class="record-history">${[
            ['steel', 'Steel Sequence'],
            ['course', 'Momentum Circuit'],
            ['armor', 'Armor Under Pressure'],
          ]
            .map(([id, title]) => {
              const best = profile.drills[id]
              return `<article><div><strong>${title}</strong><small>${best ? `${best.precision} PRECISION HITS` : 'VISIT TRAINING RANGE'}</small></div><span class="archive-status ${best ? 'win' : ''}">${best?.grade ?? 'UNTESTED'}</span><b>${best ? `${best.time.toFixed(2)}s` : '—'}</b></article>`
            })
            .join('')}</div>`
        : ''
    }`
}
