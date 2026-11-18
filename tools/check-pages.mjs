import assert from 'node:assert/strict'
import { once } from 'node:events'
import { access, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const output = new URL('../out/pages/', import.meta.url)
const prefix = '/NDX-WARZONE/'
const projectUrl = new URL(prefix, 'https://example.invalid')
const html = await readFile(new URL('index.html', output), 'utf8').catch(
  (error) => {
    if (error.code !== 'ENOENT') throw error
    throw new Error('Run npm run build:pages before npm run test:pages.')
  },
)
const entry = [
  ...html.matchAll(/<(?:link|script|img)\b[^>]+(?:href|src)="([^"]+)"/gu),
].map(([, ref]) => ref)
assert.match(html, /NDX WARZONE/u)
assert.ok(
  entry.some((ref) => ref.endsWith('.js')),
  'built application entry',
)
assert.ok(
  entry.some((ref) => ref.endsWith('.css')),
  'built styles',
)
for (const ref of entry) {
  const url = new URL(ref, projectUrl)
  assert.equal(url.origin, projectUrl.origin, ref)
  assert.ok(url.pathname.startsWith(prefix), `${ref} escapes the project path`)
  await access(new URL(url.pathname.slice(prefix.length), output))
}
for (const asset of [
  'media/floodline.webp',
  'media/relay-works.webp',
  'media/surfaces/gravel.webp',
  'media/surfaces/concrete.webp',
  'models/armory/raven.glb',
  'models/operators/warden.glb',
  'models/field/textures/T_Dirt_BaseColor.jpg',
  'models/CREDITS.md',
])
  await access(new URL(asset, output))
console.log(
  'Pages artifact: project-relative entry, styles, icon, map art, models, and textures',
)

// Opt-in browser test. Serve only a project subdirectory, with no WebSocket
// server or root asset fallback, as on a static host such as GitHub Pages.
if (process.env.NDX_PAGES_BROWSER === '1') {
  const directory = resolve(fileURLToPath(output))
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.glb': 'model/gltf-binary',
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, projectUrl).pathname
    if (!path.startsWith(prefix)) return res.writeHead(404).end()
    const file = resolve(directory, path.slice(prefix.length) || 'index.html')
    if (!file.startsWith(directory + sep)) return res.writeHead(404).end()
    try {
      const payload = await readFile(file)
      res
        .writeHead(200, {
          'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        })
        .end(payload)
    } catch {
      res.writeHead(404).end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const baseURL = `http://127.0.0.1:${server.address().port}${prefix}`
  let browser
  try {
    const args = ['--disable-dev-shm-usage', '--no-sandbox']
    if (process.env.NDX_SOFTWARE === '1')
      args.push(
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--disable-gpu-sandbox',
        '--no-zygote',
      )
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      headless: true,
      args,
    })
    const page = await browser.newPage({
      baseURL,
      viewport: { width: 940, height: 634 },
    })
    page.setDefaultTimeout(45_000)
    const errors = [],
      loaded = new Set(),
      sockets = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('requestfailed', (request) =>
      errors.push(`${request.url()}: ${request.failure()?.errorText}`),
    )
    page.on('response', (response) => {
      const { pathname } = new URL(response.url())
      if (!response.ok() || !pathname.startsWith(prefix))
        errors.push(`${response.status()} ${pathname}`)
      else loaded.add(pathname.slice(prefix.length))
    })
    page.on('websocket', (socket) => sockets.push(socket.url()))
    await page.addInitScript(() =>
      localStorage.setItem(
        'ndx-settings',
        JSON.stringify({ quality: 'low', online: true }),
      ),
    )
    await page.goto('?room=ABCDE')
    const button = (name) => page.getByRole('button', { name, exact: true })
    await page.waitForFunction(
      () =>
        document.getElementById('site-edition')?.textContent ===
        'BROWSER EDITION',
    )
    assert.equal(await page.locator('.playlist-card').count(), 6)
    assert.equal(await button('Private Match').count(), 0)
    assert.equal(await page.locator('dialog[open]').count(), 0)
    await button('Settings').click()
    const settings = page.getByRole('dialog', { name: 'Game Settings' })
    assert.equal(
      await settings.getByLabel('Public matchmaking', { exact: true }).count(),
      0,
    )
    await settings
      .getByText(/Online rooms require a multiplayer server/)
      .waitFor()
    await settings.getByRole('button', { name: 'Close', exact: true }).click()
    await button('Mission setup').click()
    const setup = page.getByRole('dialog', { name: 'Mission Setup' })
    await setup.getByRole('button', { name: 'Floodline', exact: true }).click()
    await setup.getByRole('button', { name: 'Elite', exact: true }).click()
    await page.waitForFunction(() => {
      const image = document.getElementById('hero-art')
      return (
        image?.src.endsWith('media/floodline.webp') &&
        image.complete &&
        image.naturalWidth > 0
      )
    })
    await setup.getByRole('button', { name: 'Close', exact: true }).click()
    await button('Training Range').click()
    await button('Enter range').click()
    await page.waitForFunction(() =>
      document.querySelector('#hud-armor')?.hasAttribute('aria-valuetext'),
    )
    await page.waitForFunction(() => {
      const resources = performance
        .getEntriesByType('resource')
        .map((entry) => entry.name)
      return [
        'models/armory/raven.glb',
        'models/operators/warden.glb',
        'media/surfaces/gravel.webp',
        'media/surfaces/concrete.webp',
      ].every((path) => resources.some((url) => url.endsWith(path)))
    })
    await page.keyboard.press('e')
    await page.getByRole('dialog', { name: 'Range Drills' }).waitFor()
    assert.equal(
      await page
        .locator('.field-canvas')
        .evaluate((canvas) => canvas.getContext('webgl2')?.getError()),
      0,
    )
    assert.ok(
      [...loaded].some((ref) => ref.endsWith('.woff2')),
      'local font served',
    )
    assert.deepEqual(sockets, [], 'static edition must not open a room socket')
    assert.deepEqual(errors, [])
    console.log(
      'Pages browser: nested project URL, six playlists, Floodline art, static settings, Echo Range, models and textures, no socket',
    )
  } finally {
    await browser?.close()
    await new Promise((done) => server.close(done))
  }
}
