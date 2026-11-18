import { clamp, distance } from './world.js'

import { GARRISON } from './control-config.js'
export const RELAYS = [
  { id: 'A', title: 'West Sidings', x: -25, z: 1.5 },
  { id: 'B', title: 'Signal Crossing', x: 1.5, z: -1.6 },
  { id: 'C', title: 'East Freight', x: 26, z: 3.5 },
]

function openSpot(world, relay) {
  for (let i = 0; i < 31; i++) {
    const r = i === 0 ? 0 : Math.min(i * 0.61, 12)
    const x = relay.x + Math.cos(i * 2.4) * r
    const z = relay.z + Math.sin(i * 2.4) * r
    const y = world.height(x, z)
    const obstacles = [...world.grid.nearby(x, z, 3)]
    if (
      obstacles.some(
        (b) =>
          b.y < y + 1.72 &&
          b.y + b.h > y + 0.2 &&
          Math.abs(b.x - x) < b.w / 2 + 2.45 &&
          Math.abs(b.z - z) < b.d / 2 + 2.45,
      )
    )
      continue
    return { x, y, z }
  }
  return { ...relay, y: world.height(relay.x, relay.z) }
}

export function createControl(world) {
  return {
    relays: (world.relayPoints ?? RELAYS).map((relay) => ({
      ...relay,
      ...openSpot(world, relay),
      radius: GARRISON.radius,
      owner: null,
      claim: null,
      progress: 0,
      contested: false,
      occupying: [0, 0],
    })),
    points: [0, 0],
    clock: 0,
    overtime: false,
  }
}

export function onRelay(p, relay) {
  return (
    p?.alive &&
    !p.downed &&
    p.air === 'ground' &&
    p.grounded &&
    Math.abs(p.y - relay.y) < 2.1 &&
    distance(p, relay) <= relay.radius
  )
}

function captureRelay(relay, players, dt, emit) {
  const occupants = [[], []]
  for (const p of players)
    if ((p.team === 0 || p.team === 1) && onRelay(p, relay))
      occupants[p.team].push(p)
  const [a, b] = occupants.map((q) => q.length)
  relay.occupying[0] = a
  relay.occupying[1] = b
  relay.contested = a > 0 && b > 0
  if (relay.contested) return
  const side = a ? 0 : b ? 1 : null
  if (side === null || side === relay.owner) {
    relay.progress = Math.max(
      0,
      relay.progress - dt / (side === null ? 4.8 : 1.65),
    )
    if (!relay.progress) relay.claim = null
    return
  }
  if (relay.claim !== side) {
    relay.claim = side
    relay.progress = 0
  }
  const taking = 1 + Math.min(2, occupants[side].length - 1) * 0.22
  relay.progress = clamp(
    relay.progress + (dt * taking) / GARRISON.captureSeconds,
    0,
    1,
  )
  if (relay.progress < 1 - 1e-7) return
  relay.owner = side
  relay.claim = null
  relay.progress = 0
  for (const p of occupants[side]) {
    p.captures = (p.captures ?? 0) + 1
    p.objective = (p.objective ?? 0) + 75
  }
  emit('relayCaptured', { relay: relay.id, name: relay.title, team: side })
}

export function updateControl(state, players, time, dt, emit = () => {}) {
  for (const relay of state.relays) captureRelay(relay, players, dt, emit)
  state.clock += dt
  if (state.clock >= GARRISON.tick) {
    state.clock %= GARRISON.tick
    for (const relay of state.relays) {
      if (
        relay.owner === null ||
        relay.contested ||
        (relay.claim !== null && relay.progress >= 0.5)
      )
        continue
      state.points[relay.owner]++
      for (const p of players)
        if (p.team === relay.owner && onRelay(p, relay))
          p.objective = (p.objective ?? 0) + 3
    }
  }
  const [a, b] = state.points
  const lead = a === b ? null : a > b ? 0 : 1
  const nearEnd = Math.max(a, b) >= GARRISON.goal || time >= GARRISON.duration
  if (!nearEnd) return undefined
  const push = state.relays.some(
    (relay) =>
      relay.contested ||
      (relay.claim !== null && relay.claim !== lead && relay.progress >= 0.1),
  )
  if (time >= GARRISON.duration + GARRISON.overtime) return lead
  if (
    lead !== null &&
    (!push || Math.abs(a - b) > 12) &&
    (!state.overtime || Math.abs(a - b) >= 2)
  )
    return lead
  if (!state.overtime) {
    state.overtime = true
    emit('relayOvertime')
  }
  return undefined
}

export function assignRelay(state, player, peers) {
  if (!state) return null
  let best = null,
    score = -Infinity
  for (const [i, relay] of state.relays.entries()) {
    const supporting = peers.filter(
      (p) =>
        p.id !== player.id &&
        p.team === player.team &&
        p.alive &&
        distance(p, relay) < 11,
    ).length
    const preference = (player.index + i) % state.relays.length === 0 ? 7 : 0
    const importance =
      (relay.owner !== player.team ? 22 : 2) +
      (relay.contested ? 10 : 0) +
      preference -
      supporting * 11
    const weight = importance - distance(player, relay) * 0.62
    if (weight > score) {
      best = relay
      score = weight
    }
  }
  return best
}

export function controlWire(state) {
  if (!state) return null
  return {
    overtime: state.overtime,
    relays: state.relays.map((r) => ({
      ...r,
      progress: Math.round(r.progress * 100) / 100,
    })),
  }
}
