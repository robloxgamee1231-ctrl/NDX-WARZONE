import { SERVICES } from './support.js'
import { LOOT } from '../config.js'
import { insideSmoke } from './tactics.js'
import { distance, planeAt, clamp } from './world.js'

export class MapView {
  constructor(world) {
    this.world = world
    const base = (this.base = document.createElement('canvas'))
    base.width = base.height = 300
    const c = base.getContext('2d'),
      r = world.kind === 'ridge' ? world.half * 1.43 : world.half * 1.9
    this.r = r
    const pixels = c.createImageData(300, 300)
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 300; x++) {
        const a = (x / 300 - 0.5) * r * 2,
          b = (y / 300 - 0.5) * r * 2,
          h = world.height(a, b)
        const h2 = world.height(a + 1.2, b + 1.4),
          edge = Math.abs(h / 5 - Math.round(h / 5))
        const d =
          Math.min(44, h * 0.58) +
          Math.sin(a * 0.047 + b * 0.034) * 3 +
          (h - h2) * 17 +
          (edge < 0.082 ? 6 : 0)
        const i = (y * 300 + x) * 4
        pixels.data[i] = 18 + d * 0.73
        pixels.data[i + 1] = 29 + d * 0.94
        pixels.data[i + 2] = 32 + d * 0.83
        pixels.data[i + 3] = 255
      }
    c.putImageData(pixels, 0, 0)
    const cv = (x) => ((x / r) * 0.5 + 0.5) * 300
    for (const road of world.roads) {
      c.strokeStyle = '#57727489'
      c.lineWidth = Math.max(1, (road.width / r) * 143)
      c.beginPath()
      for (const [i, [x, z]] of road.points.entries())
        c[i ? 'lineTo' : 'moveTo'](cv(x), cv(z))
      c.stroke()
    }
    c.fillStyle = '#a5b3a083'
    for (const b of world.boxes)
      if (
        ['roof', 'teal', 'rust', 'siding'].includes(b.mat) &&
        b.w > 1 &&
        b.d > 1
      )
        c.fillRect(
          cv(b.x - b.w / 2),
          cv(b.z - b.d / 2),
          (b.w / r) * 150,
          (b.d / r) * 150,
        )
  }
  draw(canvas, snap, me, p, large = false) {
    if (!p || !canvas) return
    const ctx = canvas.getContext('2d'),
      w = canvas.width,
      h = canvas.height,
      r = this.r,
      air = p.air === 'plane'
    const span =
      large || air
        ? this.world.half * 2.24
        : this.world.kind === 'ridge'
          ? p.air === 'ground'
            ? 147
            : 245
          : 61
    const cx = large || air ? 0 : p.x,
      cz = large || air ? 0 : p.z,
      scale = w / span
    const x = (a) => (a - cx) * scale + w / 2,
      z = (b) => (b - cz) * scale + h / 2
    if (large) this.bounds = { span, cx, cz, w, h, scale }
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#111c23'
    ctx.fillRect(0, 0, w, h)
    const sourceW = (this.base.width * span) / (r * 2),
      sourceH = (sourceW * h) / w
    ctx.drawImage(
      this.base,
      ((cx / r) * 0.5 + 0.5) * 300 - sourceW / 2,
      ((cz / r) * 0.5 + 0.5) * 300 - sourceH / 2,
      sourceW,
      sourceH,
      0,
      0,
      w,
      h,
    )
    ctx.strokeStyle = '#b2d2d01b'
    ctx.lineWidth = 1
    for (let i = 1; i < 6; i++) {
      ctx.beginPath()
      ctx.moveTo((i * w) / 6, 0)
      ctx.lineTo((i * w) / 6, h)
      ctx.moveTo(0, (i * h) / 6)
      ctx.lineTo(w, (i * h) / 6)
      ctx.stroke()
    }
    if (snap.gas) {
      const g = snap.gas
      ctx.save()
      ctx.fillStyle = '#979e4239'
      ctx.beginPath()
      ctx.rect(0, 0, w, h)
      ctx.arc(x(g.x), z(g.z), g.r * scale, 0, Math.PI * 2, true)
      ctx.fill('evenodd')
      ctx.strokeStyle = '#b5c27a'
      ctx.lineWidth = large ? 2.2 : 1.9
      ctx.beginPath()
      ctx.arc(x(g.x), z(g.z), g.r * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = '#d5e8e2b8'
      ctx.setLineDash([6, 5])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x(g.nx), z(g.nz), g.nr * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
    if (air) {
      const a = planeAt(0, this.world),
        b = planeAt(17.5, this.world)
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(x(a.x), z(a.z))
      ctx.lineTo(x(b.x), z(b.z))
      ctx.strokeStyle = '#b2ebefbe'
      ctx.lineWidth = 1.7
      ctx.setLineDash([5, 5])
      ctx.stroke()
      ctx.restore()
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `600 ${large ? 14 : 11}px "IBM Plex Mono",monospace`
    if (large || air || this.world.kind === 'ridge')
      for (const s of this.world.sites) {
        if (!large && !air && distance(p, s) > 78) continue
        const X = x(s.x),
          Y = z(s.z)
        ctx.strokeStyle = '#101b22'
        ctx.lineWidth = 4
        ctx.strokeText(s.name, X, Y - 8)
        ctx.fillStyle = large ? '#e2eddf' : '#aebdb3'
        ctx.fillText(s.name, X, Y - 8)
      }
    for (const l of snap.loot.values()) {
      if (
        l.removed ||
        (l.type === 'supply' && l.opened) ||
        !['station', 'contract', 'dummy', 'reset', 'supply'].includes(l.type)
      )
        continue
      const a = x(l.x),
        b = z(l.z),
        size = large ? 5.5 : 3.5
      if (a < 5 || a > w - 5 || b < 5 || b > h - 5) continue
      ctx.fillStyle = LOOT[l.type].hex
      ctx.strokeStyle = '#16282c'
      ctx.lineWidth = 2
      if (l.type === 'station' || l.type === 'dummy' || l.type === 'reset') {
        ctx.strokeRect(a - size, b - size, size * 2, size * 2)
        ctx.fillRect(a - size, b - size, size * 2, size * 2)
        ctx.clearRect(a - 1, b - 1, 2, 2)
      } else {
        ctx.beginPath()
        ctx.moveTo(a, b - size - 1)
        ctx.lineTo(a + size + 1, b)
        ctx.lineTo(a, b + size + 1)
        ctx.lineTo(a - size - 1, b)
        ctx.closePath()
        ctx.stroke()
        ctx.fill()
      }
    }
    for (const npc of this.world.staff) {
      const a = x(npc.x),
        b = z(npc.z)
      if (a < 4 || a > w - 4 || b < 4 || b > h - 4) continue
      const service = SERVICES[npc.kind],
        size = large ? 4.8 : 3.7
      ctx.lineWidth = 1.7
      ctx.strokeStyle = '#12212a'
      ctx.fillStyle =
        me && me.services & service.flag ? '#667986' : service.tint
      ctx.beginPath()
      for (let i = 0; i < 6; i++) {
        const r = (i / 6) * Math.PI * 2
        ctx[i ? 'lineTo' : 'moveTo'](
          a + Math.cos(r) * size,
          b + Math.sin(r) * size,
        )
      }
      ctx.closePath()
      ctx.stroke()
      ctx.fill()
      if (large) {
        ctx.font = '600 9px monospace'
        ctx.fillText(service.title.toUpperCase(), a, b + 12)
      }
    }
    this.drawObjectives(ctx, snap, me, x, z, scale, large)
    if (me?.contract) {
      const c = me.contract,
        X = x(c.x),
        Y = z(c.z)
      ctx.strokeStyle = '#f4d27b'
      ctx.lineWidth = 2.4
      ctx.strokeRect(X - 6, Y - 6, 12, 12)
    }
    const exposed = new Set(
      snap.contacts instanceof Map
        ? (snap.contacts.get(me.team)?.keys() ?? [])
        : (snap.contacts ?? []),
    )
    for (const q of snap.players) {
      if (q.id === p.id || !q.alive || q.air === 'plane') continue
      const allied = q.team === me?.team
      if (
        !allied &&
        !exposed.has(q.id) &&
        (snap.time - q.shotAt > 1.45 ||
          distance(p, q) > span * 0.51 ||
          insideSmoke(snap.fields ?? [], snap.time, q))
      )
        continue
      const a = x(q.x),
        b = z(q.z)
      if (a < 2 || a > w - 2 || b < 2 || b > h - 2) continue
      ctx.fillStyle = allied ? (q.downed ? '#f2ae6f' : '#a1edaf') : '#f59a79'
      if (allied && q.downed) {
        ctx.fillRect(a - 4, b - 1, 8, 2)
        ctx.fillRect(a - 1, b - 4, 2, 8)
      } else {
        ctx.beginPath()
        ctx.arc(a, b, allied ? 3.5 : exposed.has(q.id) ? 4 : 3, 0, Math.PI * 2)
        ctx.fill()
      }
      if (large && allied) {
        ctx.font = '500 9px monospace'
        ctx.fillText(q.name, a, b + 11)
      }
    }
    ctx.save()
    ctx.translate(x(p.x), z(p.z))
    ctx.rotate(-p.yaw)
    ctx.beginPath()
    ctx.moveTo(0, -10)
    ctx.lineTo(6, 6)
    ctx.lineTo(0, 3.8)
    ctx.lineTo(-6, 6)
    ctx.closePath()
    ctx.fillStyle = '#8cecf7'
    ctx.strokeStyle = '#08171d'
    ctx.lineWidth = 2.7
    ctx.stroke()
    ctx.fill()
    ctx.restore()
    if (large && this.cursor)
      this.drawCursor(ctx, x(this.cursor.x), z(this.cursor.z))
    ctx.fillStyle = '#e4efea'
    ctx.textAlign = 'right'
    ctx.font = '600 10px "IBM Plex Mono",monospace'
    ctx.fillText('N ↑', w - 8, 12)
  }

  pointer(canvas, event) {
    if (!this.bounds) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return null
    const b = this.bounds
    return this.clipPoint(
      b.cx +
        (((event.clientX - rect.left) / rect.width) * b.w - b.w / 2) / b.scale,
      b.cz +
        (((event.clientY - rect.top) / rect.height) * b.h - b.h / 2) / b.scale,
    )
  }
  clipPoint(x, z) {
    return {
      x: clamp(x, -this.world.half, this.world.half),
      z: clamp(z, -this.world.half, this.world.half),
    }
  }
  keyPoint(event, player) {
    const before = this.cursor ?? this.clipPoint(player?.x ?? 0, player?.z ?? 0)
    const unit = this.world.half / (event.shiftKey ? 7 : 26)
    this.cursor = this.clipPoint(
      before.x +
        (Number(event.key === 'ArrowRight') -
          Number(event.key === 'ArrowLeft')) *
          unit,
      before.z +
        (Number(event.key === 'ArrowDown') - Number(event.key === 'ArrowUp')) *
          unit,
    )
    return this.cursor
  }
  drawCursor(ctx, x, z) {
    ctx.save()
    ctx.strokeStyle = '#d6f0ed'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    for (const [a, b, c, d] of [
      [-12, 0, -5, 0],
      [5, 0, 12, 0],
      [0, -12, 0, -5],
      [0, 5, 0, 12],
    ]) {
      ctx.moveTo(x + a, z + b)
      ctx.lineTo(x + c, z + d)
    }
    ctx.stroke()
    ctx.restore()
  }
  drawObjectives(ctx, s, me, x, z, scale, large) {
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const field of s.fields ?? []) {
      if (field.starts > s.time || field.until <= s.time) continue
      ctx.beginPath()
      ctx.arc(x(field.x), z(field.z), field.r * scale, 0, Math.PI * 2)
      ctx.fillStyle = '#daddda32'
      ctx.fill()
      if (large) {
        ctx.strokeStyle = '#becbce76'
        ctx.stroke()
      }
    }
    for (const r of s.control?.relays ?? []) {
      const a = x(r.x),
        b = z(r.z),
        size = large ? 11 : 8
      const color = r.contested
        ? '#f1c465'
        : r.owner === null
          ? '#c8b88d'
          : r.owner === me.team
            ? '#74e3e4'
            : '#ed947b'
      ctx.strokeStyle = color
      ctx.fillStyle = '#13272c'
      ctx.lineWidth = 1.3
      ctx.beginPath()
      ctx.arc(a, b, r.radius * scale, 0, Math.PI * 2)
      ctx.stroke()
      ctx.fillRect(a - size, b - size, size * 2, size * 2)
      ctx.strokeRect(a - size, b - size, size * 2, size * 2)
      ctx.font = `700 ${size + 1}px monospace`
      ctx.fillStyle = color
      ctx.fillText(r.id, a, b + 1)
      if (large) {
        ctx.font = '500 10px monospace'
        ctx.fillText(r.title, a, b + size + 10)
      }
    }
    const point = s.training?.point
    if (point) {
      const a = x(point.x),
        b = z(point.z)
      ctx.strokeStyle = '#6ee3e8'
      ctx.lineWidth = 2
      ctx.strokeRect(a - 6, b - 6, 12, 12)
    }
    for (const p of this.world.pads ?? []) {
      const a = x(p.x),
        b = z(p.z),
        size = large ? 5.9 : 3.3
      ctx.lineWidth = 1.05
      ctx.strokeStyle = '#98d9e0'
      ctx.fillStyle = '#21343b'
      ctx.beginPath()
      ctx.moveTo(a, b - size)
      ctx.lineTo(a + size, b + size)
      ctx.lineTo(a - size, b + size)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    const marks = (s.pings ?? []).filter(
      (mark) => mark.team === me.team && mark.until > s.time,
    )
    for (const mark of marks) {
      const a = x(mark.x),
        b = z(mark.z),
        size = large ? 9 : 6
      const color = mark.kind === 'danger' ? '#fb8c6b' : '#79e5f5'
      if (mark.id === me.id) {
        ctx.save()
        ctx.strokeStyle = color + '8c'
        ctx.setLineDash(large ? [6, 4] : [3, 3])
        ctx.beginPath()
        ctx.moveTo(x(me.x), z(me.z))
        ctx.lineTo(a, b)
        ctx.stroke()
        ctx.restore()
      }
      ctx.beginPath()
      ctx.moveTo(a, b - size)
      ctx.lineTo(a + size, b)
      ctx.lineTo(a, b + size)
      ctx.lineTo(a - size, b)
      ctx.closePath()
      ctx.fillStyle = '#153039'
      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.fill()
      ctx.stroke()
      if (large) {
        ctx.fillStyle = color
        ctx.font = '700 10px monospace'
        ctx.fillText(mark.id === me.id ? 'YOUR MARK' : mark.name, a, b + 19)
      }
    }
    ctx.restore()
  }
}
