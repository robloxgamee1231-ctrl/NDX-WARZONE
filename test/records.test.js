import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendReport,
  calculateReport,
  cleanCallsign,
  dossierBody,
  formatSpecialties,
  normalizeProfile,
  progression,
  recordDrill,
} from '../src/game/records.js'

const performer = {
  kills: 4,
  damageDone: 530,
  assists: 2,
  shots: 31,
  hits: 18,
  revives: 1,
  captures: 2,
  team: 0,
  contracts: 1,
  objective: 270,
  inField: 140,
}

test('device data migrates from early saves, clamps malformed values, and escapes the callsign', () => {
  const old = normalizeProfile({
    name: '<Ka&t>',
    games: 10,
    wins: 3,
    kills: 18,
    assists: Infinity,
    damage: -3,
    archive: [{ mode: '__proto__', status: 'win' }],
  })
  assert.deepEqual(
    [old.name, old.games, old.wins, old.kills, old.assists, old.damage],
    ['Kat', 10, 3, 18, 0, 0],
  )
  assert.ok(old.xp > 1000)
  assert.equal(old.archive.length, 0)
  assert.match(
    dossierBody({ ...old, name: '<img onerror=alert(1)>' }, 'career'),
    /&lt;img/,
  )
  assert.equal(cleanCallsign('  '), 'Operator')
  assert.ok(cleanCallsign('Long-hyphen-name-22').length <= 16)
})

test('service awards reward a finish, a win, and objective contribution; abandoned runs cap XP', () => {
  const win = calculateReport(performer, { team: 0, time: 142 }, 'garrison')
  const draw = calculateReport(performer, { team: null, time: 142 }, 'garrison')
  const left = calculateReport(performer, null, 'garrison')
  assert.deepEqual(
    [win.status, draw.status, left.status],
    ['win', 'tie', 'left'],
  )
  assert.equal(win.accuracy, 58)
  assert.ok(win.xp > draw.xp && draw.xp > left.xp)
  assert.ok(left.xp <= 30)
  assert.match(formatSpecialties(win), /Relays captured/)
  assert.match(formatSpecialties(win), /Squadmates revived/)
})

test('career archive stores eight newest results and total stats remain cumulative', () => {
  const profile = normalizeProfile()
  assert.equal(
    appendReport(profile, calculateReport({ team: 0 }, null, 'garrison')),
    false,
  )
  for (let i = 0; i < 12; i++) {
    const entry = calculateReport(
      { ...performer, kills: i + 1 },
      { team: i % 2, time: 150 + i },
      'garrison',
    )
    assert.ok(appendReport(profile, entry))
  }
  assert.equal(profile.completed, 12)
  assert.equal(profile.wins, 6)
  assert.equal(profile.kills, 78)
  assert.equal(profile.captures, 24)
  assert.equal(profile.archive.length, 8)
  assert.equal(profile.archive[0].kills, 12)
  assert.equal(profile.archive.at(-1).kills, 5)
  assert.equal(
    normalizeProfile(JSON.parse(JSON.stringify(profile))).xp,
    profile.xp,
  )
  assert.ok(progression(profile).level > 1)
  assert.equal(progression({ xp: 1_000_000 }).pct, 100)
})

test('personal bests compare time, accuracy then precision, and never record failed attempts', () => {
  const profile = normalizeProfile()
  const run = {
    kind: 'steel',
    state: 'passed',
    grade: 'GOLD',
    time: 19.25,
    hits: 6,
    shots: 12,
    precision: 4,
  }
  assert.ok(recordDrill(profile, run))
  assert.equal(
    recordDrill(profile, { ...run, time: 16, state: 'failed' }),
    false,
  )
  assert.equal(recordDrill(profile, { ...run, time: 20, shots: 6 }), false)
  assert.equal(recordDrill(profile, { ...run, precision: 3 }), false)
  assert.ok(recordDrill(profile, { ...run, shots: 10 }))
  assert.ok(recordDrill(profile, { ...run, time: 18.21, shots: 13 }))
  assert.equal(profile.drills.steel.time, 18.21)
  assert.match(dossierBody(profile, 'trials'), /18.21s/)
  assert.equal(recordDrill(profile, { ...run, kind: '__proto__' }), false)
})
