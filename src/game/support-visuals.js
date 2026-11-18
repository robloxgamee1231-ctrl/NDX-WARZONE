import * as T from 'three'
import { SERVICES } from './support.js'
import { yawWrap } from './movement.js'
import { clamp, distance } from './world.js'

export class SupportCrew {
  constructor(scene, world) {
    this.root = new T.Group()
    this.root.name = 'Field support crew'
    scene.add(this.root)
    const circle = new T.RingGeometry(0.54, 0.583, 20)
    circle.rotateX(-Math.PI / 2)
    this.actors = []
    this.comms = []
    for (const [i, npc] of world.staff.entries()) {
      const desk = SERVICES[npc.kind]
      const ring = new T.Mesh(
        circle,
        new T.MeshBasicMaterial({
          color: desk.tint,
          transparent: true,
          opacity: 0.54,
          depthWrite: false,
        }),
      )
      ring.position.set(npc.x, npc.y + 0.035, npc.z)
      this.root.add(ring)
      const signal = new T.Mesh(
        new T.OctahedronGeometry(0.092),
        new T.MeshBasicMaterial({ color: desk.tint }),
      )
      signal.position.set(npc.x, npc.y + 2.26, npc.z)
      this.root.add(signal)
      this.actors.push({
        ...npc,
        npc: true,
        id: `npc-${npc.id}`,
        team: -1,
        alive: true,
        height: 1.76,
        air: 'ground',
        stance: 'idle',
        vx: 0,
        vz: 0,
        pitch: 0,
        shotAt: -99,
        weapon: null,
        operator: desk.operator,
        uniform: desk.tint,
      })
      this.comms.push({ signal, ring, yaw: npc.yaw, offset: i * 1.86 })
    }
    if (!this.actors.length) circle.dispose()
  }
  update(p, time, dt) {
    for (const [i, actor] of this.actors.entries()) {
      const { signal, ring, yaw, offset } = this.comms[i]
      const d = p.air !== 'plane' ? distance(p, actor) : Infinity
      const want = d < 7 ? Math.atan2(actor.x - p.x, actor.z - p.z) : yaw
      actor.yaw = yawWrap(
        actor.yaw + yawWrap(want - actor.yaw) * clamp(dt * 5.4, 0, 1),
      )
      actor.wave = d < 8 && d > 3.4 && (time + offset) % 9 < 2.1
      signal.visible = ring.visible = d < 45
      if (signal.visible) {
        signal.rotation.y = time * 0.72 + offset
        ring.material.opacity = 0.46 + Math.cos(time * 2.2 + offset) * 0.143
        signal.position.y =
          actor.y + 2.18 + Math.sin(time * 2.8 + offset) * 0.081
      }
    }
    return this.actors
  }
}
