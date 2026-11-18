import { mapForMode } from '../src/game/map-catalog.js'
import {
  normalizeDifficulty,
  STANDARD_DIFFICULTY,
} from '../src/game/difficulty.js'
import { randomInt, randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'
import { MODES, ROOM_LIMIT } from '../src/config.js'
import { Match } from '../src/game/match.js'
import { authorizedLoadout } from '../src/game/loadout.js'
import { originAllowed, sessionCookie } from './accounts/http.js'

const modeIds = new Set(
  MODES.filter((mode) => mode.teams.length && mode.map !== 'range').map(
    (mode) => mode.id,
  ),
)
const STEPS = 30
const checkedInt = (input, min, max, fallback) => {
  if (input === '' || input === null || input === undefined) return fallback
  const n =
    typeof input === 'number'
      ? input
      : typeof input === 'string' && input.length <= 8
        ? Number(input)
        : NaN
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const roomName = () =>
  Array.from(
    { length: 5 },
    () => '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[randomInt(31)],
  ).join('')
const cleanName = (name) =>
  typeof name === 'string'
    ? name
        .trim()
        .replace(/[^\p{L}\p{N} _.-]/gu, '')
        .slice(0, 16) || 'Operator'
    : 'Operator'
const canSend = (ws) =>
  ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 512 * 1024
const send = (ws, data) => {
  if (canSend(ws))
    ws.send(typeof data === 'string' ? data : JSON.stringify(data))
}

export function attachRoomServer(server, options = {}) {
  const capacity = checkedInt(
    options.capacity ?? process.env.MATCH_CAPACITY,
    2,
    ROOM_LIMIT,
    ROOM_LIMIT,
  )
  const maxRooms = checkedInt(
    options.maxRooms ?? process.env.MAX_ROOMS,
    1,
    80,
    12,
  )
  const onlineBots = checkedInt(
    options.onlineBots ?? process.env.ONLINE_BOTS,
    0,
    ROOM_LIMIT - 1,
    39,
  )
  const quickWait = options.quickWait ?? 6500
  const accounts = options.accounts
  const grace = options.reconnectMs ?? 35_000
  const rooms = new Map()
  const sockets = new Set()
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4096,
    perMessageDeflate: false,
  })

  const error = (state, message) => send(state.ws, { kind: 'error', message })
  const isDisabled = (mode) => accounts?.live().disabled.includes(mode) ?? false
  function authorized(state) {
    const account = accounts?.fromSession(state.session)
    return account && !account.must_rotate ? account : null
  }
  function begin(room, member) {
    send(member.ws, {
      kind: 'begin',
      id: member.id,
      mode: room.mode.id,
      teamSize: room.teamSize,
      map: room.map.id,
      difficulty: room.difficulty,
      seed: room.match.seed,
      room: room.code,
      private: !room.public,
      resumable: !!member.accountId,
    })
  }
  function start(room) {
    if (room.match) return
    for (const member of [...room.members.values()])
      if (member.session && !authorized(member)) {
        error(member, 'Sign in again to deploy.')
        leave(member)
      }
    if (!room.members.size) return
    if (
      isDisabled(room.mode.id) &&
      ![...room.members.values()].some((m) => m.owner && m.id === room.host)
    ) {
      for (const member of [...room.members.values()]) {
        error(
          member,
          'This online playlist is closed. Local practice remains available.',
        )
        leave(member)
      }
      return
    }
    const playerCount = room.members.size
    const needed = room.mode.paired ? 2 : room.teamSize + 1
    if (!room.public && !room.fill && playerCount < needed) {
      const host = [...room.members.values()].find((m) => m.id === room.host)
      if (host)
        send(host.ws, {
          kind: 'error',
          message: `Add more operators or enable bots. This format needs ${needed} operators to form opposing teams.`,
        })
      return
    }
    const roster = [...room.members.values()].map(
      ({ id, name, loadout, owner }) => ({
        id,
        name,
        loadout,
        owner,
      }),
    )
    const bots = room.fill
      ? Math.max(
          needed - playerCount,
          room.public && room.mode.gas
            ? onlineBots - playerCount + 1
            : room.mode.bots - playerCount + 1,
        )
      : 0
    const seed = randomInt(1, 2_000_000_000)
    room.match = new Match({
      mode: room.mode.id,
      teamSize: room.teamSize,
      map: room.map.id,
      difficulty: room.difficulty,
      seed,
      bots,
      capacity: room.cap,
      players: roster,
    })
    room.startAt = null
    for (const member of room.members.values()) begin(room, member)
    publish(room)
  }
  function publish(room, recipients = room.members.values()) {
    const match = room.match,
      shared = JSON.stringify(match.sharedWire())
    for (const member of recipients) {
      if (member.detachedUntil || !canSend(member.ws)) continue
      const p = match.players.get(member.id)
      if (!p) continue
      send(member.ws, shared)
      const data = match.events.filter((e) => e.id > member.eventCursor)
      // Suppress distant cosmetic movement/impact events; combat and scoreboard still come from the server.
      const center = p.alive ? p : (match.players.get(p.killer) ?? p)
      const events = data.filter((e) => {
        if (
          e.actor === p.id ||
          e.target === p.id ||
          [
            'kill',
            'circle',
            'matchEnd',
            'leave',
            'relayCaptured',
            'relayOvertime',
            'resupplyIn',
            'resupplyLand',
          ].includes(e.type)
        )
          return true
        if (
          e.team === p.team &&
          ['ping', 'pingClear', 'rescued', 'downed', 'pulse'].includes(e.type)
        )
          return true
        if (e.type === 'shot')
          return Math.hypot(e.start[0] - center.x, e.start[2] - center.z) < 248
        if (
          [
            'jump',
            'slide',
            'land',
            'drop',
            'chute',
            'crate',
            'launch',
          ].includes(e.type) &&
          Number.isFinite(e.x)
        )
          return Math.hypot(e.x - center.x, e.z - center.z) < 72
        return false
      })
      const loot =
        member.lootVersion === match.lootVersion
          ? []
          : match.lootSince(member.lootVersion)
      send(member.ws, {
        kind: 'self',
        self: match.selfWire(p),
        events,
        loot,
        award: room.awards?.get(member.id) ?? null,
      })
      member.eventCursor = match.eventId
      member.lootVersion = match.lootVersion
    }
  }
  function announce(room) {
    const message = JSON.stringify({
      kind: 'lobby',
      code: room.code,
      public: room.public,
      mode: room.mode.id,
      teamSize: room.teamSize,
      map: room.map.id,
      difficulty: room.difficulty,
      fill: room.fill,
      cap: room.cap,
      startAt: room.startAt,
      host: room.host,
      players: [...room.members.values()].map(
        ({ id, name, owner, accountId }) => ({
          id,
          name,
          owner,
          guest: !accountId,
        }),
      ),
    })
    for (const m of room.members.values()) send(m.ws, message)
  }
  function leave(state) {
    const room = state.room
    if (!room) return
    state.room = null
    room.members.delete(state.id)
    room.match?.removePlayer(state.id)
    if (!room.members.size) {
      rooms.delete(room.code)
      return
    }
    if (state.id === room.host) room.host = room.members.keys().next().value
    if (!room.match) announce(room)
  }
  function join(state, m) {
    if (state.room)
      return send(state.ws, {
        kind: 'error',
        message: 'You already have an active room.',
      })
    const account = authorized(state)
    if (state.session && !account)
      return error(
        state,
        'Sign in again or sign out to play as a guest. Local bootstrap accounts must change their password.',
      )
    if (
      account &&
      [...rooms.values()].some((room) =>
        [...room.members.values()].some((m) => m.accountId === account.id),
      )
    )
      return error(
        state,
        'This account already has a room. Exit that operation first.',
      )
    const mode =
      MODES.find((x) => x.id === m.mode && modeIds.has(x.id)) ?? MODES[0]
    const wanted = mode.teams.includes(m.teamSize)
      ? m.teamSize
      : mode.defaultTeam
    const cap =
      m.op === 'quick'
        ? capacity
        : checkedInt(m.capacity, 2, capacity, Math.min(capacity, 24))
    const teamSize =
      mode.gas && wanted >= cap
        ? mode.teams.filter((n) => n < cap).at(-1)
        : wanted
    let room
    if (m.op === 'join') {
      const code = typeof m.code === 'string' ? m.code.trim().toUpperCase() : ''
      room = rooms.get(code)
      if (!room || room.public)
        return send(state.ws, {
          kind: 'error',
          message: 'Lobby not found. Check your room code.',
        })
      if (
        isDisabled(room.mode.id) &&
        ![...room.members.values()].some(
          (member) => member.owner && member.id === room.host,
        )
      )
        return error(state, 'That online playlist is closed.')
      if (room.match)
        return send(state.ws, {
          kind: 'error',
          message: 'That operation has already deployed.',
        })
      if (room.members.size >= room.cap)
        return send(state.ws, { kind: 'error', message: 'That lobby is full.' })
    } else {
      const quick = m.op === 'quick'
      if (isDisabled(mode.id) && (account?.role !== 'owner' || quick))
        return error(state, 'That online playlist is closed.')
      const map = mapForMode(mode, m.map)
      const difficulty = quick
        ? STANDARD_DIFFICULTY
        : normalizeDifficulty(m.difficulty)
      if (quick)
        room = [...rooms.values()].find(
          (r) =>
            r.public &&
            !r.match &&
            r.mode.id === mode.id &&
            r.map.id === map.id &&
            r.teamSize === teamSize &&
            r.members.size < r.cap,
        )
      if (!room) {
        if (rooms.size >= maxRooms)
          return send(state.ws, {
            kind: 'error',
            message:
              'All game servers are busy. Try again or play a local bot match.',
          })
        let code = roomName()
        while (rooms.has(code)) code = roomName()
        room = {
          code,
          key: randomUUID(),
          public: quick,
          mode,
          map,
          difficulty,
          teamSize,
          host: state.id,
          cap,
          fill: quick || m.fill !== false,
          startAt: quick ? Date.now() + quickWait : null,
          members: new Map(),
          match: null,
        }
        rooms.set(code, room)
      }
    }
    state.accountId = account?.id ?? null
    state.owner = account?.role === 'owner'
    const guest = cleanName(m.name)
    state.name =
      account?.callsign ?? (guest.toLowerCase() === 'ndx' ? 'Guest' : guest)
    state.loadout = authorizedLoadout(m.loadout, m.weapon, (id) =>
      accounts?.owns(account, id),
    )
    state.room = room
    state.eventCursor = 0
    state.lootVersion = 0
    room.members.set(state.id, state)
    send(state.ws, { kind: 'welcome', id: state.id })
    announce(room)
    if (room.public && room.members.size >= room.cap) start(room)
  }
  function resume(state, code) {
    const account = authorized(state)
    const room = typeof code === 'string' && rooms.get(code)
    const old =
      account &&
      room?.match &&
      [...room.members.values()].find(
        (m) => m.accountId === account.id && m.detachedUntil > Date.now(),
      )
    if (state.room || !old)
      return error(state, 'The reserved match seat is no longer available.')
    Object.assign(state, {
      room,
      id: old.id,
      name: old.name,
      owner: old.owner,
      accountId: account.id,
      lootVersion: 0,
      eventCursor: room.match.eventId,
    })
    room.members.set(state.id, state)
    old.room = null
    begin(room, state)
    publish(room, [state])
  }
  function onUpgrade(req, socket, head) {
    if (req.url?.split('?')[0] !== '/ws') return
    if (req.headers.origin ? !originAllowed(req) : !!sessionCookie(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    if (sockets.size >= maxRooms * capacity + 20) {
      socket.end(
        'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
      )
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit('connection', ws, req),
    )
  }
  server.on('upgrade', onUpgrade)
  wss.on('connection', (ws, req) => {
    const state = {
      ws,
      session: accounts ? sessionCookie(req) : null,
      id: randomUUID().slice(0, 8),
      room: null,
      lastPong: Date.now(),
      joined: Date.now(),
      bucketTime: Date.now(),
      count: 0,
    }
    sockets.add(state)
    ws.on('error', () => {})
    ws.on('pong', () => {
      state.lastPong = Date.now()
    })
    ws.on('close', () => {
      sockets.delete(state)
      if (
        state.accountId &&
        state.room?.match &&
        !state.room.done &&
        authorized(state)
      ) {
        state.detachedUntil = Date.now() + grace
        const p = state.room.match.players.get(state.id)
        if (p) {
          p.inputAt = -10
          p.pending = {}
        }
      } else leave(state)
    })
    ws.on('message', (data, isBinary) => {
      const now = Date.now()
      if (now - state.bucketTime >= 1000) {
        state.count = 0
        state.bucketTime = now
      }
      if (++state.count > 100) {
        if (state.count > 170) ws.close(1008, 'Rate limit')
        return
      }
      if (isBinary) return
      let m
      try {
        m = JSON.parse(data.toString())
      } catch {
        return
      }
      if (!m || typeof m !== 'object') return
      if (m.op === 'resume') return resume(state, m.code)
      if (['create', 'join', 'quick'].includes(m.op)) return join(state, m)
      const room = state.room
      if (!room) return
      if (m.op === 'leave') return leave(state)
      if (m.op === 'start' && !room.public && room.host === state.id)
        return start(room)
      if (
        m.op === 'fill' &&
        !room.match &&
        !room.public &&
        room.host === state.id &&
        typeof m.fill === 'boolean'
      ) {
        room.fill = m.fill
        announce(room)
        return
      }
      if (m.op === 'input') room.match?.command(state.id, m.input, m.seq)
      if (m.op === 'ping') room.match?.ping(state.id, m.point)
      if (m.op === 'buy' && typeof m.offer === 'string')
        room.match?.purchase(state.id, m.offer)
    })
  })
  let tick = 0
  let last = performance.now(),
    rest = 0
  const timer = setInterval(() => {
    const now = performance.now()
    rest += Math.min(120, now - last)
    last = now
    while (rest >= 1000 / STEPS) {
      rest -= 1000 / STEPS
      tick++
      for (const room of rooms.values()) {
        if (!room.match) {
          if (room.startAt && Date.now() >= room.startAt) start(room)
          continue
        }
        if (room.done) continue
        room.match.step(1 / STEPS)
        if (room.match.result) {
          try {
            room.awards = new Map(
              accounts?.awardMatch(room).map((a) => [a.id, a]) ?? [],
            )
          } catch (error) {
            console.error('Could not persist match result:', error)
          }
          room.done = true
        }
        if (tick % 3 === 0 || room.done) publish(room)
      }
    }
  }, 20)
  const sweep = setInterval(() => {
    for (const room of rooms.values())
      for (const state of [...room.members.values()]) {
        if (state.accountId && !authorized(state)) {
          leave(state)
          state.ws.close(1008, 'Account session ended')
        } else if (state.detachedUntil && state.detachedUntil < Date.now())
          leave(state)
      }
  }, 2000)
  const heartbeat = setInterval(() => {
    const now = Date.now()
    for (const s of sockets) {
      if (now - s.lastPong > 43_000 || (!s.room && now - s.joined > 30_000))
        s.ws.terminate()
      else if (s.ws.readyState === WebSocket.OPEN) s.ws.ping()
    }
  }, 15_000)
  timer.unref?.()
  heartbeat.unref?.()
  function close() {
    clearInterval(timer)
    clearInterval(heartbeat)
    clearInterval(sweep)
    server.off('upgrade', onUpgrade)
    for (const s of sockets) {
      s.room = null
      s.ws.terminate()
    }
    rooms.clear()
    wss.close()
  }
  server.once('close', close)
  function summary() {
    let humans = 0,
      bots = 0,
      active = 0,
      queued = 0
    for (const room of rooms.values()) {
      if (room.done) continue
      if (room.match) {
        active++
        bots += room.match.botCount
      } else queued++
      humans += [...room.members.values()].filter(
        (m) => !m.detachedUntil && canSend(m.ws),
      ).length
    }
    return { humans, bots, active, queued, capacity }
  }
  return { close, rooms, capacity, summary }
}
