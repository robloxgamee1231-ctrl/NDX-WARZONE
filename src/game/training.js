import { WEAPONS } from '../config.js'
import { armorState } from './armor.js'
import { applyPreset, equippedSpec } from './loadout.js'
import { EMPTY_INPUT, moveState } from './movement.js'
import { distance } from './world.js'

export const DRILLS = {
  steel: {
    id: 'steel',
    title: 'Steel Sequence',
    label: 'MARKSMANSHIP',
    duration: 48,
    gold: 24,
    silver: 34,
    brief:
      'Clear six illuminated steel plates in the order shown. Accuracy breaks ties on the leaderboard.',
    hint: 'Follow the marker to the active plate. Hit dead center for a precision bonus.',
    targets: [
      'target-0-0',
      'target-0--7.8',
      'target-0-7.8',
      'target-1-7.8',
      'target-1--7.8',
      'target-2-0',
    ],
  },
  course: {
    id: 'course',
    title: 'Momentum Circuit',
    label: 'PARKOUR',
    duration: 65,
    gold: 35,
    silver: 48,
    brief:
      'Run through five gates, clear the stacked concrete step, and reach the finish pad.',
    hint: 'Sprint between gates. Use Jump toward the concrete stack to mantle onto it.',
    gates: [
      { x: 8, z: 12.5, lift: 0, r: 2.55, title: 'Start Gate' },
      { x: 18.9, z: 7.3, lift: 0, r: 2.35, title: 'Sprint Gate' },
      { x: 19, z: 4, lift: 0.62, r: 1.1, title: 'Low Step' },
      { x: 19, z: -2, lift: 1.22, r: 1.28, title: 'Climb Gate' },
      { x: 19, z: -8, lift: 2.02, r: 1.22, title: 'High Mantle / Finish' },
    ],
  },
  armor: {
    id: 'armor',
    title: 'Armor Under Pressure',
    label: 'SURVIVAL',
    duration: 34,
    gold: 14,
    silver: 23,
    brief:
      'A three-impact simulation. Restart your hold if interrupted, then fill all three slots after the final hit.',
    hint: 'After taking a hit, release and hold the armor control again. Wait for all three damage pulses.',
    pulses: [
      { at: 1.25, damage: 32 },
      { at: 4.1, damage: 56 },
      { at: 8.3, damage: 68 },
    ],
  },
}

const COUNTDOWN = 3
const fixed = (n) => Math.round(n * 100) / 100

export function startDrill(match, p, id) {
  if (
    match.mode.map !== 'range' ||
    !p?.alive ||
    !p.grounded ||
    typeof id !== 'string' ||
    !Object.hasOwn(DRILLS, id)
  )
    return false
  if (match.training?.state === 'countdown' && match.training.kind === id)
    return false
  const drill = DRILLS[id]
  match.resetRange(p, { silent: true })
  const begin = match.time + COUNTDOWN
  const start = drill.id === 'course' ? { x: 0, z: 15 } : { x: 0, z: 13 }
  Object.assign(
    p,
    moveState(start.x, match.world.height(start.x, start.z), start.z),
  )
  p.input = { ...EMPTY_INPUT }
  p.pending = {}
  applyPreset(p)
  if (id === 'armor') Object.assign(p, armorState(100, 8))
  if (id === 'armor') p.capacity = 8
  match.training = {
    kind: id,
    state: 'countdown',
    begin,
    end: begin + drill.duration,
    stage: 0,
    shots: 0,
    hits: 0,
    precision: 0,
    time: null,
    grade: null,
  }
  updateObjective(match)
  match.event('drillReady', {
    actor: p.id,
    kind: id,
    yaw: p.yaw,
    pitch: p.pitch,
  })
  return true
}

export function cancelDrill(match, p) {
  if (!match.training || !p) return false
  match.training = null
  match.targetDown = {}
  match.notice(p, 'Free practice resumed')
  return true
}

function updateObjective(match) {
  const state = match.training
  if (!state) return
  const drill = DRILLS[state.kind]
  if (drill.targets) {
    state.target = drill.targets[state.stage] ?? null
    state.point = match.world.targets.find((t) => t.id === state.target) ?? null
    state.goal = drill.targets.length
  } else if (drill.gates) {
    const gate = drill.gates[state.stage]
    state.point = gate
      ? { ...gate, y: match.world.height(gate.x, gate.z) + gate.lift }
      : null
    state.goal = drill.gates.length
  } else {
    state.goal = drill.pulses.length
    state.point = null
  }
}

function finishDrill(match, p, passed) {
  const state = match.training
  if (!state || !['active', 'countdown'].includes(state.state)) return
  const def = DRILLS[state.kind]
  state.time = fixed(
    Math.max(0, Math.min(def.duration, match.time - state.begin)),
  )
  state.state = passed ? 'passed' : 'failed'
  state.grade = !passed
    ? 'UNQUALIFIED'
    : state.time <= def.gold
      ? 'GOLD'
      : state.time <= def.silver
        ? 'SILVER'
        : 'BRONZE'
  state.target = null
  state.point = null
  match.event('drillDone', { actor: p.id, drill: { ...state }, passed })
}

export function practiceShot(match) {
  if (match.training?.kind === 'steel' && match.training.state === 'active')
    match.training.shots++
}

export function drillAllowsTarget(match, target) {
  const state = match.training
  if (
    !state ||
    state.kind !== 'steel' ||
    ['passed', 'failed'].includes(state.state)
  )
    return true
  return state.state === 'active' && state.target === target.id
}

export function drillHit(match, p, target, precision) {
  const state = match.training
  if (
    !state ||
    state.kind !== 'steel' ||
    state.state !== 'active' ||
    target.id !== state.target
  )
    return
  state.hits++
  state.precision += Number(precision)
  state.stage++
  if (state.stage === state.goal) finishDrill(match, p, true)
  else {
    updateObjective(match)
    match.event('drillStage', {
      actor: p.id,
      stage: state.stage,
      kind: state.kind,
    })
  }
}

export function drillLocksInput(match, p) {
  if (
    match.training?.state !== 'countdown' ||
    match.time >= match.training.begin
  )
    return false
  // Lock translation, not the camera, so the player can line up their first action.
  p.vx = p.vz = 0
  return true
}

export function updateDrill(match, p) {
  const state = match.training
  if (!p || !state) return
  if (state.state === 'countdown' && match.time + 1e-7 >= state.begin) {
    state.state = 'active'
    match.event('drillStart', { actor: p.id, kind: state.kind })
  }
  if (state.state !== 'active') return
  if (!p.alive || match.time >= state.end) return finishDrill(match, p, false)
  const drill = DRILLS[state.kind]
  if (drill.gates) {
    const gate = state.point
    if (
      p.grounded &&
      distance(p, gate) < gate.r &&
      Math.abs(p.y - gate.y) < 0.48
    ) {
      state.stage++
      match.event('drillStage', {
        actor: p.id,
        stage: state.stage,
        kind: state.kind,
      })
      if (state.stage >= state.goal) finishDrill(match, p, true)
      else updateObjective(match)
    }
  }
  if (drill.pulses) {
    while (
      state.stage < state.goal &&
      match.time - state.begin >= drill.pulses[state.stage].at
    ) {
      const pulse = drill.pulses[state.stage++]
      match.damage(p, pulse.damage, null, 'test')
      match.event('drillStage', {
        actor: p.id,
        stage: state.stage,
        kind: state.kind,
      })
      if (!p.alive) return finishDrill(match, p, false)
    }
    if (p.armor >= 150 && state.stage === state.goal)
      finishDrill(match, p, true)
  }
}

export function drillPickupAllowed(match, item) {
  const state = match.training
  if (!state || !['countdown', 'active'].includes(state.state)) return true
  return item.type === 'reset'
}

export function drillAmmoFloor(player) {
  const w = equippedSpec(player)
  if (player.ammo < 1 && player.stock < 1)
    player.stock = Math.min(2 * w.mag, WEAPONS[player.weapon].stock)
}
