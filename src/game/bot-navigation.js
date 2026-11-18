import { clamp, distance } from './world.js'

const directions = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]
const clearance = 0.46
const height = 1.77
const climb = 0.64

// Tiny priority queue. Each search is local and has a strict expansion budget,
// and the simulation bounds how many searches may start in one tick.
class Frontier {
  items = []
  push(node) {
    const heap = this.items
    let i = heap.length
    heap.push(node)
    while (i > 0) {
      const j = (i - 1) >> 1
      if (heap[j].f <= node.f) break
      heap[i] = heap[j]
      i = j
    }
    heap[i] = node
  }
  pop() {
    const heap = this.items,
      first = heap[0],
      last = heap.pop()
    if (!heap.length) return first
    let i = 0
    for (;;) {
      let k = i * 2 + 1
      if (k >= heap.length) break
      if (k + 1 < heap.length && heap[k + 1].f < heap[k].f) k++
      if (last.f <= heap[k].f) break
      heap[i] = heap[k]
      i = k
    }
    heap[i] = last
    return first
  }
  get size() {
    return this.items.length
  }
}

export function walkSample(world, x, z) {
  if (Math.max(Math.abs(x), Math.abs(z)) > world.half - 0.75) return null
  const ground = world.height(x, z)
  if (!Number.isFinite(ground)) return null
  let y = ground
  const near = world.grid.nearby(x, z, clearance)
  for (const b of near) {
    if (
      Math.abs(b.x - x) > b.w * 0.5 + clearance ||
      Math.abs(b.z - z) > b.d * 0.5 + clearance
    )
      continue
    const top = b.y + b.h
    if (top > y && top - ground <= 0.31) y = top
  }
  for (const b of near) {
    if (
      Math.abs(b.x - x) > b.w * 0.5 + clearance ||
      Math.abs(b.z - z) > b.d * 0.5 + clearance
    )
      continue
    if (b.y + b.h > y + 0.1 && b.y < y + height) return null
  }
  return { x, y, z }
}

export class BotNavigator {
  constructor(world) {
    this.world = world
    this.cell = world.kind === 'ridge' ? 3.4 : 2.15
    this.nodes = new Map()
    this.budget = 2
  }
  beginTick() {
    this.budget = 2
  }
  node(ix, iz) {
    const key = ix * 1024 + iz
    if (!this.nodes.has(key)) {
      const p = walkSample(this.world, ix * this.cell, iz * this.cell)
      this.nodes.set(key, p ? { ...p, ix, iz, key } : null)
    }
    return this.nodes.get(key)
  }
  connects(a, b) {
    if (Math.abs(a.y - b.y) > distance(a, b) * 0.5 + 0.12) return false
    const steps = Math.ceil(distance(a, b) / 0.8)
    let prev = a.y
    for (let i = 1; i < steps; i++) {
      const u = i / steps
      const node = walkSample(
        this.world,
        a.x + (b.x - a.x) * u,
        a.z + (b.z - a.z) * u,
      )
      if (!node || Math.abs(node.y - prev) > climb) return false
      prev = node.y
    }
    return Math.abs(prev - b.y) <= climb
  }
  nearest(p, from = null) {
    const x = Math.round(p.x / this.cell),
      z = Math.round(p.z / this.cell)
    let choice = null,
      best = Infinity
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const n = this.node(x + dx, z + dz)
        if (!n) continue
        const d = distance(p, n)
        if (d < best && (!from || this.connects(from, n))) {
          choice = n
          best = d
        }
      }
    return choice
  }
  search(start, target, maxNodes = 142) {
    const a = this.nearest(start, start)
    const radius = this.cell * 15.6
    const dist = distance(start, target)
    if (
      !a ||
      !dist ||
      Math.abs(start.y - this.world.height(start.x, start.z)) > 1.45
    )
      return []
    const dx = (target.x - start.x) * Math.min(1, radius / dist)
    const dz = (target.z - start.z) * Math.min(1, radius / dist)
    const goal = this.nearest({ x: start.x + dx, z: start.z + dz })
    if (!goal || goal.key === a.key) return []
    const visited = new Map(),
      open = new Frontier()
    const startRecord = { node: a, g: 0, f: distance(a, goal), parent: null }
    open.push(startRecord)
    visited.set(a.key, startRecord)
    let best = startRecord,
      closest = startRecord.f
    let remaining = maxNodes
    while (open.size && remaining > 0) {
      const current = open.pop(),
        p = current.node
      if (visited.get(p.key) !== current) continue
      remaining--
      const d = distance(p, goal)
      if (d < closest) {
        best = current
        closest = d
      }
      if (p.key === goal.key) break
      for (const [ox, oz] of directions) {
        const next = this.node(p.ix + ox, p.iz + oz)
        if (!next || distance(a, next) > radius * 1.2) continue
        const travel = distance(p, next),
          g = current.g + travel + Math.abs(next.y - p.y) * 0.68
        if (
          g >= (visited.get(next.key)?.g ?? Infinity) ||
          !this.connects(p, next)
        )
          continue
        const record = {
          node: next,
          g,
          f: g + distance(next, goal) * 1.07,
          parent: current,
        }
        visited.set(next.key, record)
        open.push(record)
      }
    }
    if (best === startRecord) return []
    const chain = []
    for (let r = best; r; r = r.parent) chain.push(r.node)
    chain.reverse()
    const route = []
    let p = start,
      cursor = 0
    while (cursor < chain.length) {
      // Skip bends that the live body can pass without clipping a doorway.
      let end = cursor
      for (let i = cursor + 1; i < Math.min(cursor + 6, chain.length); i++) {
        if (this.connects(p, chain[i])) end = i
      }
      p = chain[end]
      route.push(p)
      cursor = end + 1
    }
    return route
  }
  steer(p, goal, brain, time) {
    if (!goal || p.mantle || p.climbing || !p.grounded) return goal
    const current = brain.path
    const radius = this.cell * 0.62
    if (current && time < current.until && distance(goal, current.goal) < 11) {
      while (current.points.length && distance(p, current.points[0]) < radius)
        current.points.shift()
      if (current.points.length) return current.points[0]
    }
    if (!brain.routeCheck || time >= brain.routeCheck) {
      const stuck =
        brain.routeOrigin &&
        distance(p, brain.routeOrigin) < 0.87 &&
        distance(p, goal) > 3.2
      brain.routeOrigin = { x: p.x, z: p.z }
      brain.routeCheck = time + 0.36 + (p.index % 4) * 0.06
      if (stuck && this.budget > 0 && time >= (brain.routeReady ?? 0)) {
        this.budget--
        brain.routeReady = time + 1.12 + (p.index % 5) * 0.17
        const points = this.search(p, goal)
        while (points.length && distance(p, points[0]) < radius) points.shift()
        if (points.length) {
          brain.path = {
            points,
            goal: { ...goal },
            until: time + clamp(points.length * 1.9, 3.6, 9.2),
          }
          return points[0]
        }
      }
    }
    return goal
  }
}
