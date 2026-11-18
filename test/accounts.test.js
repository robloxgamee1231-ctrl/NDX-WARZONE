import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { WebSocket } from 'ws'
import {
  AccountStore,
  MAX_XP,
  SESSION_AGE,
  accountDatabase,
} from '../server/accounts/store.js'
import { createAccountHandler } from '../server/accounts/http.js'
import { attachRoomServer } from '../server/rooms.js'
import { CATALOG, RARITIES } from '../src/game/cosmetics.js'
import { Match } from '../src/game/match.js'

const pass = 'QA entry string -- 290'
const next = 'QA rotated string -- 657'
const status = (n) => (error) => error.status === n
const memory = (t, options = {}) => {
  const s = new AccountStore({ path: ':memory:', ...options })
  t.after(() => s.close())
  return s
}

test('configured databases cannot be placed under a served asset directory', () => {
  const before = process.env.NDX_DB_PATH
  try {
    for (const folder of ['public', 'dist', 'out/pages']) {
      process.env.NDX_DB_PATH = `${folder}/db-store`
      assert.throws(accountDatabase, /outside the served asset directories/)
    }
    process.env.NDX_DB_PATH = ':memory:'
    assert.equal(accountDatabase(), ':memory:')
  } finally {
    if (before === undefined) delete process.env.NDX_DB_PATH
    else process.env.NDX_DB_PATH = before
  }
})

test('register, hashed session, persistent account and kit, username change, recovery, and previous-session revocation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ndx-accounts-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'accounts.sqlite')
  let first = new AccountStore({ path }),
    session,
    user,
    recovery
  try {
    await assert.rejects(first.register('ndx', pass), status(409))
    await assert.rejects(first.register('Vail', 'weak'), status(400))
    ;({ user, recovery } = await first.register('Vail', pass))
    session = first.issue(user)
    assert.match(recovery, /^[A-Za-z0-9_-]{43}$/)
    assert.ok(!user.password_hash.includes(pass))
    assert.notEqual(user.recovery_hash, recovery)
    const record = first.get(
      'SELECT hash FROM sessions WHERE account_id=?',
      user.id,
    )
    assert.notEqual(record.hash, session)
    assert.equal(first.view(user).role, 'player')
    assert.equal(first.view(user).password_hash, undefined)
    await assert.rejects(first.register('vail', pass), status(409))
    await assert.rejects(first.login('Vail', 'bad value'), status(401))
    first.purchase(user, 'raven.clay')
    first.equip(user, 'raven.clay')
  } finally {
    first.close()
  }
  first = new AccountStore({ path })
  try {
    const old = first.fromSession(session)
    assert.equal(old.id, user.id)
    assert.equal(first.view(old).loadout.finish, 'raven.clay')
    const name = await first.rename(old, 'Vail_2', pass)
    assert.equal(name.username, 'Vail_2')
    assert.equal(name.callsign, 'Vail')
    await assert.rejects(first.login('Vail', pass), status(401))
    const change = await first.recover('Vail_2', recovery, next)
    assert.notEqual(change.recovery, recovery)
    assert.equal(first.fromSession(session), null)
    await assert.rejects(first.recover('Vail_2', recovery, pass), status(401))
    const actual = await first.login('vail_2', next)
    const fresh = first.issue(actual)
    await first.changePassword(actual, next, pass)
    assert.equal(first.fromSession(fresh), null)
    await assert.rejects(first.login('Vail_2', next), status(401))
  } finally {
    first.close()
  }
})

test('NDX local bootstrap cannot go live prior to rotation; owner benefits and RBAC are server assigned', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ndx-local-owner-')),
    path = join(directory, 'accounts.sqlite')
  t.after(() => rm(directory, { recursive: true, force: true }))
  const store = new AccountStore({ path, allowBootstrap: true })
  try {
    const { user } = await store.register('NDX', 'NDX', {
      owner: true,
      bootstrap: true,
    })
    assert.throws(() => new AccountStore({ path }), /Rotate the local NDX/)
    assert.throws(
      () => store.ownerAction(user, { action: 'announcement', text: 'wrong' }),
      status(403),
    )
    const { user: rotated } = await store.changePassword(user, 'NDX', pass)
    const view = store.view(rotated)
    assert.deepEqual(
      [view.xp, view.rank, view.unlimited, view.badge],
      [MAX_XP, 100, true, 'NDX / OWNER'],
    )
    assert.equal(view.inventory.length, CATALOG.length)
    assert.ok(view.achievements.length > 0)
    const player = (await store.register('Solo', pass)).user
    assert.throws(
      () => store.ownerAction(player, { action: 'announcement', text: 'fake' }),
      status(403),
    )
    assert.throws(() => store.profile(player, 'NDX'), status(409))
    assert.equal(
      store.kit({ finish: 'raven.eclipse' }, 'raven', player).finish,
      'issue',
    )
    assert.equal(
      store.kit({ finish: 'raven.eclipse' }, 'raven', rotated).finish,
      'raven.eclipse',
    )
    store.ownerAction(rotated, {
      action: 'grant',
      username: 'Solo',
      item: 'warden.lagoon',
    })
    store.equip(player, 'warden.lagoon')
    assert.equal(
      store.view(store.account(player.id)).loadout.operator,
      'warden.lagoon',
    )
  } finally {
    store.close()
  }
  const production = new AccountStore({ path })
  try {
    assert.equal((await production.login('NDX', pass)).role, 'owner')
    await assert.rejects(production.login('NDX', 'NDX'), status(401))
  } finally {
    production.close()
  }
})

test('catalog IDs, rank gates, transactions, storefront visibility and account moderation enforce entitlements', async (t) => {
  let now = 10_000
  const s = memory(t, { now: () => now })
  const { user: owner } = await s.register('NDX', pass, { owner: true }),
    { user: p } = await s.register('Rowan', pass),
    { user: other } = await s.register('Ivy', pass)
  const cookie = s.issue(p)
  assert.equal(RARITIES.length, 6)
  assert.equal(CATALOG.length, 216)
  assert.equal(new Set(CATALOG.map((i) => i.id)).size, CATALOG.length)
  assert.throws(() => s.equip(p, 'viper.clay'), status(403))
  assert.throws(() => s.purchase(p, 'raven.eclipse'), status(409))
  assert.equal(s.purchase(p, 'raven.clay').credits, 210)
  assert.equal(s.purchase(p, 'raven.clay').credits, 210)
  assert.equal(s.purchase(p, 'spectre.clay').credits, 120)
  assert.equal(s.equip(p, 'spectre.clay').loadout.sideFinish, 'spectre.clay')
  assert.equal(
    s.saveKit(p, {
      primary: 'viper',
      finish: 'raven.clay',
      operator: 'warden.solar',
    }).loadout.finish,
    'issue',
  )
  s.ownerAction(owner, {
    action: 'catalog',
    item: 'viper.clay',
    enabled: false,
  })
  assert.throws(() => s.purchase(p, 'viper.clay'), status(404))
  s.report(other, 'Rowan', 'Valid reason for moderator review.')
  assert.throws(
    () =>
      s.report(other, 'Rowan', 'No duplicate reason accepted within cooldown.'),
    status(429),
  )
  const report = s.management(owner, 'Rowan').reports[0]
  s.ownerAction(owner, {
    action: 'moderate',
    report: report.id,
    status: 'reviewed',
  })
  s.ownerAction(owner, {
    action: 'suspend',
    username: 'Rowan',
    suspended: true,
  })
  assert.equal(s.fromSession(cookie), null)
  await assert.rejects(s.login('Rowan', pass), status(401))
  s.ownerAction(owner, {
    action: 'suspend',
    username: 'Rowan',
    suspended: false,
  })
  const timed = s.issue(await s.login('Rowan', pass))
  now += SESSION_AGE
  assert.equal(s.fromSession(timed), null)
  assert.equal(s.management(owner, 'Rowan').reports[0].status, 'reviewed')
})

test('eligible public rounds award XP once; private, local, bots and idle seats never award career progress', async (t) => {
  let now = Date.UTC(2026, 10, 18, 10)
  const s = memory(t, { now: () => now }),
    { user } = await s.register('Lark', pass),
    { user: idle } = await s.register('Stationary', pass),
    { user: owner } = await s.register('NDX', pass, { owner: true })
  const match = new Match({
    mode: 'kill-confirmed',
    bots: 2,
    players: [{ id: 'p' }, { id: 'i' }],
  })
  const p = match.players.get('p')
  p.activeTime = 5.3
  match.time = 42
  match.finish(p.team)
  const room = {
    key: randomUUID(),
    public: false,
    match,
    members: new Map([
      ['p', { id: 'p', accountId: user.id }],
      ['i', { id: 'i', accountId: idle.id }],
      ['bot1', { id: 'bot1', accountId: owner.id }],
    ]),
  }
  assert.deepEqual(s.awardMatch(room), [])
  room.public = true
  s.ownerAction(owner, {
    action: 'event',
    label: 'Night Shift',
    hours: 24,
    multiplier: 2,
  })
  assert.deepEqual(s.awardMatch(room), [{ id: 'p', xp: 330, credits: 50 }])
  assert.deepEqual(s.awardMatch(room), [])
  const view = s.view(s.account(user.id))
  assert.deepEqual(
    [view.rank, view.credits, view.stats.matches, view.stats.wins],
    [2, 350, 1, 1],
  )
  assert.equal(s.history(user)[0].map, 'neon-district')
  const entry = s.leaderboard()[0]
  assert.equal(entry.username, 'Lark')
  assert.ok(view.achievements.some((a) => a.id === 'first-match'))
  assert.equal(s.challenges(user).find((c) => c.id === 'daily-op').progress, 1)
  assert.equal(s.claim(user, 'daily-op').credits, 410)
  assert.equal(s.claim(user, 'daily-op').credits, 410)
  now += 86_400_000
  assert.equal(s.challenges(user).find((c) => c.id === 'daily-op').progress, 0)
  assert.equal(s.live().event, null)
})

async function fixture(t, s, { quickWait = 300 } = {}) {
  const server = createServer((req, res) => {
    if (!handler(req, res)) res.writeHead(404).end()
  })
  const rooms = attachRoomServer(server, {
    accounts: s,
    capacity: 12,
    quickWait,
    reconnectMs: 2000,
  })
  const handler = createAccountHandler(s, rooms.summary)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  t.after(
    () =>
      new Promise((resolve) => {
        rooms.close()
        server.close(resolve)
        server.closeAllConnections()
      }),
  )
  const api = (path, body, cookie, otherHeaders = {}) =>
    fetch(`${origin}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...otherHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  async function ws(cookie) {
    const socket = new WebSocket(origin.replace('http', 'ws') + '/ws', {
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    })
    const queue = []
    socket.on('message', (raw) => queue.push(JSON.parse(raw)))
    await once(socket, 'open')
    const wait = async (kind, test = () => true) => {
      for (let n = 0; n < 300; n++) {
        const i = queue.findIndex((x) => x.kind === kind && test(x))
        if (i !== -1) return queue.splice(i, 1)[0]
        await new Promise((r) => setTimeout(r, 10))
      }
      assert.fail(`Missing ${kind}: ${queue.slice(-5).map((m) => m.kind)}`)
    }
    return { socket, wait, send: (data) => socket.send(JSON.stringify(data)) }
  }
  return { origin, api, rooms, ws }
}
const cookieOf = (response) => response.headers.get('set-cookie')?.split(';')[0]

test('HTTP protects owner routes, enforces same-origin writes, and never lets signup assign privileges', async (t) => {
  const s = memory(t),
    { api } = await fixture(t, s)
  const other = await api(
    'register',
    { username: 'Moor', password: pass },
    null,
    { Origin: 'https://other.invalid' },
  )
  assert.equal(other.status, 403)
  const signup = await api('register', {
    username: 'Moor',
    password: pass,
    role: 'owner',
    xp: 99999,
  })
  assert.equal(signup.status, 200)
  const ck = cookieOf(signup),
    body = await signup.json()
  assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/)
  assert.match(signup.headers.get('cache-control'), /no-store/)
  assert.deepEqual(
    [body.account.role, body.account.rank, body.account.badge],
    ['player', 1, null],
  )
  assert.equal((await api('owner', undefined, ck)).status, 403)
  assert.equal(
    (
      await api(
        'owner',
        { action: 'progress', username: 'Moor', xp: 2000, credits: 100 },
        ck,
      )
    ).status,
    403,
  )
  assert.equal((await api('equip', { item: 'raven.rose' }, ck)).status, 403)
  assert.equal((await api('profile', { callsign: '<script>' }, ck)).status, 400)
  const profile = await api('profile', { callsign: 'Moor Seven' }, ck)
  assert.equal((await profile.json()).account.callsign, 'Moor Seven')
  assert.equal((await api('logout', {}, ck)).status, 200)
  const session = await api('session', undefined, ck)
  assert.equal((await session.json()).account, null)
  assert.match(session.headers.get('set-cookie'), /Max-Age=0/)
})

test('HTTPS preview sessions use an HttpOnly partitioned cookie for embedding', async (t) => {
  const s = memory(t),
    { origin } = await fixture(t, s)
  const host = '5173-session-test.e2b.app'
  // Node's fetch uses the URL's Host. Send the public Host explicitly to
  // model a plain HTTP upstream behind the preview's TLS terminator.
  const api = (route, data, cookie) =>
    new Promise((resolve, reject) => {
      const r = request(
        `${origin}/api/${route}`,
        {
          method: data ? 'POST' : 'GET',
          headers: {
            Host: host,
            Origin: `https://${host}`,
            ...(data ? { 'Content-Type': 'application/json' } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        async (res) => {
          try {
            const chunks = []
            for await (const chunk of res) chunks.push(chunk)
            resolve({
              status: res.statusCode,
              cookie: res.headers['set-cookie']?.[0],
              data: JSON.parse(Buffer.concat(chunks).toString()),
            })
          } catch (error) {
            reject(error)
          }
        },
      )
      r.on('error', reject)
      r.end(data ? JSON.stringify(data) : undefined)
    })
  const response = await api('register', {
    username: 'EmbedPilot',
    password: pass,
  })
  assert.equal(response.status, 200)
  assert.match(response.cookie, /HttpOnly; SameSite=None; Secure; Partitioned/)
  const cookie = response.cookie.split(';')[0]
  const reply = await api('session', null, cookie)
  assert.equal(reply.data.account.username, 'EmbedPilot')
  const logout = await api('logout', {}, cookie)
  assert.match(
    logout.cookie,
    /Max-Age=0; HttpOnly; SameSite=None; Secure; Partitioned/,
  )
})

test('WebSocket uses authenticated identity and inventory, restores the same live seat, and records real server results', async (t) => {
  const s = memory(t),
    { api, rooms, ws } = await fixture(t, s)
  const a = await api('register', { username: 'RunnerOne', password: pass }),
    ck = cookieOf(a)
  const { account } = await a.json()
  const client = await ws(ck),
    peer = await ws()
  client.send({
    op: 'quick',
    mode: 'gun-game',
    name: 'NDX',
    owner: true,
    loadout: { finish: 'raven.eclipse', operator: 'nomad.lagoon' },
  })
  await client.wait('welcome')
  const l = await client.wait('lobby')
  assert.deepEqual(
    [l.players[0].name, l.players[0].owner, l.players[0].guest],
    ['RunnerOne', false, false],
  )
  peer.send({ op: 'quick', mode: 'gun-game', name: 'NDX' })
  await peer.wait('welcome')
  const d = await peer.wait('lobby', (l) => l.players.length === 2)
  assert.ok(d.players.some((p) => p.name === 'Guest' && p.guest))
  const begin = await client.wait('begin'),
    first = await client.wait('self')
  assert.deepEqual(
    [begin.resumable, first.self.loadout.finish, first.self.operator],
    [true, 'issue', 'auto'],
  )
  const closed = once(client.socket, 'close')
  client.socket.terminate()
  await closed
  const returning = await ws(ck)
  returning.send({ op: 'resume', code: l.code })
  assert.equal((await returning.wait('begin')).id, begin.id)
  assert.equal((await returning.wait('self')).self.id, begin.id)
  const match = rooms.rooms.get(l.code).match
  // Advance the authoritative fixture, never accepting a submitted result.
  const p = match.players.get(begin.id)
  match.time = 40
  p.kills = 7
  p.gunStage = 7
  await returning.wait('state', (d) => d.result?.team === p.team)
  const reward = await returning.wait('self', (d) => d.award)
  assert.ok(reward.award.xp > 100)
  assert.equal(s.history(s.account(account.id)).length, 1)
  assert.equal(rooms.summary().active, 0)
})
