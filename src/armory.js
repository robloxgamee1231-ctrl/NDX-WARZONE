import { WEAPONS } from './config.js'
import { icon, weaponArt } from './icons.js'
import {
  ATTACHMENT_SLOTS,
  FINISHES,
  OPERATORS,
  PRIMARY_IDS,
  SIDEARM,
  TACTICALS,
  resolveWeapon,
} from './game/loadout.js'

function group(title, body) {
  return `<section class="armory-section"><h3 class="panel-subtitle">${title}</h3>${body}</section>`
}

function stat(label, value, delta) {
  return `<span><small>${label}</small><b>${value}</b>${delta ? `<em>${delta}</em>` : ''}</span>`
}

export function statsFor(weapon, attachments) {
  const selected = resolveWeapon(weapon, attachments)
  const base = WEAPONS[weapon]
  const diff = (a, b, type) => {
    if (Math.abs(a - b) < 0.001) return ''
    const n = Math.round((a / b - 1) * 100)
    return `${n >= 0 ? '+' : ''}${n}% ${type}`
  }
  return `<div class="armory-stats" aria-live="polite">
    ${stat('MAGAZINE', selected.mag, diff(selected.mag, base.mag, 'CAP'))}
    ${stat('RELOAD', `${selected.reload.toFixed(2)}s`, diff(selected.reload, base.reload, 'TIME'))}
    ${stat('MOVE', `${Math.round(selected.speed * 100)}%`, diff(selected.speed, base.speed, 'SPEED'))}
    ${stat('RECOIL', `${Math.round((selected.kick / base.kick) * 100)}%`, diff(selected.kick, base.kick, 'KICK'))}
  </div>`
}

function weapons(primary) {
  return `<div class="loadout-list arsenal-grid" role="group" aria-label="Primary weapon">${PRIMARY_IDS.map(
    (id) => {
      const w = WEAPONS[id]
      return `<button type="button" class="loadout-item" data-weapon="${id}" aria-pressed="${id === primary}"><span><span class="eyebrow">${w.type}${id === primary ? ' / EQUIPPED' : ''}</span><strong>${w.name}</strong><small>${w.description}</small></span>${weaponArt(id)}</button>`
    },
  ).join('')}</div>`
}

function attachments(active) {
  return `<div class="armory-attachments">${ATTACHMENT_SLOTS.map((slot) => {
    const choice =
      slot.choices.find((o) => o.id === active[slot.id]) ?? slot.choices[0]
    return `<label class="attachment-card"><span>${slot.name}</span><select data-attachment="${slot.id}" aria-label="${slot.name}">${slot.choices.map((o) => `<option value="${o.id}" ${o.id === choice.id ? 'selected' : ''}>${o.name}</option>`).join('')}</select><small data-attachment-detail="${slot.id}">${choice.detail}</small></label>`
  }).join('')}</div>`
}

function equipment(items, active, field, label) {
  return `<div class="armory-choices" role="group" aria-label="${label}">${Object.values(
    items,
  )
    .map(
      (entry) =>
        `<button type="button" class="armory-choice" data-kit="${field}" data-value="${entry.id}" aria-pressed="${entry.id === active}"><span class="eyebrow">${entry.swatch ? `<i class="operator-dye" style="--dye:${entry.swatch}"></i>` : icon(entry.icon ?? 'person', 14)} ${entry.count ? `${entry.count} CHARGE${entry.count > 1 ? 'S' : ''}` : 'OPERATOR SKIN'}</span><strong>${entry.name}</strong><small>${entry.desc}</small></button>`,
    )
    .join('')}</div>`
}

function finishes(finish) {
  return `<div class="finish-grid" role="group" aria-label="Weapon finish">${Object.values(
    FINISHES,
  )
    .map(
      (skin) =>
        `<button type="button" class="finish-choice" data-kit="finish" data-value="${skin.id}" aria-pressed="${skin.id === finish}"><span class="finish-swatch" style="--skin:${skin.body};--accent:${skin.trim}"></span><strong>${skin.name}</strong></button>`,
    )
    .join(
      '',
    )}</div><p class="cosmetic-note">Applies to both equipped weapons. Finish and operator skins are cosmetic.</p>`
}

export function armoryBody(loadout) {
  return `<div class="armory-unlocked"><span>${icon('check', 19)} <strong>All gear unlocked</strong></span><small class="mono">${PRIMARY_IDS.length + 1} WEAPONS / ${Object.keys(FINISHES).length} FINISHES / ${Object.keys(OPERATORS).length - 1} OPERATOR SKINS</small></div><p>Choose your primary, attachments, skin, and gear. Nothing to unlock or purchase. Your backup is the ${WEAPONS[SIDEARM].name}.</p>
    ${group('01 / PRIMARY PLATFORM', weapons(loadout.primary))}
    ${group('02 / GUNSMITH', `${attachments(loadout.attachments)}<div id="armory-stats">${statsFor(loadout.primary, loadout.attachments)}</div>`)}
    ${group('03 / WEAPON FINISH', finishes(loadout.finish))}
    ${group('04 / TACTICAL EQUIPMENT', equipment(TACTICALS, loadout.tactical, 'tactical', 'Tactical equipment'))}
    ${group('05 / FIELD OPERATOR', equipment(OPERATORS, loadout.operator, 'operator', 'Operator skin'))}
    <div class="panel-cta"><button type="button" class="btn secondary" data-action="reset-kit">Reset loadout</button><button type="button" class="btn primary" data-action="close">Confirm loadout ${icon('check', 15)}</button></div>`
}

export function updateArmory(panel, loadout) {
  const stats = panel.querySelector('#armory-stats')
  if (stats) stats.innerHTML = statsFor(loadout.primary, loadout.attachments)
  for (const slot of ATTACHMENT_SLOTS) {
    const span = panel.querySelector(`[data-attachment-detail="${slot.id}"]`)
    const choice =
      slot.choices.find((o) => o.id === loadout.attachments[slot.id]) ??
      slot.choices[0]
    if (span) span.textContent = choice.detail
  }
}
