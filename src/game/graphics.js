import * as T from 'three'
import { randomSource } from './world.js'

export function canvasTexture(w, h, draw, tiled = false) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  draw(canvas.getContext('2d'), w, h)
  const tex = new T.CanvasTexture(canvas)
  tex.colorSpace = T.SRGBColorSpace
  if (tiled) {
    tex.wrapS = tex.wrapT = T.RepeatWrapping
    tex.anisotropy = 4
  }
  return tex
}

export function surface(kind, base, seed = 1) {
  const rand = randomSource(seed)
  return canvasTexture(
    128,
    128,
    (ctx, w, h) => {
      ctx.fillStyle = base
      ctx.fillRect(0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h)
      for (let y = 0; y < w; y++)
        for (let x = 0; x < h; x++) {
          const i = (y * w + x) * 4
          const low =
            Math.sin(x * 0.109 + Math.cos(y * 0.25) * 0.9) +
            Math.cos(y * 0.093 - x * 0.15)
          const d = (rand() - 0.5) * (kind === 'ground' ? 49 : 30) + low * 4.2
          data.data[i] += d
          data.data[i + 1] += d
          data.data[i + 2] += d
        }
      ctx.putImageData(data, 0, 0)
      for (let i = 0; i < 150; i++) {
        const x = rand() * w,
          y = rand() * h,
          pale = rand() > 0.46
        ctx.fillStyle = pale
          ? `rgba(241,232,215,${rand() * 0.16})`
          : `rgba(19,21,18,${rand() * 0.19})`
        ctx.fillRect(
          x,
          y,
          rand() * (kind === 'ground' ? 4 : 8) + 0.2,
          rand() * 2 + 0.2,
        )
      }
      if (kind === 'metal' || kind === 'siding') {
        const pitch = kind === 'metal' ? 13 : 23
        for (let x = 2; x < 128; x += pitch) {
          const grad = ctx.createLinearGradient(x, 0, x + 6, 0)
          grad.addColorStop(0, '#0005')
          grad.addColorStop(0.26, '#0006')
          grad.addColorStop(0.42, '#d6e8e834')
          grad.addColorStop(1, '#a0b4c700')
          ctx.fillStyle = grad
          ctx.fillRect(x, 0, 6, h)
        }
      }
      if (kind === 'wood')
        for (let i = 0; i < 32; i++) {
          const y = rand() * h
          ctx.strokeStyle = i % 2 ? '#171d1766' : '#d9c5a84f'
          ctx.lineWidth = rand() * 1.3 + 0.17
          ctx.beginPath()
          ctx.moveTo(0, y)
          ctx.bezierCurveTo(
            w * 0.3,
            y + rand() * 8,
            w * 0.7,
            y - rand() * 7,
            w,
            y,
          )
          ctx.stroke()
        }
      if (kind === 'ground')
        for (let i = 0; i < 650; i++) {
          const s = 0.2 + rand() * 2.8
          ctx.fillStyle = i % 3 ? '#26332137' : '#e9dab176'
          ctx.fillRect(rand() * w, rand() * h, s, s * 0.47)
        }
      if (kind === 'concrete' || kind === 'plaster')
        for (let i = 0; i < 17; i++) {
          const x = rand() * w,
            y = rand() * h,
            rad = rand() * 28 + 3
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
          g.addColorStop(0, i % 3 ? '#283a3c32' : '#eae3c126')
          g.addColorStop(1, '#87968f00')
          ctx.fillStyle = g
          ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2)
        }
    },
    true,
  )
}

export const cube = () => new T.BoxGeometry(1, 1, 1)
export const mesh = (geo, material, group, x = 0, y = 0, z = 0) => {
  const m = new T.Mesh(geo, material)
  m.position.set(x, y, z)
  group.add(m)
  return m
}
export function box(group, material, w, h, d, x = 0, y = 0, z = 0) {
  return mesh(new T.BoxGeometry(w, h, d), material, group, x, y, z)
}
export function material(
  color,
  roughness = 0.77,
  metalness = 0.03,
  map = null,
) {
  return new T.MeshStandardMaterial({ color, roughness, metalness, map })
}
export function disposeScene(...scenes) {
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set()
  for (const scene of scenes)
    scene.traverse((obj) => {
      if (obj.geometry) geometries.add(obj.geometry)
      if (obj.material)
        for (const m of [].concat(obj.material)) materials.add(m)
    })
  for (const geo of geometries) geo.dispose()
  for (const m of materials) {
    for (const value of Object.values(m))
      if (value?.isTexture) textures.add(value)
    m.dispose()
  }
  for (const tex of textures) tex.dispose()
}
