import { CONTRACTS } from './contract-catalog.js'
import { forward } from './movement.js'
import { distance } from './world.js'

export function startContract(match, p, item) {
  const def = CONTRACTS[item.task]
  if (!def || p.contract || !p.alive || p.downed) return false
  const f = forward(p.yaw),
    spot = match.safePoint(item.x + f.x * 29 + 6, item.z + f.z * 29 - 6)
  const c = {
    task: item.task,
    name: def.name,
    goal: def.goal,
    cash: def.cash,
    end: match.time + def.seconds,
    progress: 0,
    ...spot,
  }
  if (c.task === 'bounty') {
    let nearest = Infinity
    for (const enemy of match.players.values()) {
      const d = distance(p, enemy)
      if (enemy.alive && enemy.team !== p.team && d < nearest) {
        nearest = d
        c.target = enemy.id
        c.x = enemy.x
        c.z = enemy.z
      }
    }
    if (!c.target) {
      match.notice(p, 'No enemy available for bounty', 'warn')
      return false
    }
    match.notice(
      match.players.get(c.target),
      'Enemy bounty accepted on your position',
      'warn',
    )
  } else if (c.task === 'recovery') {
    c.returnX = item.x
    c.returnZ = item.z
    const crate = match.spawnLoot('crate', spot.x, spot.z)
    c.cache = crate.id
    c.x = crate.x
    c.z = crate.z
  } else if (c.task === 'scavenge') {
    for (let i = 0; i < 3; i++) {
      const s = match.safePoint(spot.x + i * 12 - 12, spot.z + (i % 2 ? 12 : 0))
      match.spawnLoot('crate', s.x, s.z, { contract: p.id })
    }
  }
  p.contract = c
  match.event('contract', { actor: p.id, name: c.name })
  match.notice(p, `${c.name} accepted`, 'gold')
  return true
}
function cancel(match, p, reason) {
  p.contract = null
  match.notice(p, reason, 'warn')
}
function reward(match, p) {
  const c = p.contract
  p.contract = null
  for (const ally of match.players.values())
    if (ally.alive && ally.team === p.team) {
      ally.cash += c.cash
      ally.contracts++
      ally.objective += 60
      match.event('contractDone', { actor: ally.id, amount: c.cash })
      match.notice(
        ally,
        `Contract complete · +$${c.cash.toLocaleString('en-US')}`,
        'gold',
      )
    }
}
export function recordContractKill(match, victim, by) {
  for (const owner of match.players.values()) {
    const c = owner.contract
    if (c?.task !== 'bounty' || c.target !== victim.id) continue
    if (match.time >= c.end) cancel(match, owner, 'Contract expired')
    else if (by?.team === owner.team) reward(match, owner)
    else cancel(match, owner, 'Bounty lost · target eliminated elsewhere')
  }
}
export function recordContractCrate(match, p, item) {
  const c = p.contract
  if (!c || match.time >= c.end) return
  if (c.task === 'scavenge') c.progress++
  if (c.task === 'recovery' && c.cache === item.id && !c.progress) {
    c.progress = 1
    c.x = c.returnX
    c.z = c.returnZ
    match.notice(p, 'Cargo secured · return to the terminal', 'gold')
  }
}
export function advanceContract(match, p, dt) {
  const c = p.contract
  if (!c) return
  if (match.time >= c.end) return cancel(match, p, 'Contract expired')
  if (c.task === 'scavenge') {
    // Searching every crate at simulation rate is unnecessary: refresh twice per second.
    if (match.time >= (c.nextScan ?? 0)) {
      let nearest = Infinity
      for (const it of match.loot.values())
        if (it.type === 'crate' && !it.opened && !it.removed) {
          const d = distance(it, p) - (it.contract === p.id ? 65 : 0)
          if (d < nearest) {
            nearest = d
            c.x = it.x
            c.z = it.z
          }
        }
      c.nextScan = match.time + 0.5
    }
  } else if (c.task === 'bounty') {
    const enemy = match.players.get(c.target)
    if (!enemy?.alive)
      return cancel(match, p, 'Bounty lost · target unavailable')
    if (match.time >= (c.nextScan ?? 0)) {
      c.x = enemy.x
      c.z = enemy.z
      c.nextScan = match.time + 3
    }
  } else if (c.task === 'recovery' && !c.progress) {
    const crate = match.loot.get(c.cache)
    if (!crate || crate.opened || crate.removed)
      return cancel(match, p, 'Recovery failed · cargo intercepted')
  } else if (
    p.air === 'ground' &&
    distance(c, p) < (c.task === 'recon' ? 7.6 : 3) &&
    Math.abs(p.y - match.world.height(c.x, c.z)) < 2.5
  ) {
    if (c.task === 'recovery') c.progress = 2
    else c.progress += dt
  }
  if (c.progress + 1e-6 >= c.goal) reward(match, p)
}
