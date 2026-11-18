import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { disposeScene } from './graphics.js'
import { assetUrl } from '../site.js'

export const MODEL_FILES = Object.freeze({
  neon: 'maps/neon-district.glb',
  warden: 'operators/warden.glb',
  nomad: 'operators/nomad.glb',
  raven: 'armory/raven.glb',
  viper: 'armory/viper.glb',
  kestrel: 'armory/kestrel.glb',
  mistral: 'armory/mistral.glb',
  bulwark: 'armory/bulwark.glb',
  harrier: 'armory/harrier.glb',
  spectre: 'armory/spectre.glb',
  cooler: 'field/cooler.glb',
  bollard: 'field/bollard.glb',
  drain: 'field/drain.glb',
  manhole: 'field/manhole.glb',
  planter: 'field/planter.glb',
})

// The pool owns original GPU resources. Consumers only own transforms and mixers.
// Use one pool per renderer so an old session cannot dispose a new mission's models.
export class ModelPool {
  constructor({
    loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),
    base = assetUrl('models/'),
  } = {}) {
    this.loader = loader
    this.base = base
    this.entries = new Map()
    this.closed = false
  }

  load(id) {
    if (this.closed || !Object.hasOwn(MODEL_FILES, id))
      return Promise.resolve(null)
    if (!this.entries.has(id)) {
      const entry = { value: null, promise: null }
      entry.promise = Promise.resolve()
        .then(() =>
          this.closed
            ? null
            : this.loader.loadAsync(this.base + MODEL_FILES[id]),
        )
        .then((asset) => {
          if (!asset) return null
          if (this.closed) {
            disposeScene(asset.scene)
            return null
          }
          entry.value = asset
          return asset
        })
        .catch(() => null) // A missing asset must not block an operation.
      this.entries.set(id, entry)
    }
    return this.entries.get(id).promise
  }

  get(id) {
    return this.entries.get(id)?.value ?? null
  }

  dispose() {
    this.closed = true
    disposeScene(
      ...Array.from(this.entries.values(), ({ value }) => value?.scene).filter(
        Boolean,
      ),
    )
    this.entries.clear()
  }
}
