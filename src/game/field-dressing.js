import * as T from 'three'

// Footprints below are cosmetic: fixtures stay along facades or at ground level
// and don't create hidden collision in the deterministic simulation.
const HEIGHT = {
  cooler: 0.62,
  bollard: 0.88,
  drain: 0.055,
  manhole: 0.06,
  planter: 0.71,
}
const LIMITS = { low: 45, balanced: 125, high: 200 }
const specs = [
  ['cooler', -11, -9, 0],
  ['bollard', 5, 9.2, 0],
  ['bollard', 7.3, 9.2, 0],
  ['planter', -10, 8.6, 0.4],
  ['drain', -0.37, 10, 0],
  ['manhole', 2.65, -3.25, 0],
  ['cooler', 8.4, -12, Math.PI],
  ['planter', -7.2, 8.6, 0],
]

export function fieldLayout(world) {
  const result = []
  function add(type, x, z, yaw, size = 1) {
    if (Math.abs(x) > world.half - 1 || Math.abs(z) > world.half - 1) return
    result.push({ type, x, z, y: world.height(x, z) + 0.019, yaw, size })
  }
  if (world.kind === 'range') {
    add('planter', -10.2, 11.4, 0)
    add('cooler', -9.8, 7.4, Math.PI / 6)
    add('manhole', -2.4, 7.1, 0)
    add('drain', 4.9, 6.9, 0)
    for (const x of [-9.4, -8.2, 8.4, 9.6]) add('bollard', x, 5, 0)
  } else if (world.kind === 'yard') {
    for (const [i, x] of [-34, -22, -7, 12, 24, 38].entries()) {
      add('bollard', x, i % 2 ? 19 : -15, 0)
      add(i % 2 ? 'drain' : 'manhole', x, i % 2 ? 17 : -13, 0)
      add(i % 2 ? 'planter' : 'cooler', x + 2, i % 2 ? -31 : 30, Math.PI / 2)
    }
  } else {
    for (const s of world.sites)
      for (const [type, x, z, yaw] of specs) add(type, s.x + x, s.z + z, yaw)
  }
  return result
}

const dummy = new T.Object3D()
const box = new T.Box3()
const center = new T.Vector3()
const geometryScale = new T.Vector3()
const composed = new T.Matrix4()
const offset = new T.Matrix4()

export class FieldDressing {
  constructor(scene, world, pool) {
    this.scene = scene
    this.pool = pool
    this.layout = fieldLayout(world)
    this.groups = new Map()
    this.disposed = false
  }

  update(camera, quality) {
    const radius = quality === 'low' ? 82 : 176
    const limit = LIMITS[quality] ?? LIMITS.balanced
    const near = this.layout.filter(
      (i) =>
        Math.abs(i.x - camera.position.x) < radius &&
        Math.abs(i.z - camera.position.z) < radius,
    )
    if (!near.length && !this.groups.size) return
    for (const type of Object.keys(HEIGHT)) {
      const visible = near.filter((p) => p.type === type).slice(0, limit)
      if (!this.groups.has(type)) {
        if (!visible.length) continue
        const asset = this.pool.get(type)
        if (!asset) {
          this.pool.load(type)
          continue
        }
        this.groups.set(type, this.build(type, asset))
      }
      const group = this.groups.get(type)
      for (const { batch } of group.meshes) batch.count = visible.length
      visible.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z)
        dummy.rotation.set(0, p.yaw, 0)
        dummy.scale.setScalar(p.size * group.size)
        dummy.updateMatrix()
        composed.multiplyMatrices(dummy.matrix, group.offset)
        for (const { batch, matrix } of group.meshes)
          batch.setMatrixAt(i, offset.multiplyMatrices(composed, matrix))
      })
      for (const { batch } of group.meshes) {
        batch.instanceMatrix.needsUpdate = true
        batch.visible = visible.length > 0
      }
    }
  }

  build(type, asset) {
    asset.scene.updateMatrixWorld(true)
    box.setFromObject(asset.scene)
    box.getSize(geometryScale)
    box.getCenter(center)
    const size = HEIGHT[type] / Math.max(0.02, geometryScale.y)
    // Surface covers can be nearly flat in their source. Limit their plan size too.
    const scale = ['drain', 'manhole'].includes(type)
      ? Math.min(size, 1.25 / Math.max(geometryScale.x, geometryScale.z))
      : size
    const meshes = []
    asset.scene.traverse((model) => {
      if (!model.isMesh) return
      const batch = new T.InstancedMesh(
        model.geometry,
        model.material,
        LIMITS.high,
      )
      batch.count = 0
      batch.frustumCulled = false
      batch.receiveShadow = true
      batch.instanceMatrix.setUsage(T.DynamicDrawUsage)
      this.scene.add(batch)
      meshes.push({ batch, matrix: model.matrixWorld.clone() })
    })
    return {
      size: scale,
      offset: new T.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z),
      meshes,
    }
  }

  dispose() {
    this.disposed = true
    for (const group of this.groups.values())
      for (const { batch } of group.meshes) {
        batch.removeFromParent()
        batch.dispose()
      }
    this.groups.clear()
  }
}
