/** Battlefield identifiers are shared by the launcher, authoritative server, and renderer. */
export const MAPS = Object.freeze({
  ridge: Object.freeze({
    id: 'ridge',
    kind: 'ridge',
    name: 'Vantage Ridge',
    chart: 'VANTAGE RIDGE',
    sector: 'SECTOR 07',
    art: 'vantage-hero',
    subtitle: 'Wilderness / long sightlines',
    description:
      'Seven named sectors linked by forest paths, roads, and aerial lifts. Get above the tree line before the gas closes.',
    half: 389,
    extent: 1240,
  }),
  floodline: Object.freeze({
    id: 'floodline',
    kind: 'ridge',
    name: 'Floodline',
    chart: 'FLOODLINE',
    sector: 'SECTOR 12',
    art: 'floodline',
    subtitle: 'Floodworks / seven districts',
    description:
      'Fight over the roofs of a floodworks town, cross on one of three bridges, or rotate below them through the dry spillway.',
    half: 312,
    extent: 910,
    flight: Object.freeze({
      from: [-285, 236],
      to: [275, -240],
      altitude: 136,
    }),
  }),
  yard: Object.freeze({
    id: 'yard',
    kind: 'yard',
    name: 'The Switchyard',
    chart: 'SWITCHYARD',
    sector: 'SECTOR 04',
    art: 'team-deathmatch',
    subtitle: 'Freight / stacked cover',
    description:
      'A compact maze of cargo stacks and service roads. Short turns favor fast weapons and repositioning.',
    half: 55,
    extent: 295,
  }),
  'relay-works': Object.freeze({
    id: 'relay-works',
    kind: 'yard',
    name: 'Relay Works',
    chart: 'RELAY WORKS',
    sector: 'SECTOR 09',
    art: 'relay-works',
    subtitle: 'Turbine hall / raised catwalk',
    description:
      'Contest the turbine hall or break away through the north and south yards. Use the stairs to take the raised observation route.',
    half: 50,
    extent: 237,
  }),
  range: Object.freeze({
    id: 'range',
    kind: 'range',
    name: 'Echo Proving Ground',
    chart: 'ECHO RANGE',
    sector: 'SECTOR 02',
    art: 'training-range',
    subtitle: 'Practice / live drills',
    description:
      'Zero your new equipment, talk to the range coach, or run a timed exercise.',
    half: 66,
    extent: 370,
  }),
})

export function battlefield(id) {
  return typeof id === 'string' && Object.hasOwn(MAPS, id)
    ? MAPS[id]
    : MAPS.ridge
}

export function mapsForMode(mode) {
  if (!mode?.teams?.length) return []
  return Object.values(MAPS).filter((entry) => entry.kind === mode.map)
}

export function mapForMode(mode, requested) {
  const map = battlefield(requested)
  return map.kind === mode?.map ? map : battlefield(mode?.map)
}
