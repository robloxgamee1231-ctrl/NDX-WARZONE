import * as T from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { finishForWeapon, finishStyle, operatorStyle } from './loadout.js'

const WEAPON_BONES = {
  raven: 'AK',
  viper: 'SMG',
  kestrel: 'Sniper',
  spectre: 'Pistol',
  mistral: 'SMG',
  bulwark: 'AK',
  harrier: 'Sniper',
}
const POLICY = {
  low: { count: 3, range: 30, shadows: false },
  balanced: { count: 8, range: 66, shadows: false },
  high: { count: 14, range: 93, shadows: true },
}

function profileClip(actor, time) {
  if (actor.npc) return actor.wave ? 'Wave' : 'Idle'
  if (actor.downed) return 'Duck'
  const shooting = time - actor.shotAt < 0.23
  if (actor.stance === 'slide') return 'Duck'
  if (['mantle', 'climb', 'jump'].includes(actor.stance)) return 'Jump_Idle'
  if (actor.stance === 'crouch') return 'Duck'
  const speed = Math.hypot(actor.vx, actor.vz)
  if (speed > 5.9) return shooting ? 'Run_Shoot' : 'Run_Gun'
  if (speed > 0.72) return 'Walk_Shoot'
  return 'Idle_Shoot'
}

function rigFor(asset, skin) {
  const root = new T.Group()
  const rig = clone(asset.scene)
  // Quaternius' operators look toward +Z; the field uses -Z as forward.
  rig.rotation.y = Math.PI
  root.add(rig)
  const weapons = new Map(),
    skeletons = new Set(),
    dyed = new Map()
  const dye = operatorStyle(skin)?.dye
  const weaponMaterials = new Map()
  rig.traverse((node) => {
    if (Object.values(WEAPON_BONES).includes(node.name))
      weapons.set(node.name, node)
    if (node.isSkinnedMesh) {
      skeletons.add(node.skeleton)
      node.frustumCulled = false // Animated bounds exceed the bind pose.
    }
    if (
      node.isMesh &&
      dye &&
      Object.hasOwn(dye, node.material?.name) &&
      !Object.values(WEAPON_BONES).includes(node.parent?.name)
    ) {
      const shared = node.material
      if (!dyed.has(shared)) {
        const mat = shared.clone()
        mat.color.set(dye[shared.name])
        dyed.set(shared, mat)
      }
      node.material = dyed.get(shared)
    }
    if (node.isLight || node.isCamera) node.visible = false
  })
  for (const [id, anchor] of weapons) {
    const surfaces = new Map()
    anchor.traverse((obj) => {
      if (!obj.isMesh || Array.isArray(obj.material) || !obj.material.color)
        return
      const source = obj.material
      if (!surfaces.has(source)) surfaces.set(source, source.clone())
      obj.material = surfaces.get(source)
    })
    weaponMaterials.set(id, surfaces)
  }
  const mixer = new T.AnimationMixer(rig)
  const clips = new Map(asset.animations.map((clip) => [clip.name, clip]))
  return {
    root,
    rig,
    weapons,
    weaponMaterials,
    finishKey: null,
    skeletons,
    dyed,
    mixer,
    clips,
    clip: null,
    action: null,
    weapon: null,
  }
}

function pose(slot, p, time, dt, shadows) {
  const { root, rig, mixer, weapons, clips } = slot
  root.visible = true
  root.position.set(p.x, p.y + 0.02, p.z)
  root.rotation.set(
    p.downed ? -0.5 : p.stance === 'slide' ? -0.2 : 0,
    p.yaw,
    p.stance === 'slide' ? -0.15 : 0,
    'YXZ',
  )
  rig.scale.set(0.87, p.downed ? 0.6 : 0.93, 0.87)
  if (slot.shadows !== shadows) {
    slot.shadows = shadows
    rig.traverse((n) => {
      if (n.isMesh) n.castShadow = n.receiveShadow = shadows
    })
  }
  const shown = p.npc ? 'unarmed' : (WEAPON_BONES[p.weapon] ?? 'AK')
  if (slot.weapon !== shown) {
    slot.weapon = shown
    for (const [id, model] of weapons) model.visible = id === shown
  }
  if (!p.npc) {
    const skin = finishStyle(finishForWeapon(p.loadout, p.weapon))
    const key = `${shown}:${skin?.id}`
    if (slot.finishKey !== key) {
      slot.finishKey = key
      for (const [source, material] of slot.weaponMaterials.get(shown) ?? []) {
        material.color.copy(source.color)
        if (skin && skin.id !== 'issue')
          material.color.lerp(new T.Color(skin.body), 0.68)
      }
    }
  }

  const clip = profileClip(p, time)
  if (slot.clip !== clip) {
    slot.clip = clip
    const motion = clips.get(clip) ?? clips.get('Idle')
    if (motion) {
      slot.action?.fadeOut(0.15)
      slot.action = mixer
        .clipAction(motion)
        .reset()
        .setEffectiveWeight(1)
        .fadeIn(0.15)
        .play()
    }
  }
  if (slot.action) {
    // The source has an animated upper-body aiming loop; slow its cycle while idle.
    slot.action.timeScale =
      clip === 'Idle_Shoot' && time - p.shotAt >= 0.23
        ? 0.19
        : clip === 'Duck'
          ? 0.52
          : 1
  }
  mixer.update(dt)
}

export class OperatorRigs {
  constructor(scene, pool) {
    this.scene = scene
    this.pool = pool
    this.slots = new Map()
    this.idle = new Map()
    this.active = new Set()
    // Defer the non-critical 2 MB until a relevant operator is nearby.
  }

  release(slot) {
    slot.root.removeFromParent()
    slot.root.visible = false
    slot.mixer.stopAllAction()
    slot.clip = slot.weapon = slot.action = null
    const size = [...this.idle.values()].reduce(
      (count, pool) => count + pool.length,
      0,
    )
    if (size >= 14) {
      this.disposeRig(slot)
      return
    }
    if (!this.idle.has(slot.skin)) this.idle.set(slot.skin, [])
    this.idle.get(slot.skin).push(slot)
  }
  disposeRig(slot) {
    slot.mixer.stopAllAction()
    slot.mixer.uncacheRoot(slot.rig)
    slot.root.removeFromParent()
    for (const bones of slot.skeletons) bones.dispose()
    for (const mat of slot.dyed.values()) mat.dispose()
    for (const surfaces of slot.weaponMaterials.values())
      for (const mat of surfaces.values()) mat.dispose()
  }
  update(players, camera, me, hidden, time, dt, quality) {
    const policy = POLICY[quality] ?? POLICY.balanced
    const choice = []
    for (const p of players) {
      if (!p.alive || p.air !== 'ground' || p.id === hidden) continue
      const d = camera.position.distanceToSquared({
        x: p.x,
        y: p.y + 1,
        z: p.z,
      })
      if (d < policy.range ** 2)
        choice.push({ p, d: d * (this.slots.has(p.id) ? 0.86 : 1) })
    }
    choice.sort((a, b) => a.d - b.d)
    this.active.clear()
    const selections = choice.slice(0, policy.count)
    const keep = new Set(selections.map(({ p }) => p.id))
    for (const [id, slot] of this.slots) {
      if (keep.has(id)) continue
      this.slots.delete(id)
      this.release(slot)
    }
    for (const { p } of selections) {
      const style = p.operator !== 'auto' && operatorStyle(p.operator)
      const skin = style ? style.id : p.team === me.team ? 'warden' : 'nomad'
      const model = style?.model ?? skin
      const asset = this.pool.get(model)
      if (!asset) {
        this.pool.load(model)
        continue
      }
      let slot = this.slots.get(p.id)
      if (slot && slot.skin !== skin) {
        this.release(slot)
        slot = null
      }
      if (!slot) {
        const cache = this.idle.get(skin)
        slot = cache?.pop() ?? rigFor(asset, skin)
        if (cache?.length === 0) this.idle.delete(skin)
        slot.skin = skin
        this.slots.set(p.id, slot)
        this.scene.add(slot.root)
      }
      this.active.add(p.id)
      pose(slot, p, time, dt, policy.shadows)
    }
    return this.active
  }

  dispose() {
    for (const slot of [
      ...this.slots.values(),
      ...Array.from(this.idle.values()).flat(),
    ]) {
      this.disposeRig(slot)
    }
    this.slots.clear()
    this.idle.clear()
    this.active.clear()
  }
}
