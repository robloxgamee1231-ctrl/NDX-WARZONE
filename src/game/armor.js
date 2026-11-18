import {
  ARMOR_MAX,
  ARMOR_PLATE,
  BASE_RESERVE,
  SATCHEL_RESERVE,
  PLATE_SECONDS,
} from '../config.js'

export function armorState(armor = 50, plates = 2) {
  return {
    armor,
    plates,
    capacity: BASE_RESERVE,
    satchel: false,
    armorBox: false,
    plateProgress: 0,
    plateActive: false,
    plateBlocked: false,
  }
}
export function addPlates(p, amount) {
  const take = Math.max(0, Math.min(amount, p.capacity - p.plates))
  p.plates += take
  return take
}
export function equipSatchel(p) {
  if (p.satchel) return false
  p.satchel = true
  p.capacity = SATCHEL_RESERVE
  return true
}
export function cancelPlating(p, blockUntilRelease = false) {
  const wasActive = p.plateActive
  p.plateActive = false
  p.plateProgress = 0
  if (wasActive && blockUntilRelease) p.plateBlocked = true
  return wasActive
}
export function updatePlating(p, held, allowed, dt, emit = () => {}) {
  if (!held) p.plateBlocked = false
  if (
    !held ||
    p.plateBlocked ||
    !allowed ||
    p.armor >= ARMOR_MAX ||
    p.plates <= 0
  ) {
    cancelPlating(p)
    return
  }
  if (!p.plateActive) {
    p.plateActive = true
    p.plateProgress = 0
    emit('plateStart')
  }
  p.plateProgress += dt / PLATE_SECONDS
  if (p.plateProgress + 1e-7 < 1) return
  p.armor = Math.min(ARMOR_MAX, p.armor + ARMOR_PLATE)
  p.plates--
  cancelPlating(p)
  emit('plateInsert')
}
export function damageVitals(p, amount, ignoreArmor = false) {
  const interrupted = cancelPlating(p, true)
  const absorbed = ignoreArmor ? 0 : Math.min(p.armor, amount)
  p.armor = Math.max(0, p.armor - absorbed)
  p.health = Math.max(0, p.health - (amount - absorbed))
  return { absorbed, broken: absorbed > 0 && p.armor === 0, interrupted }
}
