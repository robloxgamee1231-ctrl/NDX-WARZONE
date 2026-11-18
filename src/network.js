import { mapForMode } from './game/map-catalog.js'
import { MODE } from './config.js'
import { createWorld } from './game/world.js'
import { readActor } from './game/wire.js'

export class RoomConnection extends EventTarget {
  constructor() {
    super()
    this.id = null
    this.lobby = null
    this.info = null
    this.state = null
    this.me = null
    this.loot = new Map()
    this.events = []
    this.closed = false
  }
  open(operation) {
    if (this.ws) return
    const url = new URL('/ws', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.ws = new WebSocket(url)
    this.timer = setTimeout(() => {
      if (!this.id) {
        this.emit(
          'error',
          'Could not reach game servers. Check your connection or play a local match.',
        )
        this.close()
      }
    }, 8500)
    this.ws.addEventListener('open', () => this.send(operation))
    this.ws.addEventListener('message', (ev) => {
      let data
      try {
        data = JSON.parse(ev.data)
      } catch {
        return
      }
      this.accept(data)
    })
    this.ws.addEventListener('error', () => {
      if (!this.closed && !this.id) {
        this.emit(
          'error',
          'Game servers are unreachable. Local matches are still available.',
        )
      }
    })
    this.ws.addEventListener('close', () => {
      clearTimeout(this.timer)
      if (!this.closed) {
        this.closed = true
        this.emit('disconnect', 'Connection to the match server was lost.')
      }
    })
  }
  accept(d) {
    switch (d.kind) {
      case 'welcome':
        clearTimeout(this.timer)
        this.id = d.id
        break
      case 'error':
        clearTimeout(this.timer)
        this.emit('error', d.message)
        break
      case 'lobby':
        this.lobby = d
        this.emit('lobby', d)
        break
      case 'begin':
        this.info = d
        this.id = d.id
        this.world = createWorld(this.modeMap(d.mode, d.map), d.seed)
        this.loot = new Map(this.world.pickups.map((i) => [i.id, { ...i }]))
        this.events = []
        this.emit('begin', d)
        break
      case 'state':
        this.state = {
          time: d.time,
          players: d.players.map(readActor),
          gas: d.gas,
          scores: d.scores,
          result: d.result,
          targetDown: d.targets,
          control: d.control,
          fields: d.fields ?? [],
        }
        break
      case 'self':
        this.me = d.self
        for (const i of d.loot) this.loot.set(i.id, i)
        if (d.events.length) {
          this.events.push(...d.events)
          if (this.events.length > 600)
            this.events.splice(0, this.events.length - 600)
        }
        this.emit('snapshot', this.snapshot())
        break
    }
  }
  modeMap(id, requested) {
    return mapForMode(MODE[id], requested).id
  }
  snapshot() {
    return this.state
      ? {
          ...this.state,
          loot: this.loot,
          events: this.events,
          pings: this.me?.pings ?? [],
          contacts: this.me?.contacts ?? [],
        }
      : null
  }
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }))
  }
  send(data) {
    if (
      this.ws?.readyState === WebSocket.OPEN &&
      this.ws.bufferedAmount < 128 * 1024
    )
      this.ws.send(JSON.stringify(data))
  }
  close() {
    this.closed = true
    clearTimeout(this.timer)
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this.send({ op: 'leave' })
      this.ws.close()
    }
  }
}
