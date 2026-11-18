import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MODEL_FILES } from '../src/game/assets.js'

const root = fileURLToPath(new URL('../public/models/', import.meta.url))
const OPTIONAL = new Set(['warden', 'nomad'])
const PACK_LIMIT = 4_200_000
const MAP_LIMIT = 560_000
const CUSTOM_ARMORY = new Set(['mistral', 'bulwark', 'harrier'])
const RIG_CLIPS = [
  'Idle_Shoot',
  'Duck',
  'Jump_Idle',
  'Run_Shoot',
  'Run_Gun',
  'Walk_Shoot',
]
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

export function parseGlb(bytes) {
  assert.ok(bytes.length >= 24, 'truncated GLB')
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', 'missing glTF magic')
  assert.equal(bytes.readUInt32LE(4), 2, 'version must be glTF 2')
  assert.equal(bytes.readUInt32LE(8), bytes.length, 'invalid document length')
  let json = null
  let binSize = 0
  let cursor = 12
  while (cursor < bytes.length) {
    assert.ok(cursor + 8 <= bytes.length, 'truncated chunk header')
    const size = bytes.readUInt32LE(cursor),
      kind = bytes.readUInt32LE(cursor + 4)
    assert.equal(size % 4, 0, 'unaligned GLB chunk')
    const from = cursor + 8,
      through = from + size
    assert.ok(through <= bytes.length, 'truncated chunk payload')
    if (kind === JSON_CHUNK) {
      assert.equal(cursor, 12, 'the JSON chunk must be first')
      json = JSON.parse(bytes.toString('utf8', from, through))
    } else if (kind === BIN_CHUNK) {
      assert.equal(binSize, 0, 'duplicate BIN chunk')
      binSize = size
    }
    cursor = through
  }
  assert.equal(json?.asset?.version, '2.0')
  assert.ok(
    json.scenes?.length > 0 && json.meshes?.length > 0,
    'expected at least one renderable scene',
  )
  assert.ok(
    binSize > 0 && json.buffers?.[0]?.byteLength <= binSize,
    'missing binary mesh payload',
  )
  return json
}

async function dependencies(json, file, sizes, rootDir) {
  for (const part of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!part.uri) continue
    assert.match(part.uri, /^[A-Za-z0-9_./-]+$/u, 'asset URI must be local')
    assert.notEqual(part.uri[0], '/', 'use a model-relative URI')
    const full = resolve(dirname(file), part.uri)
    const name = relative(rootDir, full)
    assert.ok(
      name && !name.startsWith('..'),
      'asset dependency escapes model root',
    )
    if (sizes.has(name)) continue
    const item = await stat(full)
    assert.ok(
      item.isFile() && item.size > 0,
      `missing or empty model dependency: ${name}`,
    )
    sizes.set(name, item.size)
  }
}

function clipsFor(json) {
  return new Set(json.animations?.map((a) => a.name) ?? [])
}

function estimateTriangles(json) {
  let tris = 0
  for (const mesh of json.meshes)
    for (const part of mesh.primitives ?? []) {
      if (part.mode !== undefined && part.mode !== 4) continue
      const data = json.accessors?.[part.indices ?? part.attributes?.POSITION]
      tris += Math.floor((data?.count ?? 0) / 3)
    }
  return tris
}

export async function auditModels(rootDir = root) {
  const sizes = new Map(),
    entries = []
  for (const [id, name] of Object.entries(MODEL_FILES)) {
    const path = resolve(rootDir, name)
    const bytes = await readFile(path)
    sizes.set(name, bytes.length)
    const json = parseGlb(bytes)
    await dependencies(json, path, sizes, rootDir)
    const tris = estimateTriangles(json)
    assert.ok(tris > 0 && tris < 42_000, `${name}: expected low-poly art`)
    if (OPTIONAL.has(id)) {
      assert.ok(json.skins?.length > 0, `${name}: missing skin`)
      const clips = clipsFor(json)
      for (const name of RIG_CLIPS)
        assert.ok(clips.has(name), `rig missing ${name}`)
    }
    if (CUSTOM_ARMORY.has(id)) {
      assert.ok(
        bytes.length < 90_000 && tris < 4000,
        `original field weapon exceeds FPS budget: ${id}`,
      )
      assert.ok(
        json.nodes.some((n) => n.name === 'Muzzle'),
        `${id}: muzzle anchor missing`,
      )
      assert.ok(
        !json.images?.length,
        `${id}: original prop must not depend on texture fetches`,
      )
    }
    if (id === 'spectre') {
      const clips = clipsFor(json)
      for (const name of ['Fire', 'Reload'])
        assert.ok(
          [...clips].some((clip) => clip.endsWith(`|${name}`)),
          `sidearm missing ${name}`,
        )
    }
    entries.push({
      id,
      bytes: bytes.length,
      triangles: tris,
      clips: json.animations?.length ?? 0,
    })
  }
  const total = [...sizes.values()].reduce((a, b) => a + b, 0)
  const atlases = [...sizes]
    .filter(([name]) => name.endsWith('.jpg'))
    .reduce((t, [, bytes]) => t + bytes, 0)
  assert.ok(atlases <= MAP_LIMIT, `texture budget exceeded: ${atlases}`)
  assert.ok(total <= PACK_LIMIT, `model-pack budget exceeded: ${total}`)
  const notice = await readFile(resolve(rootDir, 'CREDITS.md'), 'utf8')
  const isc = await readFile(resolve(rootDir, 'ISC-Tiny-Strike.txt'), 'utf8')
  for (const license of ['ISC', 'CC0', 'CC BY 3.0', 'NDX original'])
    assert.ok(notice.includes(license), `missing ${license} notice`)
  assert.match(isc, /permission to use, copy, modify/i)
  return { entries, total, atlases, files: sizes.size }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const report = await auditModels()
  console.table(report.entries)
  console.log(
    `${report.entries.length} GLBs · ${report.files} files including texture dependencies · ${(report.total / 1024 / 1024).toFixed(2)} MiB · atlas ${(report.atlases / 1024).toFixed(0)} KiB`,
  )
}
