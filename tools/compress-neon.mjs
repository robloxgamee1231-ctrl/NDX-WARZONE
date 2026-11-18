import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, weld } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import { stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(
  new URL('../out/ndx-assets/neon-district.glb', import.meta.url),
)
const target = fileURLToPath(
  new URL('../public/models/maps/neon-district.glb', import.meta.url),
)
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
await MeshoptEncoder.ready
const doc = await io.read(source)
await doc.transform(
  weld(),
  dedup(),
  prune(),
  meshopt({
    encoder: MeshoptEncoder,
    level: 'medium',
    quantizePosition: 16,
    quantizeTexcoord: 16,
  }),
)
await io.write(target, doc)
const a = (await stat(source)).size,
  b = (await stat(target)).size
console.log(
  `Neon District GLB: ${(a / 1024).toFixed(0)} KiB -> ${(b / 1024).toFixed(0)} KiB with EXT_meshopt_compression`,
)
