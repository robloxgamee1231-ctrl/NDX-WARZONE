import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { MODE } from '../../src/config.js'
import { CATALOG, cosmetic } from '../../src/game/cosmetics.js'
import { authorizedLoadout } from '../../src/game/loadout.js'
import {
  AccountError,
  digest,
  encodePassword,
  requirePassword,
  token,
  usernameOK,
  verifyPassword,
  verifyRecovery,
} from './security.js'

export const MAX_XP = 29_700
export const MAX_CREDITS = 1_000_000
export const SESSION_AGE = 14 * 86_400_000
const root = fileURLToPath(new URL('../../', import.meta.url))
const publicDirs = ['public', 'dist', 'out/pages'].map((dir) =>
  resolve(root, dir),
)
export const accountDatabase = () => {
  const path = process.env.NDX_DB_PATH || '.local/ndx-combat/accounts.sqlite'
  if (path === ':memory:') return path
  const file = resolve(path)
  if (publicDirs.some((dir) => file === dir || file.startsWith(`${dir}${sep}`)))
    throw new Error('NDX_DB_PATH must be outside the served asset directories.')
  return file
}
export const localBootstrapEnabled = () =>
  process.env.NDX_LOCAL_OWNER === '1' &&
  process.env.NDX_BIND_HOST === '127.0.0.1' &&
  process.env.NODE_ENV !== 'production'
const rankOf = (xp) => 1 + Math.floor(xp / 300)
const unlockAll = CATALOG.map((item) => item.id)
const achievements = [
  ['first-match', 'First Deployment', (a) => a.matches > 0],
  ['victory', 'First Victory', (a) => a.wins > 0],
  ['marks', 'Field Marksman', (a) => a.kills >= 25],
  ['tour', 'Second Tour', (a) => a.matches >= 10],
  ['rank', 'Operator Grade', (a) => a.xp >= 2700],
]
const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
const parse = (value, fallback) => {
  try {
    return JSON.parse(value) ?? fallback
  } catch {
    return fallback
  }
}
const shortText = (value, max) =>
  typeof value === 'string'
    ? value
        .trim()
        .replace(/[\p{Cc}\p{Cf}]/gu, '')
        .slice(0, max)
    : ''
const day = 86_400_000
const bounded = (value, max) =>
  Number.isSafeInteger(value) ? Math.max(0, Math.min(max, value)) : 0
const invalidLogin = () =>
  new AccountError(401, 'Invalid username or password.')
const playerPath = (mode) =>
  Object.hasOwn(MODE, mode) &&
  MODE[mode].teams.length &&
  MODE[mode].map !== 'range'

export class AccountStore {
  constructor({
    path = accountDatabase(),
    allowBootstrap = false,
    now = Date.now,
  } = {}) {
    this.now = now
    this.allowBootstrap = allowBootstrap
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path)
    if (path !== ':memory:') chmodSync(path, 0o600)
    this.db.exec(
      'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3500;',
    )
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) {
      this.db.close()
      throw new Error(
        'This account database was created by a newer version of NDX Combat.',
      )
    }
    this.db.exec(schema)
    this.statements = new Map()
    if (
      !allowBootstrap &&
      this.get('SELECT id FROM accounts WHERE must_rotate = 1')
    ) {
      this.close()
      throw new Error(
        'Rotate the local NDX bootstrap password on a loopback-only server before deploying this database.',
      )
    }
    this.run('DELETE FROM sessions WHERE expires <= ?', now())
  }
  close() {
    this.db.close()
  }
  sql(text) {
    if (!this.statements.has(text))
      this.statements.set(text, this.db.prepare(text))
    return this.statements.get(text)
  }
  run(text, ...args) {
    return this.sql(text).run(...args)
  }
  get(text, ...args) {
    return this.sql(text).get(...args)
  }
  all(text, ...args) {
    return this.sql(text).all(...args)
  }
  tx(work) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = work()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  byName(name) {
    return usernameOK(name)
      ? this.get('SELECT * FROM accounts WHERE username = ?', name)
      : null
  }
  account(id) {
    return this.get('SELECT * FROM accounts WHERE id = ?', id)
  }
  owns(user, id) {
    return (
      user?.role === 'owner' ||
      !!(
        user &&
        this.get(
          'SELECT item FROM inventory WHERE account_id=? AND item=?',
          user.id,
          id,
        )
      )
    )
  }
  kit(raw, weapon, user) {
    return authorizedLoadout(raw, weapon, (id) => this.owns(user, id))
  }
  view(user) {
    if (!user) return null
    const owner = user.role === 'owner'
    return {
      id: user.id,
      username: user.username,
      callsign: user.callsign,
      role: user.role,
      mustRotate: !!user.must_rotate,
      badge: owner ? 'NDX / OWNER' : null,
      xp: owner ? MAX_XP : user.xp,
      rank: owner ? 100 : rankOf(user.xp),
      credits: owner ? null : user.credits,
      unlimited: owner,
      stats: {
        kills: user.kills,
        deaths: user.deaths,
        wins: user.wins,
        matches: user.matches,
      },
      loadout: this.kit(parse(user.loadout, {}), 'raven', user),
      inventory: owner
        ? unlockAll
        : this.all(
            'SELECT item FROM inventory WHERE account_id=? ORDER BY granted DESC',
            user.id,
          ).map((r) => r.item),
      achievements: achievements
        .filter(([, , passed]) => owner || passed(user))
        .map(([id, name]) => ({ id, name })),
    }
  }
  async register(name, password, { owner = false, bootstrap = false } = {}) {
    if (!usernameOK(name))
      throw new AccountError(
        400,
        'Use 3–16 letters, digits, or underscores; start with a letter.',
      )
    if (name.toLowerCase() === 'ndx' && !owner)
      throw new AccountError(409, 'That username is reserved.')
    if (owner && name !== 'NDX')
      throw new AccountError(400, 'The owner uses the NDX username.')
    if (bootstrap && (!owner || !this.allowBootstrap || password !== 'NDX'))
      throw new AccountError(403, 'Local bootstrap is disabled.')
    if (!bootstrap) requirePassword(password, name)
    if (this.byName(name))
      throw new AccountError(409, 'That username is already in use.')
    const encoded = await encodePassword(password),
      recovery = token(),
      id = randomUUID()
    const result = this.run(
      `INSERT OR IGNORE INTO accounts(id,username,callsign,password_hash,recovery_hash,role,must_rotate,xp,credits,joined)
      VALUES(?,?,?,?,?,?,?,?,?,?)`,
      id,
      name,
      name,
      encoded,
      digest(recovery),
      owner ? 'owner' : 'player',
      Number(bootstrap),
      owner ? MAX_XP : 0,
      owner ? MAX_CREDITS : 300,
      this.now(),
    )
    if (!result.changes)
      throw new AccountError(409, 'That username is already in use.')
    return { user: this.account(id), recovery }
  }
  async login(name, password) {
    const user = this.byName(name)
    if (
      !(await verifyPassword(password, user?.password_hash)) ||
      !user ||
      user.suspended ||
      (user.must_rotate && !this.allowBootstrap)
    )
      throw invalidLogin()
    const current = this.account(user.id)
    if (current.password_hash !== user.password_hash || current.suspended)
      throw invalidLogin()
    return current
  }
  issue(user) {
    const value = token(),
      now = this.now()
    this.tx(() => {
      const current = this.account(user.id)
      if (
        !current ||
        current.suspended ||
        current.password_hash !== user.password_hash
      )
        throw new AccountError(401, 'Sign in again.')
      this.run('DELETE FROM sessions WHERE expires <= ?', now)
      this.run(
        `DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE account_id=? ORDER BY expires DESC LIMIT -1 OFFSET 7)`,
        user.id,
      )
      this.run(
        'INSERT INTO sessions(hash,account_id,expires) VALUES(?,?,?)',
        digest(value),
        user.id,
        now + SESSION_AGE,
      )
    })
    return value
  }
  fromSession(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
      return null
    return (
      this.get(
        `SELECT a.* FROM accounts a JOIN sessions s ON a.id = s.account_id
      WHERE s.hash=? AND s.expires>? AND a.suspended=0`,
        digest(value),
        this.now(),
      ) ?? null
    )
  }
  revoke(value) {
    if (typeof value === 'string' && value.length === 43)
      this.run('DELETE FROM sessions WHERE hash=?', digest(value))
  }
  async changePassword(user, current, next) {
    requirePassword(next, user.username)
    if (!(await verifyPassword(current, user.password_hash)))
      throw new AccountError(401, 'Current password is incorrect.')
    return this.replaceCredentials(user, next)
  }
  async recover(name, code, next) {
    const user = this.byName(name)
    if (
      !user ||
      user.suspended ||
      (user.must_rotate && !this.allowBootstrap) ||
      !verifyRecovery(code, user.recovery_hash)
    )
      throw new AccountError(401, 'Invalid username or recovery code.')
    requirePassword(next, user.username)
    return this.replaceCredentials(user, next)
  }
  async replaceCredentials(user, next) {
    const password = await encodePassword(next),
      recovery = token()
    this.tx(() => {
      const result = this.run(
        `UPDATE accounts SET password_hash=?,recovery_hash=?,must_rotate=0
        WHERE id=? AND password_hash=? AND recovery_hash=? AND suspended=0`,
        password,
        digest(recovery),
        user.id,
        user.password_hash,
        user.recovery_hash,
      )
      if (!result.changes)
        throw new AccountError(
          409,
          'Credentials changed. Sign in and try again.',
        )
      this.run('DELETE FROM sessions WHERE account_id=?', user.id)
    })
    return { user: this.account(user.id), recovery }
  }
  async rename(user, name, password) {
    if (user.role === 'owner')
      throw new AccountError(403, 'The owner username is fixed.')
    if (!usernameOK(name))
      throw new AccountError(
        400,
        'Use 3–16 letters, digits, or underscores; start with a letter.',
      )
    if (name.toLowerCase() === 'ndx')
      throw new AccountError(409, 'That username is reserved.')
    if (!(await verifyPassword(password, user.password_hash)))
      throw new AccountError(401, 'Current password is incorrect.')
    const collision = this.byName(name)
    if (collision && collision.id !== user.id)
      throw new AccountError(409, 'That username is already in use.')
    const updated = this.run(
      'UPDATE accounts SET username=? WHERE id=? AND password_hash=? AND suspended=0',
      name,
      user.id,
      user.password_hash,
    )
    if (!updated.changes)
      throw new AccountError(409, 'Account changed. Sign in and try again.')
    return this.view(this.account(user.id))
  }
  profile(user, name) {
    const callsign = shortText(name, 20)
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{1,19}$/u.test(callsign))
      throw new AccountError(
        400,
        'Use a callsign of 2–20 letters, digits, spaces, or ._-',
      )
    if (callsign.toLowerCase() === 'ndx' && user.role !== 'owner')
      throw new AccountError(409, 'That callsign is reserved.')
    this.run('UPDATE accounts SET callsign=? WHERE id=?', callsign, user.id)
    return this.view(this.account(user.id))
  }
  saveKit(user, raw) {
    const kit = this.kit(raw, 'raven', user)
    this.run(
      'UPDATE accounts SET loadout=? WHERE id=?',
      JSON.stringify(kit),
      user.id,
    )
    return this.view(this.account(user.id))
  }
  purchase(user, id) {
    const item = cosmetic(id)
    if (
      !item ||
      (user.role !== 'owner' &&
        this.getConfig('hidden-items', []).includes(id) &&
        !this.owns(user, id))
    )
      throw new AccountError(404, 'That cosmetic is not currently listed.')
    if (user.role === 'owner') return this.view(user)
    this.tx(() => {
      if (this.owns(user, id)) return
      const current = this.account(user.id)
      if (rankOf(current.xp) < item.rank)
        throw new AccountError(
          409,
          `Reach rank ${item.rank} to unlock this item.`,
        )
      const debit = this.run(
        'UPDATE accounts SET credits=credits-? WHERE id=? AND credits>=?',
        item.price,
        user.id,
        item.price,
      )
      if (!debit.changes)
        throw new AccountError(409, 'Not enough earned credits.')
      this.run('INSERT INTO inventory VALUES(?,?,?)', user.id, id, this.now())
    })
    return this.view(this.account(user.id))
  }
  equip(user, id) {
    const item = cosmetic(id)
    if (!item || !this.owns(user, id))
      throw new AccountError(403, 'Unlock this cosmetic first.')
    const kit = this.kit(parse(user.loadout, {}), 'raven', user)
    if (item.kind === 'outfit') kit.operator = id
    else if (item.weapon === 'spectre') kit.sideFinish = id
    else Object.assign(kit, { primary: item.weapon, finish: id })
    return this.saveKit(user, kit)
  }
  getConfig(key, fallback) {
    return parse(
      this.get('SELECT value FROM live_config WHERE key=?', key)?.value,
      fallback,
    )
  }
  setConfig(key, value) {
    this.run(
      'INSERT INTO live_config VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      key,
      JSON.stringify(value),
    )
  }
  live() {
    const event = this.getConfig('event', null)
    return {
      announcement: this.getConfig('announcement', ''),
      event: event?.until > this.now() ? event : null,
      disabled: this.getConfig('disabled', []),
      hiddenItems: this.getConfig('hidden-items', []),
    }
  }
  awardMatch(room) {
    const { match } = room
    if (!room.public || !match.result || match.time < 18 || !room.key) return []
    const now = this.now(),
      multiplier = this.live().event?.multiplier ?? 1
    return this.tx(() => {
      const awards = []
      for (const member of room.members.values()) {
        if (
          !member.accountId ||
          !this.get(
            'SELECT id FROM accounts WHERE id=? AND suspended=0',
            member.accountId,
          )
        )
          continue
        const p = match.players.get(member.id)
        if (
          !p ||
          p.bot ||
          ((p.activeTime ?? 0) < 5 &&
            p.kills + p.assists + (p.captures ?? 0) + (p.confirms ?? 0) === 0)
        )
          continue
        const kills = bounded(p.kills, 300),
          deaths = bounded(p.deaths, 300),
          won = Number(match.result.team === p.team)
        const xp = Math.round(
          (90 +
            won * 75 +
            kills * 18 +
            bounded(p.assists, 25) * 8 +
            Math.floor(bounded(p.objective, 800) * 0.15)) *
            multiplier,
        )
        const credits = 30 + won * 20 + Math.min(kills, 24) * 8
        const mark = this.run(
          `INSERT OR IGNORE INTO match_awards VALUES(?,?,?,?,?,?,?,?,?,?)`,
          member.accountId,
          room.key,
          match.mode.id,
          match.world.map.id,
          won,
          kills,
          deaths,
          xp,
          credits,
          now,
        )
        if (!mark.changes) continue
        this.run(
          `UPDATE accounts SET xp=min(?,xp+?),credits=min(?,credits+?),kills=kills+?,deaths=deaths+?,wins=wins+?,matches=matches+1 WHERE id=?`,
          MAX_XP,
          xp,
          MAX_CREDITS,
          credits,
          kills,
          deaths,
          won,
          member.accountId,
        )
        awards.push({ id: member.id, xp, credits })
      }
      return awards
    })
  }
  history(user) {
    return this.all(
      'SELECT mode,map,won,kills,deaths,xp,credits,finished FROM match_awards WHERE account_id=? ORDER BY finished DESC LIMIT 12',
      user.id,
    )
  }
  challenges(user) {
    const now = this.now(),
      start = Math.floor(now / day) * day
    const weekday = (new Date(start).getUTCDay() + 6) % 7
    return [
      {
        id: 'daily-op',
        label: 'Complete 1 online operation',
        from: start,
        reset: start + day,
        metric: 'rounds',
        goal: 1,
        reward: 60,
      },
      {
        id: 'daily-elims',
        label: 'Get 6 online eliminations',
        from: start,
        reset: start + day,
        metric: 'kills',
        goal: 6,
        reward: 90,
      },
      {
        id: 'weekly-tour',
        label: 'Complete 8 online operations',
        from: start - weekday * day,
        reset: start + (7 - weekday) * day,
        metric: 'rounds',
        goal: 8,
        reward: 360,
      },
    ].map((c) => {
      const record = this.get(
        'SELECT count(*) AS rounds,coalesce(sum(kills),0) AS kills FROM match_awards WHERE account_id=? AND finished>=?',
        user.id,
        c.from,
      )
      return {
        ...c,
        progress: record[c.metric],
        claimed: !!this.get(
          'SELECT 1 FROM challenge_claims WHERE account_id=? AND challenge=? AND period=?',
          user.id,
          c.id,
          c.from,
        ),
      }
    })
  }
  claim(user, id) {
    const c = this.challenges(user).find((x) => x.id === id)
    if (!c || c.progress < c.goal)
      throw new AccountError(
        409,
        'Finish the challenge before claiming the reward.',
      )
    this.tx(() => {
      const flag = this.run(
        'INSERT OR IGNORE INTO challenge_claims VALUES(?,?,?)',
        user.id,
        id,
        c.from,
      )
      if (flag.changes)
        this.run(
          'UPDATE accounts SET credits=min(?,credits+?) WHERE id=?',
          MAX_CREDITS,
          c.reward,
          user.id,
        )
    })
    return this.view(this.account(user.id))
  }
  leaderboard() {
    return this.all(
      `SELECT username,callsign,xp,kills,wins,matches FROM accounts WHERE role='player' AND suspended=0 AND matches>0 ORDER BY xp DESC,wins DESC,kills DESC,username LIMIT 25`,
    ).map((p) => ({ ...p, rank: rankOf(p.xp) }))
  }
  report(user, username, reason) {
    const target = this.byName(username)
    if (!target || target.id === user.id)
      throw new AccountError(400, 'Enter another registered username.')
    const text = shortText(reason, 300)
    if (text.length < 12)
      throw new AccountError(400, 'Give at least 12 characters of context.')
    if (
      this.get(
        'SELECT 1 FROM reports WHERE reporter=? AND created>?',
        user.id,
        this.now() - 60_000,
      )
    )
      throw new AccountError(
        429,
        'Wait a minute before sending another report.',
      )
    this.run(
      'INSERT INTO reports(reporter,target,reason,created) VALUES(?,?,?,?)',
      user.id,
      target.id,
      text,
      this.now(),
    )
  }
  requireOwner(user) {
    if (!user || user.role !== 'owner' || user.must_rotate || user.suspended)
      throw new AccountError(403, 'Owner access required.')
  }
  management(user, query, offset = 0) {
    this.requireOwner(user)
    const filter = shortText(query, 24).replace(/[%_]/g, '')
    const users = this.all(
      `SELECT username,callsign,role,xp,credits,suspended,matches,kills,wins,joined FROM accounts WHERE username LIKE ? ORDER BY username LIMIT 25 OFFSET ?`,
      `%${filter}%`,
      bounded(offset, 10_000),
    )
    const totals = this.get(
      'SELECT count(*) AS accounts, coalesce(sum(matches),0) AS matches, (SELECT count(DISTINCT match_id) FROM match_awards) AS completed FROM accounts',
    )
    const reports = this.all(
      `SELECT r.id, a.username AS reporter, b.username AS target,r.reason,r.status,r.created FROM reports r JOIN accounts a ON r.reporter=a.id JOIN accounts b ON r.target=b.id ORDER BY (r.status='open') DESC,r.created DESC LIMIT 25`,
    )
    return {
      users,
      totals,
      reports,
      audit: this.all(
        'SELECT action,detail,created FROM owner_audit ORDER BY id DESC LIMIT 15',
      ),
      live: this.live(),
    }
  }
  ownerAction(user, payload = {}) {
    this.requireOwner(user)
    const { action, username } = payload
    this.tx(() => {
      let detail = ''
      if (['suspend', 'progress', 'grant'].includes(action)) {
        const target = this.byName(username)
        if (!target || target.role === 'owner')
          throw new AccountError(
            400,
            'Choose a registered player, not the owner.',
          )
        detail = target.username
        if (action === 'suspend') {
          if (typeof payload.suspended !== 'boolean')
            throw new AccountError(400, 'Choose an account status.')
          this.run(
            'UPDATE accounts SET suspended=? WHERE id=?',
            Number(payload.suspended),
            target.id,
          )
          if (payload.suspended)
            this.run('DELETE FROM sessions WHERE account_id=?', target.id)
          detail += payload.suspended ? ' suspended' : ' active'
        } else if (action === 'progress') {
          if (
            !Number.isSafeInteger(payload.xp) ||
            !Number.isSafeInteger(payload.credits)
          )
            throw new AccountError(400, 'XP and credits must be integers.')
          this.run(
            'UPDATE accounts SET xp=?, credits=? WHERE id=?',
            bounded(payload.xp, MAX_XP),
            bounded(payload.credits, MAX_CREDITS),
            target.id,
          )
        } else {
          const item = cosmetic(payload.item)
          if (!item) throw new AccountError(404, 'Unknown cosmetic.')
          this.run(
            'INSERT OR IGNORE INTO inventory VALUES(?,?,?)',
            target.id,
            item.id,
            this.now(),
          )
          detail += ` / ${item.id}`
        }
      } else if (action === 'announcement') {
        this.setConfig('announcement', shortText(payload.text, 210))
        detail = 'Launcher bulletin'
      } else if (action === 'event') {
        if (payload.hours === 0) this.setConfig('event', null)
        else {
          const label = shortText(payload.label, 42),
            hours = bounded(payload.hours, 168)
          if (!label || !hours || ![1.5, 2].includes(payload.multiplier))
            throw new AccountError(
              400,
              'Set an event title, hours, and XP multiplier.',
            )
          this.setConfig('event', {
            label,
            multiplier: payload.multiplier,
            until: this.now() + hours * 3600000,
          })
        }
        detail = 'Online XP event'
      } else if (action === 'playlist') {
        if (!playerPath(payload.mode) || typeof payload.enabled !== 'boolean')
          throw new AccountError(400, 'Select an online playlist.')
        const disabled = new Set(this.getConfig('disabled', []))
        if (payload.enabled) disabled.delete(payload.mode)
        else disabled.add(payload.mode)
        this.setConfig('disabled', [...disabled])
        detail = payload.mode
      } else if (action === 'catalog') {
        if (!cosmetic(payload.item) || typeof payload.enabled !== 'boolean')
          throw new AccountError(400, 'Select a cosmetic and a listing status.')
        const hidden = new Set(this.getConfig('hidden-items', []))
        if (payload.enabled) hidden.delete(payload.item)
        else hidden.add(payload.item)
        this.setConfig('hidden-items', [...hidden])
        detail = payload.item
      } else if (action === 'moderate') {
        if (
          !Number.isSafeInteger(payload.report) ||
          !['reviewed', 'dismissed'].includes(payload.status)
        )
          throw new AccountError(400, 'Select a report outcome.')
        if (
          !this.run(
            'UPDATE reports SET status=? WHERE id=?',
            payload.status,
            payload.report,
          ).changes
        )
          throw new AccountError(404, 'Report not found.')
        detail = `Report ${payload.report} ${payload.status}`
      } else throw new AccountError(404, 'Unknown owner action.')
      this.run(
        'INSERT INTO owner_audit(action,detail,created) VALUES(?,?,?)',
        action,
        detail,
        this.now(),
      )
    })
  }
}
