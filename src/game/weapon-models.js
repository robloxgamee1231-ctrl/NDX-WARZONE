import * as T from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { finishStyle } from './loadout.js'

// Anchors describe the imported art, not combat geometry. The simulation and
// ray origin stay unchanged if a model fails to load or a cosmetic is swapped.
const MOUNTS = {
  raven: { size: 1.12, y: -0.039, z: -0.03, sight: 0.203, magazine: 'vm_mag' },
  viper: { size: 1.35, y: 0.005, z: -0.1, sight: 0.242, magazine: 'vm_mag' },
  kestrel: { size: 1.06, y: -0.025, z: -0.1, sight: 0.216 },
  mistral: {
    size: 1.025,
    y: -0.009,
    z: -0.018,
    sight: 0.174,
    magazine: 'vm_mag',
  },
  bulwark: {
    size: 0.96,
    y: -0.018,
    z: -0.022,
    sight: 0.187,
    magazine: 'vm_mag',
  },
  harrier: { size: 1.01, y: -0.005, z: -0.016, sight: 0.18 },
  spectre: {
    size: 0.046,
    y: -0.096,
    z: -0.18,
    rotate: Math.PI / 2,
    sight: 0.045,
  },
}

const FINISH = {
  vm_gundark: ['#424b4e', 0.48, 0.28],
  vm_gunmetal: ['#586568', 0.53, 0.31],
  vm_polymer: ['#3b4844', 0.82, 0.03],
  vm_polymerLight: ['#636b58', 0.86, 0.03],
  vm_mag: ['#495654', 0.71, 0.15],
  vm_accent: ['#ac8256', 0.64, 0.19],
  vm_awpGreen: ['#69745d', 0.66, 0.12],
  vm_awpGreenDark: ['#3f4a3d', 0.81, 0.08],
  Magazine: ['#58615d', 0.64, 0.18],
  Metal: ['#6a7475', 0.58, 0.23],
  Wood: ['#554c3c', 0.82, 0.02],
  DarkerMetal: ['#3f4a4d', 0.51, 0.24],
}

function fieldFinish(source, unit) {
  const data = FINISH[source.name]
  if (!data) return source
  const material = source.clone()
  material.color.set(data[0])
  material.roughness = data[1]
  material.metalness = data[2]
  // Mild machined-grain variation in model space. No per-view texture files.
  material.customProgramCacheKey = () => `ndx-surface-${unit}`
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 ndxSurface;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nndxSurface = position * ${unit.toFixed(3)};`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 ndxSurface;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
      vec3 pos = ndxSurface;
      float dust = fract(sin(dot(floor(pos * 173.5), vec3(11.67, 47.31, 17.9))) * 17198.72);
      float grain = 0.5 + 0.5 * sin(pos.z * 706.0 + pos.y * 138.0);
      diffuseColor.rgb *= .93 + dust * .09 + grain * .065;
    `,
      )
  }
  return material
}

export function mountWeapon(asset, id, rig) {
  const spec = MOUNTS[id]
  if (!spec || !asset) return null
  const art = clone(asset.scene)
  const node = new T.Group()
  const magazine = new T.Group()
  const skeletons = new Set()
  const surfaces = new Map()
  const magazineParts = []
  node.add(art)
  art.position.set(0, spec.y, spec.z)
  art.rotation.y = spec.rotate ?? 0
  art.scale.setScalar(spec.size)
  art.traverse((mesh) => {
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton)
    if (mesh.isMesh) {
      mesh.castShadow = false
      if (!Array.isArray(mesh.material)) {
        if (!surfaces.has(mesh.material))
          surfaces.set(mesh.material, fieldFinish(mesh.material, spec.size))
        mesh.material = surfaces.get(mesh.material)
      }
      if (
        spec.magazine &&
        mesh.material?.name === spec.magazine &&
        !mesh.isSkinnedMesh
      )
        magazineParts.push(mesh)
    }
  })
  node.add(magazine)
  node.updateMatrixWorld(true)
  for (const part of magazineParts) magazine.attach(part)
  const muzzleObject = art.getObjectByName('Muzzle')
  const muzzle = muzzleObject
    ? muzzleObject.getWorldPosition(new T.Vector3())
    : new T.Vector3(0, 0.045, -0.82)
  // Models can ship an emissive muzzle helper; the view rig has its own flash.
  if (muzzleObject?.isMesh) muzzleObject.visible = false
  const mixer = asset.animations.length ? new T.AnimationMixer(art) : null
  const clips = new Map(
    asset.animations.map((clip) => [clip.name.split('|').at(-1), clip]),
  )
  rig.gun.visible = false
  rig.root.add(node)
  rig.flame.removeFromParent()
  node.add(rig.flame)
  rig.flame.position.copy(muzzle)
  return {
    node,
    art,
    mixer,
    clips,
    magazine,
    muzzle,
    sight: spec.sight,
    action: null,
    skeletons,
    surfaces,
    appliedFinish: null,
  }
}

const tone = new T.Color()
const gripNames = new Set([
  'vm_polymer',
  'vm_polymerLight',
  'vm_awpGreen',
  'vm_awpGreenDark',
  'Wood',
  'Metal',
  'vm_gunmetal',
])

export function applyWeaponFinish(visual, id, time = 0) {
  if (!visual) return
  const skin = finishStyle(id) ?? finishStyle('issue')
  if (visual.appliedFinish === skin.id && skin.effect !== 'pulse') return
  visual.appliedFinish = skin.id
  for (const [original, surface] of visual.surfaces) {
    if (original === surface) continue
    const name = original.name,
      base = FINISH[name]
    if (!base) continue
    surface.color.set(base[0])
    if (surface.emissive) {
      surface.emissive.copy(original.emissive)
      surface.emissiveIntensity = original.emissiveIntensity
      if (
        skin.effect === 'pulse' &&
        (name === 'vm_accent' || name === 'vm_gundark')
      ) {
        surface.emissive.set(skin.trim)
        surface.emissiveIntensity =
          0.08 + 0.075 * (0.5 + 0.5 * Math.sin(time * 4.3))
      }
    }
    if (skin.id !== 'issue') {
      const main = gripNames.has(name)
      surface.color.lerp(
        tone.set(main ? skin.body : skin.trim),
        main ? 0.85 : 0.52,
      )
    }
  }
}

export function animateWeapon(visual, event, timeScale = 1) {
  if (!visual?.mixer) return
  const name = event === 'shot' ? 'Fire' : event === 'reload' ? 'Reload' : null
  const clip = visual.clips.get(name)
  if (!clip) return
  visual.action?.stop()
  const action = visual.mixer.clipAction(clip).reset().setLoop(T.LoopOnce, 1)
  action.timeScale = timeScale
  action.play()
  visual.action = action
}

export function disposeWeapon(visual) {
  if (!visual) return
  visual.mixer?.stopAllAction()
  visual.mixer?.uncacheRoot(visual.art)
  visual.node.removeFromParent()
  for (const skeleton of visual.skeletons) skeleton.dispose()
  for (const [base, finish] of visual.surfaces)
    if (base !== finish) finish.dispose()
}
