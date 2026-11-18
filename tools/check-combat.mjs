import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { token } from '../server/accounts/security.js'
import { AccountStore } from '../server/accounts/store.js'

// A real public round, two separate browser profiles, and a disposable copy
// of the production service. No synthetic results or saved player data.
const directory = await mkdtemp(join(tmpdir(), 'ndx-combat-browser-'))
const path = join(directory, 'career.sqlite')
const software = process.env.NDX_SOFTWARE === '1'
const capture = process.env.NDX_QA_SCREENSHOTS
const timeout = 30_000
const username = 'CircuitRunner'
const ownerPassword = token(),
  playerPassword = token()
let browser,
  service,
  logs = ''

async function until(check, description, horizon = timeout) {
  const end = Date.now() + horizon
  do {
    const result = check()
    if (result) return result
    if (service?.exitCode !== null && service) break
    await delay(60)
  } while (Date.now() < end)
  assert.fail(`Timed out waiting for ${description}\n${logs}`)
}

const button = (page, name) => page.getByRole('button', { name, exact: true })
const form = (page, id) => page.locator(`form[data-career-form="${id}"]`)
const text = (page, value) => page.getByText(value, { exact: true })
const close = (page) => button(page, 'Close').click()
async function screenshot(page, name) {
  if (!capture) return
  await mkdir(capture, { recursive: true })
  await page.screenshot({ path: resolve(capture, `${name}.png`) })
}

function watch(page) {
  const records = []
  page.on('websocket', (socket) => {
    const r = { events: [], states: 0 }
    records.push(r)
    socket.on('framereceived', ({ payload }) => {
      const d = JSON.parse(payload.toString())
      if (d.kind === 'begin') r.start = d
      else if (d.kind === 'self') {
        r.self = d.self
        if (d.award) r.award = d.award
        if (d.events.length) r.events.push(...d.events)
      } else if (d.kind === 'state') {
        r.state = d
        r.states++
      }
    })
  })
  return records
}

async function open(browser, baseURL) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 880, height: 610 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(() => {
    if (!localStorage.getItem('ndx-settings'))
      localStorage.setItem('ndx-settings', JSON.stringify({ quality: 'low' }))
    const Native = window.WebSocket
    // Keep a test-only socket handle so we can interrupt the transport without
    // the app's normal Leave message. The real server reserves the old seat.
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args)
        window.interruptRoomSocket = () => this.close(4001, 'QA interruption')
      }
    }
  })
  const page = await context.newPage(),
    errors = []
  const records = watch(page)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.setDefaultTimeout(timeout)
  await page.goto('/')
  await text(page, 'ROOMS LIVE').waitFor()
  return { page, errors, records }
}

async function authenticate(page, id, user, password) {
  await button(page, 'Operator profile').click()
  if (id === 'register') await button(page, 'Create account').click()
  await form(page, id).getByLabel('Username').fill(user)
  await form(page, id).getByLabel('Password', { exact: true }).fill(password)
  await form(page, id).locator('button[type=submit]').click()
  if (id === 'register') {
    const code = page.locator('.recovery-box code')
    await code.waitFor()
    assert.ok(/^[A-Za-z0-9_-]{43}$/.test(await code.textContent()))
    await button(page, 'I saved the code').click()
  }
  await text(page, `@${user}`).waitFor()
  await close(page)
}

async function deploy(page) {
  await button(page, 'Multiplayer').click()
  await button(page, 'Enable public matchmaking').click()
  await button(page, 'Gun Game').click()
  await button(page, 'Deploy now').click()
}

try {
  const setup = new AccountStore({ path })
  try {
    await setup.register('NDX', ownerPassword, { owner: true })
  } finally {
    setup.close()
  }
  service = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('../', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '0',
      NDX_BIND_HOST: '127.0.0.1',
      NDX_DB_PATH: path,
      NDX_PUBLIC_ORIGIN: '',
      NDX_LOCAL_OWNER: '0',
      MATCH_CAPACITY: '8',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  service.stdout.on('data', (text) => (logs += text))
  service.stderr.on('data', (text) => (logs += text))
  const port = await until(
    () => /NDX Combat is listening on (\d+)/.exec(logs)?.[1],
    'isolated server',
  )
  const args = ['--no-sandbox', '--disable-dev-shm-usage']
  if (software)
    args.push(
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--disable-gpu-sandbox',
      '--no-zygote',
    )
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args,
    headless: true,
  })
  const origin = `http://127.0.0.1:${port}`
  const a = await open(browser, origin),
    b = await open(browser, origin)
  await authenticate(a.page, 'register', username, playerPassword)
  assert.equal(await button(a.page, 'Owner console').count(), 0)
  assert.equal((await a.page.request.get('/api/owner')).status(), 403)
  const cookie = (await a.page.context().cookies()).find(
    (c) => c.name === 'ndx_session',
  )
  assert.ok(cookie?.httpOnly)

  await authenticate(b.page, 'login', 'NDX', ownerPassword)
  await button(b.page, 'Owner console').click()
  await text(b.page, 'RANK 100 · ∞ CR').waitFor()
  await form(b.page, 'announcement')
    .getByLabel(/Announcement/)
    .fill('Circuit QA / active link')
  await form(b.page, 'announcement')
    .getByRole('button', { name: 'Publish bulletin' })
    .click()
  await text(b.page, 'announcement / Launcher bulletin').waitFor()
  await screenshot(b.page, 'owner-console')
  await close(b.page)
  await a.page.reload()
  await text(a.page, 'Circuit QA / active link').waitFor()
  await text(a.page, 'RANK 01').waitFor()
  await button(a.page, 'Store').click()
  await a.page.getByLabel('Find a cosmetic').fill('Red Clay')
  await button(a.page, 'Search').click()
  await a.page.locator('.cosmetic-tile[data-id="raven.clay"]').click()
  await button(a.page, 'Unlock · 90 CR').click()
  await text(a.page, '210 CR').waitFor()
  await button(a.page, 'Equip').click()
  await text(a.page, 'EQUIPPED').waitFor()
  await a.page.locator('[data-model-preview][data-renderer]').waitFor()
  await screenshot(a.page, 'cosmetic-store')
  await close(a.page)
  await a.page
    .locator('[data-model-preview] canvas')
    .waitFor({ state: 'detached' })
  console.log(
    'Career: isolated signup and login, owner permission and live bulletin, real credit purchase and 3D equip',
  )

  await Promise.all([deploy(a.page), deploy(b.page)])
  await until(
    () => a.records[0]?.self && b.records[0]?.self,
    'both live deployments',
  )
  const original = a.records[0].start,
    peer = b.records[0].start
  assert.deepEqual(
    [original.mode, original.map, original.private, original.resumable],
    ['gun-game', 'neon-district', false, true],
  )
  assert.equal(peer.room, original.room)
  assert.notEqual(peer.id, original.id)
  const field = a.page.locator(
    '.field-canvas[data-field-asset="neon-district"]',
  )
  await field.waitFor()
  assert.equal(
    await field.evaluate((canvas) => canvas.getContext('webgl2')?.getError()),
    0,
  )
  assert.equal(
    await a.page.locator('#hud-match-tag').textContent(),
    'Gun Game / Solo',
  )
  assert.equal(a.records[0].self.name, username)
  assert.equal(b.records[0].self.name, 'NDX')
  await screenshot(a.page, 'district-public')

  const staleAck = (
    await until(
      () => a.records[0].self?.ack > 0 && a.records[0].self,
      'first input ACK',
    )
  ).ack
  await a.page.evaluate(() => window.interruptRoomSocket())
  const r = await until(
    () => a.records[1]?.start && a.records[1],
    'automatic reservation resume',
  )
  assert.equal(r.start.id, original.id)
  assert.equal(r.start.seed, original.seed)
  await until(
    () => r.self?.id === original.id && r.self.ack > staleAck,
    'ACK advances after reconnection',
  )
  assert.equal(b.records.length, 1)
  await text(a.page, 'Match connection restored.').waitFor()
  await a.page.bringToFront()
  // Keep the player active using ordinary movement. Respawns may clear held
  // keys, so issue a fresh movement key after each short interval.
  for (let i = 0; i < 7 && !r.state?.result; i++) {
    const key = ['w', 'a', 's', 'd'][i % 4]
    await a.page.keyboard.down(key)
    await delay(2100)
    await a.page.keyboard.up(key)
  }
  console.log(
    'Live: same Neon District room and authentic identities, interrupted socket recovered the same seat with increasing ACKs',
  )
  await until(() => r.state?.result, 'naturally completed Gun Game', 340_000)
  assert.ok(r.state.players.some((actor) => actor[0] === peer.id))
  assert.ok(r.award?.xp > 0, 'active signed-in player earns career XP')
  await a.page.locator('.result-window .earned-result').waitFor()
  await screenshot(a.page, 'ranked-result')
  await button(a.page, 'Return to operations').press('Enter')
  await button(a.page, 'Operator profile').click()
  await text(a.page, 'Gun Game · Neon District').waitFor()
  await close(a.page)
  await button(a.page, 'Leaderboards').click()
  await a.page
    .locator('.leaderboard-row')
    .getByText(username, { exact: true })
    .waitFor()
  await close(a.page)
  await button(a.page, 'Events').click()
  await a.page.locator('[data-career=claim][data-id=daily-op]').click()
  await text(a.page, 'CLAIMED').first().waitFor()
  const final = await (await a.page.request.get('/api/career')).json()
  assert.equal(final.history.length, 1)
  assert.equal(final.account.credits, 210 + r.award.credits + 60)
  assert.ok(final.challenges.find((c) => c.id === 'daily-op')?.claimed)
  assert.deepEqual(a.errors, [])
  assert.deepEqual(b.errors, [])

  const stopped = once(service, 'exit')
  service.kill()
  await stopped
  const persisted = new AccountStore({ path })
  try {
    const p = persisted.byName(username)
    assert.equal(p.matches, 1)
    assert.equal(p.xp, r.award.xp)
    assert.equal(p.credits, final.account.credits)
    assert.equal(persisted.view(p).loadout.finish, 'raven.clay')
    assert.equal(persisted.history(p)[0].map, 'neon-district')
  } finally {
    persisted.close()
  }
  console.log(
    `Ranked: Gun Game finished at ${r.state.time.toFixed(1)}s; +${r.award.xp} XP and +${r.award.credits} CR, leaderboard and daily claim, verified from disk after shutdown`,
  )
} finally {
  try {
    await browser?.close()
  } finally {
    if (service?.exitCode === null && service.signalCode === null) {
      const stopped = once(service, 'exit')
      service.kill()
      await stopped
    }
    await rm(directory, { recursive: true, force: true })
  }
}
