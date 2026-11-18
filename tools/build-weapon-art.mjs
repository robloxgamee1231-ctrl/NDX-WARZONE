import { mkdir, writeFile } from 'node:fs/promises'
import * as T from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Original stylized NDX prop geometry. Units are viewmodel units, not fabrication
// dimensions. No textures, rig dependencies, or proprietary models enter these files.
const colors = {
  vm_gunmetal: ['#586468', 0.48, 0.29],
  vm_gundark: ['#343c3e', 0.61, 0.22],
  vm_polymer: ['#40514f', 0.81, 0.035],
  vm_polymerLight: ['#566b62', 0.77, 0.045],
  vm_mag: ['#536560', 0.69, 0.16],
  vm_accent: ['#b98756', 0.53, 0.25],
  Pin: ['#bacbc4', 0.68, 0.17],
  Glass: ['#7facb1', 0.26, 0.17],
}
const palettes = Object.fromEntries(
  Object.entries(colors).map(([name, [color, roughness, metalness]]) => [
    name,
    new T.MeshStandardMaterial({ name, color, roughness, metalness }),
  ]),
)
const P = {
  metal: 'vm_gunmetal',
  dark: 'vm_gundark',
  grip: 'vm_polymer',
  trim: 'vm_polymerLight',
  mag: 'vm_mag',
  accent: 'vm_accent',
  pin: 'Pin',
}

class Prop {
  constructor(name) {
    this.name = name
    this.parts = new Map()
  }
  piece(mat, geo, x, y, z, rx = 0, rz = 0) {
    if (rx) geo.rotateX(rx)
    if (rz) geo.rotateZ(rz)
    geo.translate(x, y, z)
    geo.deleteAttribute('uv')
    if (!this.parts.has(mat)) this.parts.set(mat, [])
    this.parts.get(mat).push(geo)
  }
  box(mat, x, y, z, w, h, d, rx = 0, rz = 0) {
    this.piece(mat, new T.BoxGeometry(w, h, d), x, y, z, rx, rz)
  }
  tube(mat, x, y, z, r0, r1, len, sides = 8) {
    this.piece(
      mat,
      new T.CylinderGeometry(r0, r1, len, sides),
      x,
      y,
      z,
      Math.PI * 0.5,
    )
  }
  finish(muzzle) {
    const stage = new T.Scene()
    stage.name = 'NDX_Original_Art'
    const root = new T.Group()
    root.name = this.name
    stage.add(root)
    for (const [material, group] of this.parts) {
      const mesh = new T.Mesh(mergeGeometries(group), palettes[material])
      mesh.name = `${this.name}_${material}`
      root.add(mesh)
      group.forEach((geo) => geo.dispose())
    }
    const point = new T.Object3D()
    point.name = 'Muzzle'
    point.position.set(...muzzle)
    root.add(point)
    return stage
  }
  dovetail(z, count, dy = 0) {
    const d = count * 0.029
    this.box(P.dark, 0, 0.113 + dy, z - d * 0.5 + 0.014, 0.094, 0.024, d)
    for (let i = 0; i < count; i++)
      this.box(P.metal, 0, 0.128 + dy, z - i * 0.029, 0.102, 0.016, 0.019)
  }
  sights(front, rear, base = 0.124) {
    this.box(P.dark, 0, base + 0.026, front, 0.062, 0.052, 0.031)
    this.box(P.pin, 0, base + 0.055, front - 0.003, 0.012, 0.015, 0.021)
    for (const s of [-1, 1])
      this.box(P.dark, s * 0.036, base + 0.024, rear, 0.025, 0.051, 0.035)
  }
  handle(z, width = 0.071) {
    this.box(P.grip, 0, -0.119, z, width, 0.193, 0.092, -0.226)
    this.box(P.trim, 0, -0.206, z + 0.025, width + 0.006, 0.023, 0.1, -0.226)
    for (let i = 0; i < 5; i++)
      this.box(
        P.dark,
        0,
        -0.08 - i * 0.021,
        z + 0.046 + i * 0.004,
        width + 0.008,
        0.009,
        0.015,
        -0.226,
      )
    this.box(P.dark, 0, -0.084, z - 0.084, width + 0.017, 0.021, 0.156)
    this.box(P.metal, 0, -0.064, z - 0.143, width + 0.012, 0.048, 0.025, -0.32)
  }
  chassis({ width = 0.133, rear = 0.321, body = 0.417, tone = P.grip } = {}) {
    this.box(tone, 0, 0.004, -0.123, width, 0.133, body)
    this.box(P.metal, 0, 0.071, -0.126, width + 0.015, 0.075, body + 0.049)
    this.box(P.dark, 0, -0.017, 0.117, width - 0.014, 0.112, 0.2)
    this.box(P.trim, 0, -0.032, 0.25, width + 0.009, 0.114, rear - 0.14)
    this.box(P.dark, 0, -0.044, rear + 0.006, width + 0.024, 0.159, 0.044)
    this.box(P.metal, 0, -0.098, rear - 0.019, width - 0.013, 0.018, 0.074)
    this.handle(0.025)
    for (const s of [-1, 1]) {
      this.box(
        P.metal,
        s * (width / 2 + 0.006),
        0.02,
        -0.154,
        0.014,
        0.066,
        0.203,
      )
      this.box(
        P.dark,
        s * (width / 2 + 0.014),
        0.029,
        -0.188,
        0.012,
        0.029,
        0.085,
      )
      this.box(
        P.accent,
        s * (width / 2 + 0.023),
        0.032,
        -0.159,
        0.007,
        0.017,
        0.028,
      )
    }
  }
}

function mistral() {
  const p = new Prop('Mistral')
  p.chassis({ width: 0.126, rear: 0.29 })
  p.box(P.trim, 0, 0.022, -0.444, 0.114, 0.1, 0.265)
  p.box(P.metal, 0, -0.034, -0.462, 0.093, 0.028, 0.273)
  for (let i = 0; i < 6; i++)
    for (const s of [-1, 1]) {
      p.box(P.dark, s * 0.057, 0.028, -0.337 - i * 0.036, 0.008, 0.043, 0.024)
      p.box(P.pin, s * 0.062, 0.052, -0.343 - i * 0.036, 0.007, 0.009, 0.019)
    }
  p.tube(P.dark, 0, 0.047, -0.63, 0.021, 0.027, 0.212)
  p.tube(P.metal, 0, 0.047, -0.745, 0.035, 0.03, 0.072, 10)
  p.tube(P.dark, 0, 0.047, -0.784, 0.023, 0.025, 0.012, 10)
  p.box(P.mag, 0, -0.115, -0.215, 0.086, 0.164, 0.102, 0.23)
  p.box(P.mag, 0, -0.19, -0.199, 0.089, 0.033, 0.118, 0.23)
  for (let i = 0; i < 4; i++)
    p.box(
      P.mag,
      0,
      -0.085 - i * 0.03,
      -0.26 + i * 0.006,
      0.095,
      0.009,
      0.021,
      0.23,
    )
  p.dovetail(-0.01, 19)
  p.sights(-0.573, -0.068)
  return p.finish([0, 0.047, -0.793])
}

function bulwark() {
  const p = new Prop('Bulwark')
  p.chassis({ width: 0.186, rear: 0.34, body: 0.486, tone: P.metal })
  p.box(P.trim, 0, 0.047, -0.45, 0.169, 0.127, 0.396)
  p.box(P.dark, 0, -0.027, -0.457, 0.147, 0.034, 0.389)
  for (let i = 0; i < 8; i++)
    for (const s of [-1, 1]) {
      p.box(P.metal, s * 0.087, 0.047, -0.29 - i * 0.045, 0.027, 0.106, 0.03)
      p.box(P.dark, s * 0.103, 0.051, -0.298 - i * 0.045, 0.012, 0.061, 0.018)
    }
  p.tube(P.metal, 0, 0.065, -0.755, 0.033, 0.035, 0.401, 12)
  p.tube(P.dark, 0, 0.065, -0.936, 0.047, 0.041, 0.124, 10)
  p.tube(P.metal, 0, 0.065, -1.007, 0.029, 0.031, 0.019, 10)
  // Broad removable cassette gives the support platform a distinct silhouette.
  p.box(P.mag, -0.023, -0.139, -0.248, 0.204, 0.189, 0.246)
  p.box(P.mag, -0.023, -0.059, -0.248, 0.224, 0.037, 0.255)
  p.box(P.mag, -0.023, -0.228, -0.248, 0.214, 0.027, 0.25)
  for (const s of [-1, 1])
    for (let i = 0; i < 5; i++)
      p.box(
        P.mag,
        -0.023 + s * 0.105,
        -0.146,
        -0.348 + i * 0.049,
        0.017,
        0.119,
        0.019,
      )
  p.box(P.accent, -0.079, -0.044, -0.245, 0.1, 0.043, 0.109)
  for (let j = 0; j < 5; j++)
    p.box(P.accent, -0.064 + j * 0.025, -0.031, -0.232, 0.014, 0.02, 0.06)
  p.dovetail(0.012, 20, 0.013)
  for (const z of [-0.095, -0.331])
    p.box(P.dark, 0.056, 0.165, z, 0.027, 0.102, 0.044)
  p.box(P.dark, 0.056, 0.211, -0.213, 0.027, 0.025, 0.269)
  p.sights(-0.65, -0.055, 0.145)
  p.box(P.dark, 0, -0.064, -0.578, 0.176, 0.04, 0.066)
  for (const s of [-1, 1])
    p.box(P.metal, s * 0.059, -0.107, -0.53, 0.024, 0.059, 0.242, 0.29)
  return p.finish([0, 0.065, -1.022])
}

function harrier() {
  const p = new Prop('Harrier')
  p.chassis({ width: 0.127, rear: 0.302, body: 0.34, tone: P.metal })
  p.tube(P.metal, 0, 0.071, -0.511, 0.042, 0.039, 0.596, 12)
  p.tube(P.dark, 0, 0.071, -0.816, 0.044, 0.04, 0.042, 12)
  p.tube(P.dark, 0, -0.004, -0.48, 0.032, 0.031, 0.414, 10)
  p.tube(P.metal, 0, -0.004, -0.69, 0.04, 0.038, 0.028, 10)
  p.box(P.trim, 0, -0.028, -0.413, 0.153, 0.088, 0.287)
  p.box(P.grip, 0, -0.057, -0.417, 0.135, 0.057, 0.285)
  for (let i = 0; i < 8; i++)
    p.box(P.dark, 0, -0.039, -0.29 - i * 0.033, 0.157, 0.067, 0.012)
  p.box(P.accent, 0, 0.111, -0.545, 0.026, 0.016, 0.439)
  p.box(P.metal, 0, 0.113, -0.106, 0.071, 0.025, 0.211)
  p.sights(-0.749, -0.064, 0.126)
  p.box(P.dark, 0, -0.068, 0.159, 0.095, 0.073, 0.222, -0.11)
  return p.finish([0, 0.071, -0.845])
}

// GLTFExporter's binary serializer uses FileReader in browser builds.
if (!globalThis.FileReader)
  globalThis.FileReader = class FileReader {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result
        this.onloadend?.()
      })
    }
  }

const dir = new URL('../public/models/armory/', import.meta.url)
await mkdir(dir, { recursive: true })
const exporter = new GLTFExporter()
for (const [id, make] of Object.entries({ mistral, bulwark, harrier })) {
  const data = await exporter.parseAsync(make(), { binary: true })
  await writeFile(new URL(`${id}.glb`, dir), new Uint8Array(data))
  console.log(`${id}.glb · ${(data.byteLength / 1024).toFixed(1)} KiB`)
}
