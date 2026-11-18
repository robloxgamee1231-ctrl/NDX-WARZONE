import { WEAPONS } from '../config.js'

export const ATTACHMENT_SLOTS = [
  {
    id: 'optic',
    name: 'Optic',
    choices: [
      {
        id: 'iron',
        name: 'Factory sight',
        detail: 'Standard profile; no handling change.',
      },
      {
        id: 'dot',
        name: 'Prism dot',
        detail: 'Sharper sight picture, slightly slower handling.',
        aimSpread: 0.86,
        aimZoom: 2,
        speed: 0.994,
      },
      {
        id: 'scope',
        name: 'Scout glass',
        detail: 'Deeper zoom and tighter aim at the cost of mobility.',
        aimSpread: 0.8,
        aimZoom: 8,
        speed: 0.96,
        reload: 1.035,
      },
    ],
  },
  {
    id: 'stock',
    name: 'Stock',
    choices: [
      {
        id: 'standard',
        name: 'Issue stock',
        detail: 'Standard movement and recoil.',
      },
      {
        id: 'braced',
        name: 'Braced chassis',
        detail: 'Reduces recoil and spread, but slows movement.',
        kick: 0.82,
        spread: 0.89,
        speed: 0.956,
      },
      {
        id: 'light',
        name: 'Light frame',
        detail: 'Quicker footwork with more recoil.',
        kick: 1.17,
        spread: 1.1,
        speed: 1.045,
      },
    ],
  },
  {
    id: 'feed',
    name: 'Feed',
    choices: [
      {
        id: 'issue',
        name: 'Issue magazine',
        detail: 'Standard capacity and reload speed.',
      },
      {
        id: 'extended',
        name: 'Extended magazine',
        detail: 'More rounds per reload; heavier and slower to replace.',
        mag: 1.26,
        reload: 1.145,
        speed: 0.979,
      },
      {
        id: 'fast',
        name: 'Quickdraw magazine',
        detail: 'Faster reload in exchange for lower capacity.',
        mag: 0.84,
        reload: 0.8,
      },
    ],
  },
]

export const TACTICALS = {
  smoke: {
    id: 'smoke',
    name: 'Smoke field',
    desc: 'Deploy brief visual cover. Breaks bot sight and suppresses enemy fire dots inside the cloud.',
    count: 2,
    icon: 'weather',
    color: '#b9c7cd',
  },
  pulse: {
    id: 'pulse',
    name: 'Recon pulse',
    desc: 'Reveals nearby opponents on your squad map for eight seconds.',
    count: 2,
    icon: 'reticle',
    color: '#82dfea',
  },
  stim: {
    id: 'stim',
    name: 'Recovery stim',
    desc: 'Immediately restores 38 health and refreshes tactical sprint. Does not restore armor.',
    count: 1,
    icon: 'bolt',
    color: '#9fdda5',
  },
}

export const OPERATORS = {
  auto: {
    id: 'auto',
    name: 'Field assignment',
    desc: 'Use faction colors for allies and opponents.',
  },
  warden: {
    id: 'warden',
    name: 'Warden',
    desc: 'Classic scout fatigues and plate carrier.',
  },
  nomad: {
    id: 'nomad',
    name: 'Nomad',
    desc: 'Dark field kit with red accents.',
  },
  tidewatch: {
    id: 'tidewatch',
    name: 'Tidewatch',
    model: 'warden',
    swatch: '#437b83',
    desc: 'Maritime teal and salt-gray field gear.',
    dye: { Character_Main: '#3b7380', Pants: '#587e81', Grey: '#9ab6ba' },
  },
  alpine: {
    id: 'alpine',
    name: 'Alpine Relay',
    model: 'warden',
    swatch: '#bdc8bb',
    desc: 'Cold-weather uniform with pale rig panels.',
    dye: { Character_Main: '#b4bdb8', Pants: '#7e8e92', Grey: '#959999' },
  },
  emberline: {
    id: 'emberline',
    name: 'Emberline',
    model: 'nomad',
    swatch: '#c37b4f',
    desc: 'Oxide orange details and charred gray fabric.',
    dye: { Enemy_Red: '#c4804d', DarkGrey: '#465054', Grey: '#9a8a77' },
  },
  nightsignal: {
    id: 'nightsignal',
    name: 'Night Signal',
    model: 'nomad',
    swatch: '#756c9c',
    desc: 'Muted violet and graphite utility panels.',
    dye: { Enemy_Red: '#7768a8', DarkGrey: '#3e4055', Grey: '#757994' },
  },
}

export const FINISHES = Object.freeze({
  issue: { id: 'issue', name: 'Field Issue', body: '#5f6b65', trim: '#42494b' },
  carbon: { id: 'carbon', name: 'Carbon', body: '#252f34', trim: '#506064' },
  frost: { id: 'frost', name: 'Glacier', body: '#a4b6b7', trim: '#536c80' },
  tide: { id: 'tide', name: 'Tideglass', body: '#367b83', trim: '#8ca488' },
  ember: {
    id: 'ember',
    name: 'Copper Ember',
    body: '#98614a',
    trim: '#5b4b44',
  },
  orchid: {
    id: 'orchid',
    name: 'Night Orchid',
    body: '#685e91',
    trim: '#403d58',
  },
})
export const SIDEARM = 'spectre'
export const PRIMARY_IDS = Object.freeze(
  Object.keys(WEAPONS).filter((id) => id !== SIDEARM),
)
export const DEFAULT_ATTACHMENTS = Object.freeze(
  Object.fromEntries(ATTACHMENT_SLOTS.map((s) => [s.id, s.choices[0].id])),
)
const variants = new Map()

export function normalizeAttachments(raw) {
  return Object.fromEntries(
    ATTACHMENT_SLOTS.map((s) => [
      s.id,
      s.choices.find((c) => c.id === raw?.[s.id])?.id ?? s.choices[0].id,
    ]),
  )
}

export function normalizeLoadout(raw, weapon = 'raven') {
  const selected = raw?.primary ?? weapon
  return {
    primary: PRIMARY_IDS.includes(selected) ? selected : 'raven',
    attachments: normalizeAttachments(raw?.attachments),
    finish:
      typeof raw?.finish === 'string' && Object.hasOwn(FINISHES, raw.finish)
        ? raw.finish
        : 'issue',
    tactical:
      typeof raw?.tactical === 'string' &&
      Object.hasOwn(TACTICALS, raw.tactical)
        ? raw.tactical
        : 'smoke',
    operator:
      typeof raw?.operator === 'string' &&
      Object.hasOwn(OPERATORS, raw.operator)
        ? raw.operator
        : 'auto',
  }
}

/** Read-only shared spec; total variants are limited by the small whitelist. */
export function resolveWeapon(id, attachments = null) {
  const base =
    typeof id === 'string' && Object.hasOwn(WEAPONS, id)
      ? WEAPONS[id]
      : WEAPONS.raven
  if (
    !attachments ||
    id === SIDEARM ||
    (attachments.optic === 'iron' &&
      attachments.stock === 'standard' &&
      attachments.feed === 'issue')
  )
    return base
  const selected = ATTACHMENT_SLOTS.map(
    (s) => s.choices.find((c) => c.id === attachments[s.id]) ?? s.choices[0],
  )
  if (
    selected.every(
      (value, index) => value === ATTACHMENT_SLOTS[index].choices[0],
    )
  )
    return base
  const key = `${base.id}:${selected.map((c) => c.id).join(':')}`
  if (!variants.has(key)) {
    const applied = { ...base, aimSpread: 1, aimZoom: 0 }
    for (const choice of selected) {
      for (const stat of [
        'mag',
        'reload',
        'kick',
        'spread',
        'speed',
        'aimSpread',
      ])
        if (choice[stat]) applied[stat] *= choice[stat]
      if (choice.aimZoom) applied.aimZoom += choice.aimZoom
    }
    applied.mag = Math.round(applied.mag)
    variants.set(key, Object.freeze(applied))
  }
  return variants.get(key)
}

export function equippedSpec(player) {
  const parts =
    player.loadout &&
    player.weapon === player.loadout?.primary &&
    player.weapon === player.kit?.[0]?.id
      ? player.loadout.attachments
      : null
  return resolveWeapon(player.weapon, parts)
}

export function applyPreset(player) {
  const { primary, attachments, tactical } = player.loadout
  const a = resolveWeapon(primary, attachments),
    b = WEAPONS[SIDEARM]
  player.kit = [
    { id: a.id, ammo: a.mag, stock: a.stock },
    { id: b.id, ammo: b.mag, stock: b.stock },
  ]
  player.slot = 0
  player.weapon = a.id
  player.ammo = a.mag
  player.stock = a.stock
  player.reloadStart = player.reloadEnd = 0
  player.swapReady = 0
  player.burstLeft = 0
  player.burstReady = 0
  player.tacticalType = tactical
  player.tacticalCharges = TACTICALS[tactical].count
  player.gearReady = 0
}

export function swapWeapon(player, time) {
  if (!player.kit || player.swapReady > time) return false
  const i = player.slot === 0 ? 1 : 0
  const selected = player.kit[i]
  player.kit[player.slot] = {
    id: player.weapon,
    ammo: player.ammo,
    stock: player.stock,
  }
  player.slot = i
  player.weapon = selected.id
  player.ammo = selected.ammo
  player.stock = selected.stock
  player.reloadEnd = player.reloadStart = 0
  player.swapReady = time + 0.27
  player.burstLeft = 0
  player.burstReady = 0
  player.tactical = 0
  player.sprinting = false
  return true
}

export function replacePrimary(player, item) {
  if (
    !player.kit ||
    !PRIMARY_IDS.includes(item.weapon) ||
    player.kit[0].id === item.weapon
  )
    return false
  const previous =
    player.slot === 0
      ? { id: player.weapon, ammo: player.ammo, stock: player.stock }
      : player.kit[0]
  const id = item.weapon
  const w = resolveWeapon(
    id,
    id === player.loadout?.primary ? player.loadout.attachments : null,
  )
  player.kit[0] = {
    id,
    ammo: Math.min(w.mag, item.loaded ?? w.mag),
    stock: Math.min(w.stock, item.reserve ?? Math.floor(w.stock * 0.65)),
  }
  if (player.slot === 1)
    player.kit[1] = {
      id: player.weapon,
      ammo: player.ammo,
      stock: player.stock,
    }
  player.slot = 0
  player.burstLeft = player.burstReady = 0
  player.weapon = id
  player.ammo = player.kit[0].ammo
  player.stock = player.kit[0].stock
  player.reloadEnd = player.reloadStart = 0
  item.weapon = previous.id
  item.loaded = previous.ammo
  item.reserve = previous.stock
  return true
}
