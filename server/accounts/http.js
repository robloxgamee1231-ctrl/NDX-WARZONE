import { AccountStore } from './store.js'
import { AccountError } from './security.js'

const COOKIE = 'ndx_session'
const MAX_BODY = 8192
export function sessionCookie(req) {
  return (
    /(?:^|;\s*)ndx_session=([A-Za-z0-9_-]{43})(?=;|$)/.exec(
      req.headers.cookie ?? '',
    )?.[1] ?? null
  )
}

// Browser POSTs and room upgrades are origin checked, not CORS enabled. A
// reverse proxy that rewrites Host must configure the exact public origin.
export function originAllowed(req, origin = req.headers.origin) {
  if (typeof origin !== 'string') return false
  try {
    const url = new URL(origin)
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
      return false
    const expected = process.env.NDX_PUBLIC_ORIGIN
    if (expected) return url.origin === new URL(expected).origin
    const host = req.headers.host
    return (
      !!host &&
      url.host === new URL(`${url.protocol}//${host}`).host &&
      (!req.socket.encrypted || url.protocol === 'https:')
    )
  } catch {
    return false
  }
}
function setSession(req, res, value, age) {
  let embeddedPreview = false
  try {
    const host = new URL(
      process.env.NDX_PUBLIC_ORIGIN || `https://${req.headers.host}`,
    ).hostname
    embeddedPreview = host.endsWith('.e2b.app')
  } catch {
    // Use the normal first-party cookie if the host cannot be parsed.
  }
  const secure =
    embeddedPreview ||
    process.env.NODE_ENV === 'production' ||
    req.socket.encrypted ||
    req.headers.origin?.startsWith('https://') ||
    process.env.NDX_PUBLIC_ORIGIN?.startsWith('https://')
  // Arena's HTTPS preview can be embedded on a different site. Use a
  // partitioned session there; continue to origin-check all writes/upgrades.
  const policy = embeddedPreview
    ? 'SameSite=None; Secure; Partitioned'
    : `SameSite=Lax${secure ? '; Secure' : ''}`
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${value}; Path=/; Max-Age=${age}; HttpOnly; ${policy}`,
  )
}
function reply(res, status, body) {
  res
    .writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify(body))
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new AccountError(415, 'Send a JSON request.')
  if (Number(req.headers['content-length']) > MAX_BODY)
    throw new AccountError(413, 'Request is too large.')
  const chunks = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > MAX_BODY) {
      req.resume()
      throw new AccountError(413, 'Request is too large.')
    }
    chunks.push(chunk)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || Array.isArray(value) || typeof value !== 'object')
      throw new Error()
    return value
  } catch {
    throw new AccountError(400, 'Invalid request data.')
  }
}
function createLimiter() {
  const counters = new Map()
  let cleanup = 0
  return (req, group, limit, duration) => {
    const now = Date.now()
    if (now >= cleanup) {
      for (const [key, bucket] of counters)
        if (bucket.until <= now) counters.delete(key)
      cleanup = now + 20_000
    }
    const forwarded =
      process.env.NDX_TRUST_PROXY === '1'
        ? req.headers['x-forwarded-for']?.split(',').at(-1)?.trim()
        : null
    const key = `${forwarded?.slice(0, 64) || req.socket.remoteAddress}:${group}`
    let bucket = counters.get(key)
    if (!bucket || bucket.until <= now) {
      if (counters.size >= 10_000 && !counters.has(key))
        throw new AccountError(429, 'Too many requests. Try again later.')
      bucket = { count: 0, until: now + duration }
      counters.set(key, bucket)
    }
    if (++bucket.count > limit)
      throw new AccountError(429, 'Too many requests. Try again later.')
  }
}

export function createAccountHandler(store, summary = () => ({})) {
  const limit = createLimiter()
  async function serve(req, res, url) {
    const path = url.pathname.slice(5),
      method = req.method
    const value = sessionCookie(req)
    const user = store.fromSession(value)
    if (method === 'GET') {
      if (path === 'session') {
        if (value && !user) setSession(req, res, '', 0)
        return reply(res, 200, {
          account: store.view(user),
          live: store.live(),
          rooms: summary(),
        })
      }
      if (path === 'leaders')
        return reply(res, 200, { players: store.leaderboard() })
      if (!['career', 'owner'].includes(path))
        throw new AccountError(404, 'Unknown account route.')
      if (!user) throw new AccountError(401, 'Sign in to continue.')
      if (user.must_rotate)
        throw new AccountError(403, 'Change your initial password first.')
      if (path === 'career')
        return reply(res, 200, {
          account: store.view(user),
          history: store.history(user),
          challenges: store.challenges(user),
          live: store.live(),
        })
      return reply(res, 200, {
        ...store.management(
          user,
          url.searchParams.get('q'),
          Number(url.searchParams.get('offset') ?? 0),
        ),
        rooms: summary(),
      })
    }
    if (method !== 'POST') throw new AccountError(405, 'Method not supported.')
    if (!originAllowed(req))
      throw new AccountError(
        403,
        'Open the game on its own origin before submitting changes.',
      )
    limit(req, 'write', 140, 60_000)
    const input = await readBody(req)
    // Re-read after streaming the body; a password change or ban may have
    // revoked the session while this request was arriving.
    const current = store.fromSession(value)
    let auth
    if (['login', 'register', 'recover', 'password'].includes(path)) {
      limit(req, 'credentials', 18, 60_000)
      if (path === 'login')
        auth = { user: await store.login(input.username, input.password) }
      if (path === 'register')
        auth = await store.register(input.username, input.password)
      if (path === 'recover')
        auth = await store.recover(
          input.username,
          input.recovery,
          input.password,
        )
      if (path === 'password') {
        if (!current) throw new AccountError(401, 'Sign in to continue.')
        auth = await store.changePassword(
          current,
          input.current,
          input.password,
        )
      }
      store.revoke(value)
      setSession(req, res, store.issue(auth.user), 14 * 86400)
      return reply(res, 200, {
        account: store.view(auth.user),
        recovery: auth.recovery,
        live: store.live(),
      })
    }
    if (path === 'logout') {
      store.revoke(value)
      setSession(req, res, '', 0)
      return reply(res, 200, { account: null, live: store.live() })
    }
    if (!current) throw new AccountError(401, 'Sign in to continue.')
    if (current.must_rotate)
      throw new AccountError(403, 'Change your initial password first.')
    if (path === 'rename') limit(req, 'credentials', 18, 60_000)
    let account
    switch (path) {
      case 'rename':
        account = await store.rename(current, input.username, input.password)
        break
      case 'profile':
        account = store.profile(current, input.callsign)
        break
      case 'kit':
        account = store.saveKit(current, input.loadout)
        break
      case 'buy':
        account = store.purchase(current, input.item)
        break
      case 'equip':
        account = store.equip(current, input.item)
        break
      case 'claim':
        account = store.claim(current, input.id)
        break
      case 'report':
        store.report(current, input.username, input.reason)
        break
      case 'owner':
        store.ownerAction(current, input)
        break
      default:
        throw new AccountError(404, 'Unknown account route.')
    }
    reply(res, 200, account ? { account } : { ok: true })
  }
  return (req, res, next) => {
    const path = req.url?.split('?')[0]
    if (!path?.startsWith('/api/')) {
      next?.()
      return false
    }
    serve(req, res, new URL(req.url, 'http://localhost')).catch((error) => {
      if (res.destroyed || res.headersSent) return
      if (error instanceof AccountError)
        reply(res, error.status, { error: error.message })
      else {
        console.error('Account service error:', error)
        reply(res, 503, { error: 'Career service is temporarily unavailable.' })
      }
    })
    return true
  }
}

export function openAccounts(options) {
  return new AccountStore(options)
}
