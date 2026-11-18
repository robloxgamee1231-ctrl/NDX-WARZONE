import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from 'three'
import { ModelPool } from '../src/game/assets.js'
import { OperatorRigs } from '../src/game/operator-rig.js'
import { forward } from '../src/game/movement.js'
import {
  animateWeapon,
  applyWeaponFinish,
  disposeWeapon,
  mountWeapon,
} from '../src/game/weapon-models.js'
import { auditModels, parseGlb } from '../tools/check-models.mjs'
import { physicalLines } from '../tools/measure-source.mjs'

function sampleAsset() {
  const group = new Group()
  const mat = new MeshBasicMaterial()
  const geo = new BoxGeometry()
  const entry = { scene: group, animations: [] }
  let disposals = 0
  mat.addEventListener('dispose', () => disposals++)
  geo.addEventListener('dispose', () => disposals++)
  group.add(new Mesh(geo, mat))
  return { entry, count: () => disposals }
}

test('the 14-model pack contains valid local GLBs, animation sets, credits, and bounded dependencies', async () => {
  const report = await auditModels()
  assert.equal(report.entries.length, 14)
  assert.equal(report.files, 23)
  assert.equal(report.entries.find((e) => e.id === 'warden').clips, 17)
  assert.equal(report.entries.find((e) => e.id === 'spectre').clips, 3)
  assert.ok(report.total < 3_350_000)
  assert.throws(() => parseGlb(Buffer.from('glTF')), /truncated/)
})

test('the renderer pool deduplicates loading, rejects bad IDs and disposes shared original resources once', async () => {
  let file,
    calls = 0
  const { entry, count } = sampleAsset()
  const loader = {
    loadAsync: async (url) => {
      calls++
      file = url
      return entry
    },
  }
  const pool = new ModelPool({ loader })
  const first = pool.load('warden')
  const second = pool.load('warden')
  assert.equal(first, second)
  assert.equal(pool.get('warden'), null)
  assert.equal(await first, entry)
  assert.equal(calls, 1)
  assert.equal(file, '/models/operators/warden.glb')
  assert.equal(pool.get('warden'), entry)
  assert.equal(await pool.load('__proto__'), null)
  pool.dispose()
  pool.dispose()
  assert.equal(count(), 2)
  assert.equal(await pool.load('viper'), null)
})

test('failed assets remain a stable fallback, and late completions cannot resurrect a closed renderer', async () => {
  let failCalls = 0
  const fallback = new ModelPool({
    loader: {
      loadAsync: async () => {
        failCalls++
        throw new Error('offline')
      },
    },
  })
  assert.equal(await fallback.load('raven'), null)
  assert.equal(await fallback.load('raven'), null)
  assert.equal(failCalls, 1)
  let finish
  const pending = new ModelPool({
    loader: {
      loadAsync: () =>
        new Promise((r) => {
          finish = r
        }),
    },
  })
  const request = pending.load('kestrel')
  await Promise.resolve()
  pending.dispose()
  const { entry, count } = sampleAsset()
  finish(entry)
  assert.equal(await request, null)
  assert.equal(pending.get('kestrel'), null)
  assert.equal(count(), 2)
})

test('source counter handles empty and mixed-ending authored files', () => {
  assert.equal(physicalLines(''), 0)
  assert.equal(physicalLines('\n'), 1)
  assert.equal(physicalLines('a\r\nb\nc'), 3)
  assert.equal(physicalLines('a\nb\n'), 2)
})

async function parseLocalAsset(relative) {
  const file = await readFile(
    new URL(`../public/models/${relative}`, import.meta.url),
  )
  const bytes = file.buffer.slice(
    file.byteOffset,
    file.byteOffset + file.byteLength,
  )
  return new GLTFLoader().parseAsync(bytes, '')
}

function bonesIn(root) {
  let bones
  root.traverse((node) => {
    if (!bones && node.isSkinnedMesh) bones = node.skeleton.bones
  })
  return bones
}

test('an imported operator keeps field yaw in all quadrants, animates a cloned rig, and swaps carried weapon art', async () => {
  const pool = new ModelPool({
    loader: { loadAsync: (url) => parseLocalAsset(url.split('/models/')[1]) },
  })
  const scene = new Scene()
  const rigs = new OperatorRigs(scene, pool)
  try {
    const asset = await pool.load('warden')
    assert.ok(asset)
    const self = { id: 'self', team: 0 }
    const same = {
      id: 'a',
      x: 1,
      y: 0,
      z: -3,
      yaw: 2.4,
      air: 'ground',
      alive: true,
      stance: 'stand',
      team: 0,
      weapon: 'raven',
      operator: 'warden',
      vx: 0,
      vz: 9,
      shotAt: -1,
    }
    const second = { ...same, id: 'b', x: -1, yaw: -2.8 }
    const camera = { position: new Vector3() }
    const actives = rigs.update(
      [same, second],
      camera,
      self,
      self.id,
      0,
      0.04,
      'low',
    )
    assert.deepEqual([...actives], ['a', 'b'])
    const slots = [rigs.slots.get(same.id), rigs.slots.get(second.id)]
    for (const [i, p] of [same, second].entries()) {
      const slot = slots[i]
      const modelForward = new Vector3(0, 0, 1)
        .applyQuaternion(slot.rig.quaternion)
        .applyQuaternion(slot.root.quaternion)
      const expectForward = forward(p.yaw)
      assert.ok(Math.abs(modelForward.x - expectForward.x) < 1e-6)
      assert.ok(Math.abs(modelForward.z - expectForward.z) < 1e-6)
      assert.equal(slot.clip, 'Run_Gun')
      assert.ok(slot.action.isRunning())
      assert.ok(slot.weapons.get('AK').visible)
      assert.equal(slot.weapons.get('Pistol').visible, false)
    }
    const originalBone = bonesIn(asset.scene)[0]
    assert.notEqual(bonesIn(slots[0].rig)[0], originalBone)
    assert.notEqual(bonesIn(slots[0].rig)[0], bonesIn(slots[1].rig)[0])
    same.weapon = 'spectre'
    same.stance = 'crouch'
    rigs.update([same], camera, self, self.id, 0.3, 0.05, 'low')
    assert.equal(slots[0].clip, 'Duck')
    assert.equal(slots[0].weapons.get('AK').visible, false)
    assert.ok(slots[0].weapons.get('Pistol').visible)
    assert.equal(slots[1].root.visible, false)
    rigs.update(
      [same, { ...second, id: 'c' }],
      camera,
      self,
      self.id,
      0.5,
      0.04,
      'low',
    )
    assert.equal(
      rigs.slots.get('c'),
      slots[1],
      'an idle skin instance is reused',
    )
  } finally {
    rigs.dispose()
    pool.dispose()
  }
  assert.equal(scene.children.length, 0)
})

test('Spectre GLB mounts the real pistol and advances both shot and reload animation clips', async () => {
  const pool = new ModelPool({
    loader: { loadAsync: (url) => parseLocalAsset(url.split('/models/')[1]) },
  })
  const rig = { root: new Group(), gun: new Group(), flame: new Group() }
  rig.root.add(rig.gun, rig.flame)
  const asset = await pool.load('spectre')
  const model = mountWeapon(asset, 'spectre', rig)
  try {
    assert.ok(model)
    assert.equal(rig.gun.visible, false)
    assert.equal(rig.flame.parent, model.node)
    assert.ok(model.muzzle.z < -0.35)
    assert.ok(bonesIn(model.art).length > 0)
    animateWeapon(model, 'shot')
    assert.equal(model.action.getClip().name, 'PistolArmature|Fire')
    model.mixer.update(0.09)
    assert.ok(model.action.time >= 0.09)
    animateWeapon(model, 'reload', 0.5)
    assert.equal(model.action.getClip().name, 'PistolArmature|Reload')
    model.mixer.update(0.2)
    assert.ok(Math.abs(model.action.time - 0.1) < 1e-6)
  } finally {
    disposeWeapon(model)
    pool.dispose()
  }
  assert.equal(model.node.parent, null)
})

test('original first-person weapons mount at their muzzle anchors and change finishes without recoloring shared art', async () => {
  for (const id of ['mistral', 'bulwark', 'harrier']) {
    const asset = await parseLocalAsset(`armory/${id}.glb`)
    const rig = { root: new Group(), gun: new Group(), flame: new Group() }
    rig.root.add(rig.gun, rig.flame)
    const visual = mountWeapon(asset, id, rig)
    try {
      assert.ok(visual?.muzzle.z < -0.65, id)
      assert.ok(rig.flame.position.equals(visual.muzzle))
      assert.equal(rig.gun.visible, false)
      if (id !== 'harrier') assert.ok(visual.magazine.children.length > 0)
      const [original, surface] = [...visual.surfaces].find(
        ([mat]) => mat.name === 'vm_gunmetal',
      )
      assert.notEqual(original, surface)
      const base = surface.color.clone(),
        shared = original.color.clone()
      applyWeaponFinish(visual, 'orchid')
      const orchid = surface.color.clone()
      assert.ok(!orchid.equals(base))
      assert.ok(orchid.equals(base.clone().lerp(new Color('#685e91'), 0.85)))
      applyWeaponFinish(visual, 'frost')
      assert.ok(!surface.color.equals(orchid))
      applyWeaponFinish(visual, 'issue')
      assert.ok(surface.color.equals(base))
      assert.ok(original.color.equals(shared))
    } finally {
      disposeWeapon(visual)
    }
  }
})

test('operator skins tint only cloned materials; the animated support crew carries no weapon', async () => {
  const pool = new ModelPool({
    loader: { loadAsync: (url) => parseLocalAsset(url.split('/models/')[1]) },
  })
  const scene = new Scene(),
    rigs = new OperatorRigs(scene, pool)
  try {
    await pool.load('warden')
    const player = { id: 'self', team: 0 }
    const base = {
      id: 'standard',
      team: 0,
      x: 1,
      y: 0,
      z: -3,
      yaw: 0,
      air: 'ground',
      alive: true,
      weapon: 'raven',
      operator: 'warden',
      vx: 0,
      vz: 0,
      shotAt: -9,
    }
    const npc = {
      ...base,
      id: 'coach',
      x: -1,
      team: -1,
      npc: true,
      operator: 'tidewatch',
      weapon: null,
    }
    const camera = { position: new Vector3() }
    rigs.update([base, npc], camera, player, player.id, 2, 0.12, 'low')
    const plain = rigs.slots.get(base.id),
      colored = rigs.slots.get(npc.id)
    assert.ok(plain && colored)
    assert.equal(colored.clip, 'Idle')
    assert.ok(colored.action.isRunning())
    assert.ok([...colored.weapons.values()].every((w) => !w.visible))
    assert.ok(plain.weapons.get('AK').visible)
    const dye = [...colored.dyed].find(([mat]) => mat.name === 'Character_Main')
    assert.ok(dye)
    assert.notEqual(dye[0], dye[1])
    assert.ok(dye[1].color.equals(new Color('#3b7380')))
    assert.ok(!dye[0].color.equals(dye[1].color))
    rigs.update(
      [base, { ...npc, operator: 'alpine', wave: true }],
      camera,
      player,
      player.id,
      2.1,
      0.12,
      'low',
    )
    const alpine = rigs.slots.get(npc.id)
    assert.notEqual(alpine, colored)
    assert.equal(alpine.clip, 'Wave')
    assert.ok(alpine.action.isRunning())
    assert.equal(colored.root.visible, false)
  } finally {
    rigs.dispose()
    pool.dispose()
  }
  assert.equal(scene.children.length, 0)
})
