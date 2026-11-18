// Launch posts are original Vantage Ridge traversal anchors. Positions and
// clearance are calculated from the shared map; no client-supplied transform
// participates in the ascent or its collision checks.
const LOCATIONS = [
  { site: 0, dx: 26, dz: -16, yaw: -0.69, label: 'Runway Lift' },
  { site: 1, dx: 20, dz: 16, yaw: -2.27, label: 'Floodgate Lift' },
  { site: 2, dx: 3, dz: 23, yaw: 2.56, label: 'Relay Lift' },
  { site: 4, dx: -11, dz: 17, yaw: 1.2, label: 'North Yard Lift' },
  { site: 5, dx: -23, dz: -11, yaw: 0.84, label: 'Quarry Lift' },
  { site: 6, dx: 19, dz: -17, yaw: -0.23, label: 'Timber Lift' },
]
const FLOODLINE_LIFTS = [
  { site: 0, dx: 26, dz: 20, yaw: -1.45, label: 'Pump Lift' },
  { site: 1, dx: 24, dz: 16, yaw: -1.13, label: 'Berm Lift' },
  { site: 2, dx: 25, dz: -12, yaw: -1.28, label: 'Market Lift' },
  { site: 3, dx: -33, dz: 22, yaw: 1.94, label: 'Exchange Lift' },
  { site: 4, dx: -36, dz: 7, yaw: 1.18, label: 'Array Lift' },
  { site: 5, dx: -30, dz: -17, yaw: 1.42, label: 'Depot Lift' },
]
const RADIUS = 2.25
export const LAUNCH_SECONDS = 1.2
export const LAUNCH_VERTICAL = 31
export const LAUNCH_SPEED = 17
export const LAUNCH_COOLDOWN = 6.5

export function layoutPads(world) {
  if (world.kind !== 'ridge') return []
  const placements = []
  const anchors = world.map?.id === 'floodline' ? FLOODLINE_LIFTS : LOCATIONS
  for (const { site, dx, dz, yaw, label } of anchors) {
    const sector = world.sites[site]
    const cx = sector.x + dx,
      cz = sector.z + dz
    for (let i = 0; i < 21; i++) {
      const angle = i * 2.399963
      const offset = i ? 1 + 0.59 * i : 0
      const x = cx + Math.cos(angle) * offset,
        z = cz + Math.sin(angle) * offset
      const y = world.height(x, z)
      const obstacles = [...world.grid.nearby(x, z, 7)]
      const blocked = obstacles.some(
        (b) =>
          Math.abs(b.x - x) < b.w / 2 + 2.8 &&
          Math.abs(b.z - z) < b.d / 2 + 2.8 &&
          b.y < y + 11 &&
          b.y + b.h > y + 0.24,
      )
      if (blocked) continue
      placements.push({
        id: `pad-${site}`,
        x,
        y,
        z,
        yaw,
        label,
        radius: RADIUS,
      })
      break
    }
  }
  return placements
}

export function nearestLaunchPad(world, player, time) {
  if (
    !player ||
    player.alive === false ||
    player.air !== 'ground' ||
    !player.grounded ||
    player.mantle ||
    player.climbing ||
    player.downed ||
    (player.launchReady ?? 0) > time
  )
    return null
  for (const pad of world.pads ?? []) {
    if (Math.abs(pad.y - player.y) > 1.15) continue
    if ((player.x - pad.x) ** 2 + (player.z - pad.z) ** 2 < pad.radius ** 2)
      return pad
  }
  return null
}
