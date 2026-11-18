import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

// Run against an already-built production or Vite instance. This suite uses a
// temporary browser profile and never writes to an existing user's game saves.
const url = process.env.NDX_BROWSER_URL ?? 'http://127.0.0.1:5173'
const executablePath = process.env.CHROMIUM_PATH || undefined
const software = process.env.NDX_SOFTWARE === '1'
const capture = process.env.NDX_QA_SCREENSHOTS
const viewport = { width: 940, height: 634 }
const expected = 45_000 // software WebGL and shared CI hosts may run below 30 FPS
const launchArgs = ['--disable-dev-shm-usage', '--no-sandbox']
if (software)
  launchArgs.push(
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--disable-gpu-sandbox',
    '--no-zygote',
  )

class FieldProbe {
  constructor(page) {
    this.page = page
    this.errors = []
    this.assets = new Set()
    page.setDefaultTimeout(expected)
    page.on('pageerror', (e) => this.errors.push(e.stack ?? e.message))
    page.on('console', (m) => {
      if (m.type() === 'error') this.errors.push(m.text())
    })
    page.on('response', (response) => {
      const address = new URL(response.url())
      if (!address.pathname.startsWith('/models/')) return
      if (response.ok() || response.status() === 304)
        this.assets.add(address.pathname)
      else this.errors.push(`${response.status()} ${address.pathname}`)
    })
  }

  get button() {
    return (name) =>
      this.page.getByRole('button', { name, exact: typeof name === 'string' })
  }

  async chooseMode(mode) {
    await this.button(mode).click()
  }

  async missionSetup(battlefield, difficulty) {
    await this.button('Mission setup').click()
    const dialog = this.page.getByRole('dialog', { name: 'Mission Setup' })
    const pickMap = dialog.getByRole('button', {
      name: battlefield,
      exact: true,
    })
    await pickMap.click()
    await dialog.getByRole('button', { name: difficulty, exact: true }).click()
    assert.equal(await pickMap.getAttribute('aria-pressed'), 'true')
    return dialog
  }

  async loadedModel(id) {
    await this.page.waitForFunction(
      (path) =>
        performance
          .getEntriesByType('resource')
          .some((e) => new URL(e.name).pathname === path),
      `/models/armory/${id}.glb`,
    )
  }

  async ready() {
    await this.page.waitForFunction(
      () =>
        document.querySelector('#hud-armor')?.hasAttribute('aria-valuetext'),
      {},
      { timeout: expected },
    )
  }

  async value(id, value) {
    await this.page.waitForFunction(
      ({ id, value }) =>
        document.getElementById(id)?.textContent === String(value),
      { id, value },
      { timeout: expected },
    )
  }

  async stop() {
    await this.page.keyboard.press('p')
    await this.button('Exit to operations').press('Enter')
    await this.page.locator('#launcher').waitFor({ state: 'visible' })
  }

  async screenshot(name) {
    if (!capture) return
    await mkdir(capture, { recursive: true })
    await this.page.screenshot({ path: resolve(capture, `${name}.png`) })
  }

  async graphics() {
    const code = await this.page
      .locator('.field-canvas')
      .evaluate((canvas) => canvas.getContext('webgl2')?.getError())
    assert.equal(code, 0, 'WebGL must be active and error-free')
    assert.deepEqual(this.errors, [], 'no browser, shader, or asset errors')
  }
}

async function desktop(browser) {
  const page = await browser.newPage({ baseURL: url, viewport })
  const f = new FieldProbe(page)
  try {
    await page.addInitScript(() =>
      localStorage.setItem('ndx-settings', JSON.stringify({ quality: 'low' })),
    )
    await page.goto('/')
    assert.equal(await page.locator('.playlist-card').count(), 9)
    await f.chooseMode('Domination')
    assert.equal(await page.locator('#hero-total').textContent(), '09')
    await f.screenshot('garrison-launcher')
    await f.button('Loadouts').click()
    await page
      .getByRole('combobox', { name: 'Feed', exact: true })
      .selectOption('extended')
    await page
      .getByRole('combobox', { name: 'Stock', exact: true })
      .selectOption('braced')
    await f.button(/Smoke field/).click()
    await f.button(/Confirm loadout/).click()
    await page.locator('dialog[open]').waitFor({ state: 'hidden' })
    await f.chooseMode('Training Range')
    await f.button('Enter range').click()
    await f.ready()
    await f.value('hud-mag', 38)
    await page.waitForFunction(() =>
      performance
        .getEntriesByType('resource')
        .some((e) => e.name.includes('/models/armory/raven.glb')),
    )
    await f.value('hud-loot-name', 'Talk to Coach Vale')
    await page.locator('#hud-loot').waitFor({ state: 'visible' })
    await f.screenshot('coach-vale')
    await page.keyboard.press('e')
    const drills = page.getByRole('dialog', { name: 'Range Drills' })
    await drills.getByRole('button', { name: /Steel Sequence/ }).waitFor()
    await drills.getByRole('button', { name: 'Close panel' }).click()
    await f.screenshot('licensed-range')
    // Initial click captures the cursor. A second press should fire toward steel.
    await page.mouse.click(viewport.width / 2, viewport.height / 2)
    await page.waitForFunction(() =>
      document.getElementById('game')?.classList.contains('mouse-locked'),
    )
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.mouse.down()
    try {
      await page.waitForFunction(
        () => Number(document.querySelector('#hud-mag')?.textContent) < 38,
      )
      await page.waitForFunction(
        () => Number(document.querySelector('#hud-elims')?.textContent) > 0,
      )
    } finally {
      await page.mouse.up()
    }
    await page.keyboard.press('r')
    await f.value('hud-mag', 38)
    await page.keyboard.press('2')
    await f.value('hud-weapon-name', 'SPECTRE-8')
    await f.value('hud-mag', 12)
    await page.waitForFunction(() =>
      performance
        .getEntriesByType('resource')
        .some((e) => e.name.includes('/models/armory/spectre.glb')),
    )
    await f.screenshot('sidearm')
    // Slot commands during the equip cooldown are ignored. A fast headless
    // run can reach the second switch before that animation has finished.
    for (let retry = 0; retry < 12; retry++) {
      if ((await page.locator('#hud-weapon-name').textContent()) === 'RAVEN-4')
        break
      await page.keyboard.press('1')
      await page.waitForTimeout(150)
    }
    await f.value('hud-mag', 38)
    await page.keyboard.press('v')
    await page.waitForFunction(() =>
      document
        .getElementById('hud-gear')
        ?.textContent.replace(/\s+/g, ' ')
        .includes('1 V'),
    )
    await f.screenshot('coverage')
    await page.keyboard.press('m')
    const map = page.getByRole('dialog', { name: 'Tactical Map' })
    await map.getByRole('button', { name: 'Danger', exact: true }).click()
    const chart = map.locator('canvas')
    await chart.focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() =>
      document
        .getElementById('hud-toasts')
        ?.textContent.includes('Waypoint placed'),
    )
    assert.match(await page.locator('#map-readout').textContent(), /DANGER\s+X/)
    await f.screenshot('tactical-waypoint')
    await map.getByRole('button', { name: 'Clear mine' }).click()
    await map.getByRole('button', { name: 'Close panel' }).click()
    await page.keyboard.press('b')
    await f.button(/Momentum Circuit/).click()
    await page.waitForFunction(
      () => document.getElementById('hud-drill')?.dataset.state === 'active',
    )
    await f.screenshot('range-drill')
    await f.graphics()
    await f.stop()
    await f.chooseMode('Domination')
    const setup = await f.missionSetup('Relay Works', 'Veteran')
    if (capture) await setup.evaluate((dialog) => (dialog.scrollTop = 0))
    await f.screenshot('relay-mission-setup')
    await setup.getByRole('button', { name: 'Deploy now' }).click()
    await f.ready()
    await page.waitForFunction(
      () => document.querySelectorAll('.relay-strip .relay-chip').length === 3,
    )
    await page.waitForFunction(() =>
      performance
        .getEntriesByType('resource')
        .some((e) => /operators\/(warden|nomad)\.glb/.test(e.name)),
    )
    await page.waitForFunction(() => {
      const chips = document.querySelectorAll(
        '.relay-chip.friendly, .relay-chip.hostile',
      )
      return (
        chips.length > 0 &&
        Array.from(
          document.querySelectorAll('#hud-relays .relay-score b'),
        ).some((score) => Number(score.textContent) > 0)
      )
    })
    assert.equal(
      await page.locator('.map-header b').textContent(),
      'RELAY WORKS',
    )
    await f.screenshot('garrison-relays')
    await f.graphics()
    assert.ok(f.assets.has('/models/armory/spectre.glb'))
    assert.ok([...f.assets].some((a) => a.includes('/models/field/')))
    assert.equal(
      await page.locator('#hud-match-tag').textContent(),
      'Domination / TEAMS',
    )
    console.log(
      'Desktop: Coach Vale opened drills, shooting/reload, attachments, sidearm, smoke, keyboard map, Relay Works scoring, GLBs, WebGL',
    )
  } catch (error) {
    if (capture) await f.screenshot('desktop-failure')
    console.error(
      await page.evaluate(() => ({
        mode: document.querySelector('#hero')?.dataset.mode,
        bearing: document.querySelector('#hud-bearing')?.textContent,
        magazine: document.querySelector('#hud-mag')?.textContent,
        fieldPanel: document.querySelector('.field-panel h2')?.textContent,
      })),
    )
    throw error
  } finally {
    if (f.errors.length) console.error(f.errors)
    await page.close()
  }
}

async function fieldCommand(browser) {
  const page = await browser.newPage({ baseURL: url, viewport })
  const f = new FieldProbe(page)
  try {
    await page.addInitScript(() => {
      if (!localStorage.getItem('ndx-settings'))
        localStorage.setItem('ndx-settings', JSON.stringify({ quality: 'low' }))
    })
    await page.goto('/')
    await f.chooseMode('Battle Royale')
    const setup = await f.missionSetup('Floodline', 'Elite')
    assert.equal(
      await setup
        .getByRole('button', { name: 'Elite', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    )
    await setup.getByRole('button', { name: /^Done/ }).click()
    await page.reload()
    await f.chooseMode('Battle Royale')
    await f.value('selected-field', 'Floodline')
    await f.value('selected-difficulty', 'ELITE NPCS')
    await f.screenshot('floodline-launcher')
    await f.button('Loadouts').click()
    const armory = page.locator('dialog[open]')
    await armory.getByText('Standard gear included', { exact: true }).waitFor()
    assert.equal(await armory.locator('[data-weapon]').count(), 6)
    assert.equal(await armory.locator('[data-kit=finish]').count(), 6)
    assert.equal(await armory.locator('[data-kit=operator]').count(), 7)
    await f.button(/MISTRAL-3/).click()
    await f.button('Night Orchid').click()
    await f.button(/Tidewatch/).click()
    assert.equal(
      await armory.locator('[data-value=orchid]').getAttribute('aria-pressed'),
      'true',
    )
    assert.equal(
      await armory
        .locator('[data-value=tidewatch]')
        .getAttribute('aria-pressed'),
      'true',
    )
    await armory.evaluate((dialog) => (dialog.scrollTop = 0))
    await f.screenshot('expanded-armory')
    await f.button(/Confirm loadout/).click()
    await f.chooseMode('Training Range')
    await f.button('Enter range').click()
    await f.ready()
    await f.value('hud-weapon-name', 'MISTRAL-3')
    await f.value('hud-weapon-type', 'BURST CARBINE / ×3')
    await f.value('hud-mag', 27)
    await f.loadedModel('mistral')
    await page.mouse.click(viewport.width / 2, viewport.height / 2)
    await page.waitForFunction(() =>
      document.getElementById('game')?.classList.contains('mouse-locked'),
    )
    await page.mouse.move(viewport.width / 2, viewport.height / 2)
    await page.mouse.click(viewport.width / 2, viewport.height / 2)
    await f.value('hud-mag', 24)
    await f.screenshot('mistral-orchid')
    await f.graphics()
    await f.stop()

    await f.button('Loadouts').click()
    await f.button(/HARRIER-12/).click()
    await f.button('Glacier').click()
    await f.button(/Confirm loadout/).click()
    await f.chooseMode('Battle Royale')
    await f.button('Deploy now').click()
    await f.ready()
    await f.value('hud-flight-label', 'Floodline')
    await page.keyboard.press('m')
    const chart = page.getByRole('dialog', { name: 'Tactical Map' })
    await chart.getByText('Floodline', { exact: true }).waitFor()
    await chart.getByText('FIELD STAFF', { exact: true }).waitFor()
    await f.screenshot('floodline-chart')
    await chart.getByRole('button', { name: 'Close panel' }).click()
    await f.loadedModel('harrier')
    await page.keyboard.press('Space')
    await f.value('hud-flight-label', 'Freefall')
    await page.locator('#hud-flight-alt').waitFor({ state: 'visible' })
    await page.keyboard.press('Space')
    await f.value('hud-flight-label', 'Parachute open')
    await page.keyboard.down('ArrowDown')
    try {
      await page.waitForFunction(
        () =>
          parseInt(document.getElementById('hud-flight-alt')?.textContent, 10) <
          108,
      )
    } finally {
      await page.keyboard.up('ArrowDown')
    }
    await f.screenshot('floodline-descent')
    // Crouch is held input: a same-millisecond tap can fall between frames on
    // software rendering. Release it as soon as the chute actually cuts.
    await page.keyboard.down('c')
    try {
      await f.value('hud-flight-label', 'Freefall')
    } finally {
      await page.keyboard.up('c')
    }
    await page.locator('#game.on-ground').waitFor({ state: 'visible' })
    await f.value('hud-weapon-name', 'HARRIER-12')
    await f.value('hud-mag', '07')
    await f.screenshot('floodline-ground')
    await f.graphics()
    console.log(
      'Field Command: persistent map and difficulty, all gear available, real Mistral burst, Floodline map, aircraft jump, chute, landing, Harrier equipped, WebGL',
    )
  } finally {
    if (f.errors.length) console.error(f.errors)
    await page.close()
  }
}

async function touch(browser) {
  const page = await browser.newPage({
    baseURL: url,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  })
  const f = new FieldProbe(page)
  try {
    await page.goto('/')
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
      0,
    )
    await f.button('Mission setup').tap()
    const mobileSetup = page.getByRole('dialog', { name: 'Mission Setup' })
    await mobileSetup
      .getByRole('button', { name: 'Recruit', exact: true })
      .tap()
    await mobileSetup.getByRole('button', { name: /^Done/ }).tap()
    await f.value('selected-difficulty', 'RECRUIT NPCS')
    await f.button('Training Range').tap()
    await f.button('Enter range').tap()
    await f.ready()
    await f.button('Swap').tap()
    await f.value('hud-weapon-name', 'SPECTRE-8')
    const { x, y, width, height } = await f.button('Armor').boundingBox()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x + width / 2, y: y + height / 2 }],
    })
    try {
      await page.waitForFunction(
        () =>
          Number(
            document.getElementById('hud-armor')?.getAttribute('aria-valuenow'),
          ) >= 100,
      )
    } finally {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
    }
    await f.screenshot('touch-field')
    await f.graphics()
    console.log(
      'Mobile emulation: same launcher, no horizontal overflow, touch swap and hold-to-plate',
    )
  } finally {
    if (f.errors.length) console.error(f.errors)
    await page.close()
  }
}

async function online(browser) {
  const context = await browser.newContext({
    baseURL: url,
    viewport: { width: 800, height: 550 },
  })
  const hostPage = await context.newPage(),
    guestPage = await context.newPage()
  const host = new FieldProbe(hostPage),
    guest = new FieldProbe(guestPage)
  try {
    await context.addInitScript(() =>
      localStorage.setItem('ndx-settings', JSON.stringify({ quality: 'low' })),
    )
    await hostPage.goto('/')
    await host.chooseMode('Private Match')
    await host.button('Open lobby').click()
    await hostPage
      .getByLabel('Game mode', { exact: true })
      .selectOption('garrison')
    await hostPage
      .getByLabel('Battlefield', { exact: true })
      .selectOption('relay-works')
    await hostPage
      .getByLabel('NPC difficulty', { exact: true })
      .selectOption('elite')
    await host.button('Create room').click()
    await hostPage
      .getByText('Domination · Teams · Bot fill enabled', { exact: true })
      .waitFor()
    const code = await hostPage.locator('.room-banner b').textContent()
    assert.match(code, /^[A-Z2-9]{5}$/)
    await guestPage.goto(`/?room=${code}`)
    await guest.button('Join room').click()
    await hostPage.waitForFunction(
      () => document.querySelectorAll('.roster li').length === 2,
    )
    await guestPage
      .locator('.lobby-operation')
      .getByText('Relay Works', { exact: true })
      .waitFor()
    await guestPage
      .locator('.lobby-operation')
      .getByText('Elite NPCs', { exact: true })
      .waitFor()
    await host.button('Start match').click()
    await Promise.all([host.ready(), guest.ready()])
    await guestPage.waitForFunction(
      () => document.querySelectorAll('.relay-chip').length === 3,
    )
    for (const p of [hostPage, guestPage])
      assert.equal(
        await p.locator('.map-header b').textContent(),
        'RELAY WORKS',
      )
    await guestPage.keyboard.press('2')
    await guest.value('hud-weapon-name', 'SPECTRE-8')
    await guestPage.keyboard.press('p')
    assert.match(
      await guestPage
        .getByRole('dialog', { name: 'Operation Paused' })
        .textContent(),
      /online operation continues[\s\S]*Relay Works \/ ELITE NPC RULES/i,
    )
    await guest.graphics()
    console.log(
      'Live: host and guest deployed to the same Relay Works room with Elite NPCs, shared relays, and authoritative sidearm swap',
    )
  } finally {
    if (host.errors.length || guest.errors.length)
      console.error(host.errors, guest.errors)
    await context.close()
  }
}

const suites = { desktop, field: fieldCommand, touch, online }
const requested = process.argv.slice(2)
const selected = requested.length ? requested : Object.keys(suites)
if (selected.some((name) => !Object.hasOwn(suites, name)))
  throw new Error('Browser suites: desktop, field, touch, online')
const browser = await chromium.launch({
  executablePath,
  args: launchArgs,
  headless: true,
})
try {
  for (const name of selected) {
    if (name === 'online' && process.env.NDX_SKIP_ONLINE === '1') continue
    await suites[name](browser)
  }
} finally {
  await browser.close()
}
