import { MODES, MODE } from './config.js'
import { MAPS } from './game/map-catalog.js'
import { CATALOG, RARITIES, cosmetic } from './game/cosmetics.js'
import { icon } from './icons.js'
import { escape as e } from './markup.js'
import { LIVE_ROOMS } from './site.js'

const number = (value) => Number(value ?? 0).toLocaleString('en-US')
const shortDate = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
const historyName = (entry) =>
  `${MODE[entry.mode]?.name ?? entry.mode} · ${MAPS[entry.map]?.name ?? entry.map}`
const navButton = (tab, text, selected = false) =>
  `<button type="button" class="career-tab${selected ? ' selected' : ''}" data-career="${tab}" aria-pressed="${selected}">${text}</button>`
const button = (key, text, kind = 'secondary', id = '') =>
  `<button type="button" class="btn ${kind}" data-career="${key}" ${id ? `data-id="${e(id)}"` : ''}>${text}</button>`
const input = (name, label, props = 'required') =>
  `<label>${label}<input name="${name}" ${props}></label>`
const fieldset = (fields) => `<div class="career-fields">${fields}</div>`
const submit = (text) =>
  `<div class="panel-cta"><button class="btn primary" type="submit">${text} ${icon('arrow', 15)}</button></div>`
const opt = (value, text, selected = '') =>
  `<option value="${e(value)}" ${selected === value ? 'selected' : ''}>${e(text)}</option>`
const select = (name, label, options) =>
  `<label>${label}<select name="${name}">${options}</select></label>`
const userField = () =>
  input(
    'username',
    'Username',
    'required maxlength="16" autocomplete="username" spellcheck="false"',
  )
const pwd = (
  kind = 'current-password',
  name = 'password',
  label = 'Password',
) =>
  input(
    name,
    label,
    `required type="password" maxlength="128" autocomplete="${kind}"`,
  )
const feedback = `<p class="career-feedback" data-career-feedback aria-live="polite" hidden></p>`
const preview = `<div class="model-preview" data-model-preview><span class="mono" data-preview-status role="status">Loading 3D model…</span></div>`
const searchable = CATALOG.map(({ id, target, name }) => [
  id,
  `${name} / ${target}`,
])
const modeOptions = MODES.filter(
  (mode) => mode.teams.length && mode.map !== 'range',
).map((mode) => [mode.id, mode.name])
const selectList = (name, label, items, current) =>
  select(name, label, items.map(([v, t]) => opt(v, t, current)).join(''))
const challengeRows = (challenges) =>
  challenges
    .map(
      (c) =>
        `<div class="career-row challenge-row"><div><small class="eyebrow">${c.id.startsWith('daily') ? 'DAILY' : 'WEEKLY'} · RESETS ${e(shortDate(c.reset))}</small><strong>${e(c.label)}</strong><progress value="${Math.min(c.progress, c.goal)}" max="${c.goal}" aria-label="${e(c.label)}"></progress></div><div><b>${Math.min(c.progress, c.goal)}/${c.goal}</b><small> +${c.reward} CR</small>${c.claimed ? '<small class="eyebrow"> CLAIMED</small>' : c.progress >= c.goal ? button('claim', 'Claim', 'primary', c.id) : ''}</div></div>`,
    )
    .join('')

export class CareerUI {
  account = null
  live = { announcement: '', event: null, disabled: [] }
  rooms = {}
  ready = false
  available = false
  version = 0
  busy = false
  current = null
  previewNonce = 0
  constructor({ panel, show, change, notify }) {
    Object.assign(this, { panel, show, change, notify })
    this.store = {
      kind: 'finish',
      rarity: 'all',
      owned: false,
      query: '',
      page: 0,
      chosen: null,
    }
    panel.addEventListener('click', (ev) => {
      const target = ev.target.closest('button[data-career]')
      if (!target || this.busy) return
      this.click(target.dataset.career, target.dataset.id)
    })
    panel.addEventListener('submit', (ev) => {
      const route = ev.target.dataset.careerForm
      if (!route) return
      ev.preventDefault()
      if (!this.busy) this.submit(route, ev.target)
    })
    panel.addEventListener('change', (ev) => {
      if (!ev.target.matches('[data-catalog-filter]')) return
      const { name, value, checked } = ev.target
      this.store[name] = name === 'owned' ? checked : value
      this.store.page = 0
      this.catalog()
      this.panel.querySelector(`[name="${name}"]`)?.focus()
    })
    panel.addEventListener('close', () => {
      if (!panel.open) this.resetPanel()
    })
  }
  resetPanel() {
    this.current = null
    this.stopPreview()
  }
  stopPreview() {
    this.stopModel?.()
    this.stopModel = null
    this.previewNonce++
  }
  async inspect(host, model) {
    this.stopPreview()
    const nonce = this.previewNonce
    try {
      const { mountShowcase } = await import('./showcase.js')
      if (nonce === this.previewNonce && host?.isConnected)
        this.stopModel = mountShowcase(host, model)
    } catch {
      if (host?.isConnected)
        host.querySelector('[data-preview-status]').textContent =
          '3D inspection is unavailable.'
    }
  }
  async get(path, body) {
    const response = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      ...(body
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    })
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error(
        'The career server is unavailable. Practice is still playable.',
      )
    const data = await response.json()
    if (!response.ok) {
      const error = new Error(data.error ?? 'Could not complete this request.')
      error.status = response.status
      throw error
    }
    return data
  }
  apply(data) {
    if (Object.hasOwn(data, 'account')) this.account = data.account
    if (data.live) this.live = data.live
    if (data.rooms) this.rooms = data.rooms
    this.change(this.account, this.live, this.rooms)
  }
  async refresh({ quiet = true } = {}) {
    if (!LIVE_ROOMS || this.busy) return
    const version = ++this.version
    try {
      const data = await this.get('session')
      if (version !== this.version) return
      this.ready = this.available = true
      this.apply(data)
    } catch (error) {
      if (version !== this.version) return
      this.ready = true
      this.available = false
      this.change(this.account, this.live, this.rooms)
      if (!quiet) this.notify(error.message)
    }
  }
  showTab(key, title, body, kicker = 'CAREER / NDX COMBAT') {
    this.show(key, title, body, kicker)
    this.current = key
  }
  message(text, bad = false) {
    const node = this.panel.querySelector('[data-career-feedback]')
    if (!node) return
    node.textContent = text
    node.hidden = !text
    node.dataset.error = String(bad)
  }
  renderAuth(tab = 'login', reason = '') {
    const name = {
      login: 'Sign in',
      register: 'Create account',
      recover: 'Recover account',
      password: 'Change password',
    }[tab]
    const rotate = this.account?.mustRotate
    let fields = ''
    let tabs = ''
    if (tab === 'password') {
      fields =
        pwd('current-password', 'current', 'Current password') +
        pwd('new-password', 'password', 'New password')
    } else {
      fields =
        userField() +
        (tab === 'recover'
          ? input(
              'recovery',
              'Recovery code',
              'required minlength="43" maxlength="43" autocomplete="off" spellcheck="false"',
            )
          : '') +
        pwd(tab === 'login' ? 'current-password' : 'new-password')
      tabs = `<nav class="career-tabs" aria-label="Account action">${navButton('login', 'Sign in', tab === 'login')}${navButton('register', 'Create account', tab === 'register')}${navButton('recover', 'Recover', tab === 'recover')}</nav>`
    }
    this.showTab(
      'profile',
      name,
      `<div class="signin-card">${tabs}<p>${e(reason || (rotate ? 'Set a new password before you can deploy online or open the owner console.' : tab === 'recover' ? 'Enter the one-time recovery code saved when you created the account.' : tab === 'register' ? 'Start at rank 1 with 300 credits. Use at least 12 characters for your password.' : 'Sign in to keep your match progress and gear across devices. Local practice does not require an account.'))}</p><form data-career-form="${tab}">${fieldset(fields)}${feedback}${submit(name)}</form>${rotate ? `<div class="panel-cta">${button('logout', 'Sign out')}</div>` : ''}</div>`,
      'IDENTITY / SECURE LINK',
    )
  }
  recovery(code) {
    this.showTab(
      'profile',
      'Save your recovery code',
      `<p>This code is shown once. Store it somewhere private before continuing. It can reset your password and will be replaced when used or after a password change.</p><div class="recovery-box"><code>${e(code)}</code></div><div class="panel-cta">${button('profile', 'I saved the code', 'primary')}</div>`,
      'IDENTITY / SECURE LINK',
    )
  }
  async profile() {
    if (!this.account) {
      this.renderAuth()
      return
    }
    if (this.account.mustRotate) {
      this.renderAuth('password')
      return
    }
    await this.loadTab('profile', 'Service record', 'career', (d) => {
      this.apply(d)
      const a = this.account,
        stats = a.stats
      return `<div class="account-banner"><div><small class="eyebrow">${e(a.badge ?? 'REGISTERED OPERATOR')}</small><h3>${e(a.callsign)}</h3><span class="mono">@${e(a.username)}</span></div><strong>RANK ${a.rank}</strong></div>
      <div class="career-metrics"><span><b>${number(a.xp)}</b><small>CAREER XP</small></span><span><b>${a.unlimited ? '∞' : number(a.credits)}</b><small>CREDITS</small></span><span><b>${number(stats.wins)}</b><small>WINS</small></span><span><b>${number(stats.kills)}</b><small>ELIMINATIONS</small></span></div>
      <p>Only completed public matchmaking rounds award career progress. Local drills and private rooms are unranked.</p>
      <section class="career-section"><h3>Achievements</h3><div class="earned-chips">${a.achievements.length ? a.achievements.map((x) => `<span>${icon('trophy', 15)} ${e(x.name)}</span>`).join('') : '<small>Complete a public operation to earn your first achievement.</small>'}</div></section>
      <section class="career-section"><h3>Recent operations</h3>${d.history.length ? d.history.map((r) => `<div class="career-row"><div><strong>${e(historyName(r))}</strong><small>${e(shortDate(r.finished))} · ${r.kills} E / ${r.deaths} D</small></div><div><b>${r.won ? 'VICTORY' : 'COMPLETE'}</b><small>+${r.xp} XP / +${r.credits} CR</small></div></div>`).join('') : '<p>No completed public matches yet.</p>'}</section>
      <section class="career-section"><h3>Operator identity</h3><form data-career-form="profile">${fieldset(input('callsign', 'Display callsign', `maxlength="20" minlength="2" required value="${e(a.callsign)}"`))}${submit('Save callsign')}</form>${feedback}<div class="panel-cta">${button('local-dossier', 'Local practice record')}${a.role !== 'owner' ? button('rename', 'Change username') : ''}${button('password', 'Change password')}${button('logout', 'Sign out')}</div></section>`
    })
  }
  rename() {
    this.showTab(
      'profile',
      'Change username',
      `<p>Your new username is used for sign-in. Your callsign, inventory, and records stay the same.</p><form data-career-form="rename">${fieldset(userField() + pwd())}${feedback}${submit('Save username')}</form>`,
      'IDENTITY / SECURE LINK',
    )
  }
  async loadTab(key, title, url, body) {
    this.showTab(
      key,
      title,
      `<div class="career-loading" role="status">Contacting the combat network…</div>${feedback}`,
    )
    const anchor = this.panel.querySelector('.career-loading')
    try {
      const data = await this.get(url)
      if (!this.panel.open || !anchor.isConnected) return
      this.showTab(key, title, body(data))
    } catch (error) {
      if (!this.panel.open || !anchor.isConnected) return
      anchor.remove()
      this.message(error.message, true)
    }
  }
  async events() {
    if (!this.account) {
      this.renderAuth('login', 'Sign in to track daily and weekly challenges.')
      return
    }
    if (this.account.mustRotate) {
      this.renderAuth('password')
      return
    }
    await this.loadTab('events', 'Events & challenges', 'career', (d) => {
      this.apply(d)
      const event = d.live.event
      return `<div class="account-banner"><div><small class="eyebrow">LIVE EVENTS / UTC</small><h3>${e(event?.label ?? 'Field challenges')}</h3><p>${event ? `${event.multiplier}× career XP through ${e(shortDate(event.until))}` : 'Daily and weekly challenges reset on a UTC schedule.'}</p></div></div>
      ${d.live.announcement ? `<blockquote>${e(d.live.announcement)}</blockquote>` : ''}
      <section class="career-section"><h3>Earn credits</h3>${challengeRows(d.challenges)}</section>${feedback}`
    })
  }
  leaders() {
    return this.loadTab(
      'leaders',
      'Leaderboards',
      'leaders',
      (d) =>
        `<p>Top 25 ranked players by career XP. Guest operators, NPCs and the owner are not ranked.</p><section class="career-section">${d.players.length ? d.players.map((p, i) => `<div class="career-row leaderboard-row"><b class="mono">#${String(i + 1).padStart(2, '0')}</b><div><strong>${e(p.callsign)}</strong><small>@${e(p.username)} · ${p.wins} W / ${p.matches} rounds</small></div><div><b>${number(p.xp)} XP</b><small>RANK ${p.rank}</small></div></div>`).join('') : '<p>No ranked results yet. Complete a public match to enter the standings.</p>'}</section>`,
    )
  }
  catalog(kind, from) {
    if (!LIVE_ROOMS) return
    if (kind) {
      this.store.kind = kind
      this.store.page = 0
      this.store.chosen = null
    }
    if (from) this.store.from = from
    const { rarity, owned, query } = this.store,
      a = this.account
    const hidden = new Set(this.live.hiddenItems ?? []),
      inventory = new Set(a?.inventory ?? [])
    const state = this.store
    const match = CATALOG.filter(
      (c) =>
        c.kind === state.kind &&
        (rarity === 'all' || c.rarity === Number(rarity)) &&
        (!owned || inventory.has(c.id)) &&
        (!hidden.has(c.id) || inventory.has(c.id) || a?.role === 'owner') &&
        `${c.name} ${c.target}`.toLowerCase().includes(query.toLowerCase()),
    )
    const pages = Math.max(1, Math.ceil(match.length / 12))
    state.page = Math.max(0, Math.min(pages - 1, state.page))
    const slice = match.slice(state.page * 12, state.page * 12 + 12)
    const item = slice.find((x) => x.id === state.chosen) ?? slice[0]
    state.chosen = item?.id
    const chosenOwned = inventory.has(item?.id)
    const equipped =
      chosenOwned &&
      [a?.loadout.operator, a?.loadout.finish, a?.loadout.sideFinish].includes(
        item?.id,
      )
    this.showTab(
      state.from === 'operators' ? 'operators' : 'store',
      state.from === 'operators' ? 'Operator Locker' : 'Cosmetics Store',
      `<div class="store-header"><p>Cosmetics only. Earn credits by playing public matches and completing challenges.</p><b class="credits-pill">${icon('cash', 17)} ${a?.unlimited ? 'UNLIMITED' : a ? `${number(a.credits)} CR` : 'GUEST'}</b></div>
      <nav class="career-tabs" aria-label="Cosmetic type">${navButton('finishes', 'Weapon finishes', state.kind === 'finish')}${navButton('outfits', 'Operator outfits', state.kind === 'outfit')}</nav>
      <form class="catalog-filters" data-career-form="filter"><label>Find a cosmetic<input type="search" name="query" value="${e(query)}" maxlength="40" placeholder="Search by theme or weapon"></label><label>Rarity<select name="rarity" data-catalog-filter>${opt('all', 'All rarities', rarity)}${RARITIES.map((r, i) => opt(String(i), r.name, rarity)).join('')}</select></label>${a ? `<label class="catalog-check"><input type="checkbox" data-catalog-filter name="owned" ${owned ? 'checked' : ''}> Owned</label>` : ''}<button class="btn secondary" type="submit">Search</button></form>
      <div class="store-layout"><div><div class="cosmetic-grid">${slice.map((c) => `<button type="button" class="cosmetic-tile" data-career="inspect" data-id="${c.id}" aria-pressed="${item.id === c.id}" style="--rare:${RARITIES[c.rarity].color};--skin:${c.body};--accent:${c.trim}"><i></i><span><small>${RARITIES[c.rarity].name}</small><b>${c.name}</b><em>${c.target}${inventory.has(c.id) ? ' · OWNED' : ''}</em></span></button>`).join('') || '<p>No items match these filters.</p>'}</div><div class="catalog-pages">${state.page > 0 ? button('prev', 'Previous') : ''}<small>${match.length} items · ${state.page + 1} / ${pages}</small>${state.page + 1 < pages ? button('next', 'Next') : ''}</div></div>
      ${item ? `<section class="cosmetic-detail" style="--rare:${RARITIES[item.rarity].color}">${preview}<div class="cosmetic-copy"><small class="eyebrow">${RARITIES[item.rarity].name} / ${item.target}</small><h3>${item.name}</h3><p>${item.effect === 'pulse' && item.kind === 'finish' ? 'Animated emissive accents. ' : ''}${item.kind === 'outfit' ? 'Material recolor on the animated ' + item.target + ' rig.' : 'Only fits the ' + item.target + '.'}</p>${feedback}<div class="panel-cta">${a ? (chosenOwned ? (equipped ? '<small class="earned-chips">EQUIPPED</small>' : button('equip', 'Equip', 'primary', item.id)) : a.mustRotate ? button('password', 'Change password', 'primary') : a.rank < item.rank ? `<span class="eyebrow">UNLOCKS AT RANK ${item.rank}</span>` : button('buy', `Unlock · ${item.price} CR`, 'primary', item.id)) : button('login', 'Sign in to unlock', 'primary')}</div></div></section>` : ''}</div>`,
      'ARMORY / EARNED COLLECTIONS',
    )
    if (item)
      this.inspect(this.panel.querySelector('[data-model-preview]'), {
        kind: item.kind === 'outfit' ? 'operator' : 'weapon',
        id: item.model ?? item.weapon,
        style: item.id,
      })
  }
  async owner(query = '', offset = 0) {
    if (this.account?.role !== 'owner') {
      this.notify('Owner access required.')
      return
    }
    if (this.account.mustRotate) {
      this.renderAuth('password')
      return
    }
    this.ownerSearch = query
    this.ownerOffset = offset
    return this.loadTab(
      'owner',
      'Owner console',
      `owner?q=${encodeURIComponent(query)}&offset=${offset}`,
      (d) => {
        this.apply(d)
        return `<div class="account-banner owner-banner"><div><small class="eyebrow">NDX / OWNER</small><h3>Network command</h3></div><strong>RANK 100 · ∞ CR</strong></div>
      <div class="career-metrics"><span><b>${number(d.totals.accounts)}</b><small>ACCOUNTS</small></span><span><b>${number(d.totals.completed)}</b><small>RANKED ROUNDS</small></span><span><b>${number(d.rooms.humans)}</b><small>LIVE HUMANS</small></span><span><b>${number(d.rooms.bots)}</b><small>LIVE NPCS</small></span></div><p>${number(d.rooms.active)} active rooms · ${number(d.rooms.queued)} waiting lobbies</p>${feedback}
      <section class="career-section"><h3>Player administration</h3><form class="owner-search" data-career-form="owner-search">${input('q', 'Search usernames', `maxlength="24" value="${e(query)}"`)}<button type="submit" class="btn secondary">Search</button></form>
      ${d.users.length ? d.users.map((u) => `<div class="career-row"><div><strong>@${e(u.username)}</strong><small>${u.role === 'owner' ? 'OWNER' : u.suspended ? 'SUSPENDED' : 'ACTIVE'} · ${u.xp} XP · ${u.matches} rounds</small></div>${u.role !== 'owner' ? button(u.suspended ? 'unsuspend' : 'suspend', u.suspended ? 'Restore account' : 'Suspend account', 'secondary', u.username) : ''}</div>`).join('') : '<p>No matching accounts.</p>'}
      <div class="catalog-pages">${offset > 0 ? button('owner-prev', 'Previous') : ''}${d.users.length === 25 ? button('owner-next', 'Next') : ''}</div>
      <div class="owner-forms"><form data-career-form="progress"><h4>Set player progression</h4>${fieldset(userField() + input('xp', 'XP', 'type="number" min="0" max="29700" required') + input('credits', 'Credits', 'type="number" min="0" max="1000000" required'))}${submit('Save progression')}</form><form data-career-form="grant"><h4>Grant a cosmetic</h4>${fieldset(userField() + selectList('item', 'Cosmetic', searchable))}${submit('Grant item')}</form></div></section>
      <section class="career-section"><h3>Moderation queue</h3>${d.reports.length ? d.reports.map((r) => `<div class="report-card"><div><small class="eyebrow">#${r.id} · ${e(r.status)}</small><strong>@${e(r.reporter)} reported @${e(r.target)}</strong><p>${e(r.reason)}</p></div>${r.status === 'open' ? `<div class="panel-cta">${button('review', 'Mark reviewed', 'secondary', r.id)}${button('dismiss', 'Dismiss', 'secondary', r.id)}</div>` : ''}</div>`).join('') : '<p>No reports submitted.</p>'}</section>
      <section class="career-section"><h3>Live operations</h3><div class="owner-forms">
      <form data-career-form="announcement"><h4>Launcher bulletin</h4>${fieldset(input('text', 'Announcement (blank clears)', `maxlength="210" value="${e(d.live.announcement)}"`))}${submit('Publish bulletin')}</form>
      <form data-career-form="event"><h4>XP event</h4><p>${d.live.event ? `${e(d.live.event.label)} · ${d.live.event.multiplier}× through ${e(shortDate(d.live.event.until))}` : 'No active XP event.'}</p>${fieldset(
        input('label', 'Name', 'maxlength="42"') +
          input(
            'hours',
            'Hours (0 stops event)',
            'type="number" min="0" max="168" value="24" required',
          ) +
          selectList('multiplier', 'Multiplier', [
            ['1.5', '1.5× XP'],
            ['2', '2× XP'],
          ]),
      )}${submit('Update event')}</form>
      <form data-career-form="playlist"><h4>Online playlists</h4>${fieldset(
        selectList(
          'mode',
          'Playlist',
          modeOptions.map(([v, t]) => [
            v,
            `${t}${d.live.disabled.includes(v) ? ' (closed)' : ''}`,
          ]),
        ) +
          selectList('enabled', 'Availability', [
            ['1', 'Open'],
            ['0', 'Closed'],
          ]),
      )}${submit('Apply playlist rules')}</form>
      <form data-career-form="catalog"><h4>Cosmetic storefront</h4>${fieldset(
        selectList(
          'item',
          'Cosmetic',
          searchable.map(([v, t]) => [
            v,
            `${t}${d.live.hiddenItems?.includes(v) ? ' (hidden)' : ''}`,
          ]),
        ) +
          selectList('enabled', 'Availability', [
            ['1', 'Listed'],
            ['0', 'Hidden'],
          ]),
      )}${submit('Apply listing')}</form></div></section>
      <section class="career-section"><h3>Owner audit</h3>${d.audit.length ? d.audit.map((x) => `<div class="career-row"><strong>${e(x.action)} / ${e(x.detail)}</strong><small>${e(shortDate(x.created))}</small></div>`).join('') : '<p>No management changes yet.</p>'}</section>`
      },
    )
  }
  multiplayer() {
    this.showTab(
      'multiplayer',
      'Multiplayer',
      `<div class="account-banner"><div><small class="eyebrow">LIVE NETWORK</small><h3>${this.available ? 'Find an operation' : 'Network link'}</h3><p>${this.ready && !this.available ? 'Live rooms are unavailable right now. Local modes still work.' : this.account ? 'Your online career is linked to this account.' : 'You can join rooms as a guest. Sign in to earn career rewards.'}</p></div></div><div class="career-metrics"><span><b>${number(this.rooms.humans)}</b><small>LIVE HUMANS</small></span><span><b>${number(this.rooms.bots)}</b><small>LIVE NPCS</small></span><span><b>${number(this.rooms.active)}</b><small>ACTIVE ROOMS</small></span></div><div class="panel-cta"><button class="btn secondary" type="button" data-action="private">Host / join private</button><button class="btn primary" type="button" data-action="enable-online">Enable public matchmaking</button></div>${this.account && !this.account.mustRotate ? `<section class="career-section"><h3>Report an operator</h3><form data-career-form="report">${fieldset(userField() + `<label>Reason<textarea name="reason" minlength="12" maxlength="300" required></textarea></label>`)}${feedback}${submit('Send report')}</form></section>` : feedback}`,
      'MATCH CONTROL / LIVE ROOMS',
    )
  }
  async perform(path, body, fn) {
    if (this.busy) return
    this.busy = true
    this.version++
    const marker = this.panel.querySelector('.panel-body')
    marker?.setAttribute('aria-busy', 'true')
    try {
      const data = await this.get(path, body)
      this.apply(data)
      if (marker?.isConnected && this.panel.open) await fn?.(data)
    } catch (error) {
      if (
        error.status === 401 &&
        !['login', 'recover', 'password', 'rename'].includes(path)
      ) {
        this.apply({ account: null })
      }
      if (marker?.isConnected && this.panel.open)
        this.message(error.message, true)
      else this.notify(error.message)
    } finally {
      marker?.removeAttribute('aria-busy')
      this.busy = false
    }
  }
  submit(route, form) {
    const data = Object.fromEntries(new FormData(form))
    if (route === 'filter') {
      this.store.query = data.query.trim()
      this.store.page = 0
      this.catalog()
      return
    }
    if (route === 'owner-search') {
      this.owner(data.q)
      return
    }
    if (
      [
        'login',
        'register',
        'recover',
        'password',
        'rename',
        'profile',
        'report',
      ].includes(route)
    ) {
      this.perform(route, data, (result) => {
        if (result.recovery) return this.recovery(result.recovery)
        if (result.account?.mustRotate) return this.renderAuth('password')
        if (route === 'report') {
          form.reset()
          return this.message('Report sent to the moderation queue.')
        }
        if (route === 'profile') {
          this.message('Callsign saved.')
          return
        }
        this.profile()
      })
      return
    }
    if (route === 'progress')
      Object.assign(data, {
        xp: Number(data.xp),
        credits: Number(data.credits),
      })
    if (route === 'event')
      Object.assign(data, {
        hours: Number(data.hours),
        multiplier: Number(data.multiplier),
      })
    if (['playlist', 'catalog'].includes(route))
      data.enabled = data.enabled === '1'
    this.perform('owner', { ...data, action: route }, () => {
      this.notify('Network configuration updated.')
      this.owner(this.ownerSearch, this.ownerOffset)
    })
  }
  click(action, id) {
    if (['login', 'register', 'recover', 'password'].includes(action))
      return this.renderAuth(action)
    if (action === 'profile') return this.profile()
    if (action === 'rename') return this.rename()
    if (action === 'local-dossier') {
      this.resetPanel()
      this.panel.dispatchEvent(new CustomEvent('local-dossier'))
      return
    }
    if (action === 'logout')
      return this.perform('logout', {}, () =>
        this.renderAuth(
          'login',
          'You are signed out. Practice and guest rooms remain available.',
        ),
      )
    if (action === 'finishes' || action === 'outfits')
      return this.catalog(action === 'finishes' ? 'finish' : 'outfit')
    if (action === 'inspect') {
      this.store.chosen = id
      return this.catalog()
    }
    if (action === 'prev' || action === 'next') {
      this.store.page += action === 'prev' ? -1 : 1
      return this.catalog()
    }
    if (action === 'owner-prev' || action === 'owner-next')
      return this.owner(
        this.ownerSearch,
        Math.max(0, this.ownerOffset + (action === 'owner-prev' ? -25 : 25)),
      )
    if (['buy', 'equip'].includes(action) && cosmetic(id)) {
      return this.perform(action, { item: id }, () => {
        this.catalog()
        this.message(
          action === 'buy'
            ? 'Unlocked and added to your inventory.'
            : 'Equipped and saved to your account.',
        )
      })
    }
    if (action === 'claim')
      return this.perform('claim', { id }, () => {
        this.notify('Challenge reward collected.')
        this.events()
      })
    if (['review', 'dismiss', 'suspend', 'unsuspend'].includes(action)) {
      const payload =
        action === 'review' || action === 'dismiss'
          ? {
              action: 'moderate',
              report: Number(id),
              status: action === 'review' ? 'reviewed' : 'dismissed',
            }
          : { action: 'suspend', username: id, suspended: action === 'suspend' }
      return this.perform('owner', payload, () => {
        this.notify('Moderation action saved.')
        this.owner(this.ownerSearch, this.ownerOffset)
      })
    }
  }
}
