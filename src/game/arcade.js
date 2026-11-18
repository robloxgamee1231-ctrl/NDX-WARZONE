import { WEAPONS } from '../config.js'
import {
  applyPreset,
  DEFAULT_ATTACHMENTS,
  normalizeLoadout,
  SIDEARM,
} from './loadout.js'

export const GUN_LADDER = Object.freeze([
  'raven',
  'viper',
  'harrier',
  'mistral',
  'bulwark',
  'kestrel',
  SIDEARM,
])
export const TAG_SECONDS = 26
export const TAG_DISTANCE = 1.75

export function ladderEquip(p) {
  if (p.gunStage >= GUN_LADDER.length) return
  const weapon = GUN_LADDER[p.gunStage]
  p.loadout = normalizeLoadout({
    ...p.ladderPreset,
    primary: weapon === SIDEARM ? 'raven' : weapon,
    attachments: DEFAULT_ATTACHMENTS,
  })
  const { tacticalCharges, gearReady } = p
  applyPreset(p)
  if (tacticalCharges !== undefined)
    Object.assign(p, { tacticalCharges, gearReady })
  if (weapon === SIDEARM)
    Object.assign(p, {
      slot: 1,
      weapon,
      ammo: WEAPONS[weapon].mag,
      stock: WEAPONS[weapon].stock,
    })
}

export function dropTag(match, p) {
  const item = match.spawnLoot('tag', p.x, p.z, {
    y: Math.round(p.y * 100) / 100,
    team: p.team,
    endAt: match.time + TAG_SECONDS,
  })
  match.tags.set(item.id, item)
}

export function takeTags(match, p) {
  if (!p.alive || !p.grounded || p.air !== 'ground' || p.downed) return
  for (const tag of match.tags.values()) {
    if (tag.endAt <= match.time || Math.abs(p.y - tag.y) > 1.15) continue
    const x = tag.x - p.x,
      z = tag.z - p.z,
      y = tag.y - p.y
    const d = Math.hypot(x, y, z)
    if (d > TAG_DISTANCE) continue
    if (
      d > 0.06 &&
      match.world.grid.rayHit(
        { x: p.x, y: p.y + 0.55, z: p.z },
        { x: x / d, y: y / d, z: z / d },
        d,
      ) <
        d - 0.07
    )
      continue
    const deny = p.team === tag.team
    if (deny) p.denies++
    else {
      p.confirms++
      p.objective += 12
      match.scores[p.team]++
    }
    tag.removed = true
    match.markLoot(tag)
    match.tags.delete(tag.id)
    match.event('tag', { actor: p.id, denied: deny })
  }
}

export function bestTag(match, p) {
  let best = null,
    score = 27
  for (const tag of match.tags.values()) {
    if (tag.endAt <= match.time || Math.abs(tag.y - p.y) > 1.2) continue
    const d =
      Math.hypot(tag.x - p.x, tag.z - p.z) + (tag.team === p.team ? 5 : 0)
    if (d < score) {
      best = tag
      score = d
    }
  }
  return best
}
