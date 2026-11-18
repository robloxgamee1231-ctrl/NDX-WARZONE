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
    if (!this.ws && !this.closed) this.dial(operation)
  }
  dial(operation, resume = false) {
    const url = new URL('/ws', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = (this.ws = new WebSocket(url))
    this.timer = setTimeout(
      () => {
        if (resume) ws.close()
        else if (!this.id) {
          this.emit(
            'error',
            'Could not reach game servers. Check your connection or play a local match.',
          )
          this.close()
        }
      },
      resume ? 3300 : 8500,
    )
    ws.addEventListener('open', () => this.send(operation))
    ws.addEventListener('message', (ev) => {
      if (this.ws !== ws || this.closed) return
      let data
      try {
        data = JSON.parse(ev.data)
      } catch {
        return
      }
      if (resume && data.kind === 'error') {
        ws.close()
        return
      }
      this.accept(data)
    })
    ws.addEventListener('error', () => {
      if (!resume && !this.closed && !this.id)
        this.emit(
          'error',
          'Game servers are unreachable. Local matches are still available.',
        )
    })
    ws.addEventListener('close', (event) => {
      if (this.ws !== ws) return
      clearTimeout(this.timer)
      if (this.closed || this.state?.result) return
      if (event.code !== 1008 && this.info?.resumable) this.reconnect()
      else this.disconnect()
    })
  }
  reconnect() {
    if (this.closed) return
    if (!this.reconnectAttempt)
      this.emit('reconnecting', 'Connection interrupted. Rejoining your match…')
    const delays = [450, 900, 1700, 2500, 3000, 3500]
    const wait = delays[this.reconnectAttempt ?? 0]
    this.reconnectAttempt = (this.reconnectAttempt ?? 0) + 1
    if (wait === undefined) return this.disconnect()
    this.retryTimer = setTimeout(() => {
      if (!this.closed) this.dial({ op: 'resume', code: this.info.room }, true)
    }, wait)
  }
  disconnect() {
    this.closed = true
    this.emit('disconnect', 'Connection to the match server was lost.')
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
      case 'begin': {
        clearTimeout(this.timer)
        const resumed = !!this.info && !!this.reconnectAttempt
        this.reconnectAttempt = 0
        this.info = d
        this.id = d.id
        this.world = createWorld(this.modeMap(d.mode, d.map), d.seed)
        this.loot = new Map(this.world.pickups.map((i) => [i.id, { ...i }]))
        this.events = []
        this.emit(resumed ? 'resume' : 'begin', d)
        break
      }
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
        this.award = d.award ?? null
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
          award: this.award,
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
    clearTimeout(this.retryTimer)
    clearTimeout(this.timer)
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) {
      this.send({ op: 'leave' })
      this.ws.close()
    }
  }
}
