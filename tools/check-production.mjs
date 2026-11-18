import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { access } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'

const root = fileURLToPath(new URL('../', import.meta.url))
const timeout = 9000

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const time = setTimeout(
      () => finish(new Error(`Production startup timed out.\n${output}`)),
      timeout,
    )
    function finish(error, port) {
      clearTimeout(time)
      child.stdout.off('data', receive)
      child.stderr.off('data', receive)
      child.off('exit', exited)
      child.off('error', finish)
      if (error) reject(error)
      else resolve(port)
    }
    function receive(data) {
      output = (output + data).slice(-4096)
      const port = output.match(/NDX Warzone is listening on (\d+)\b/u)
      if (port) finish(null, Number(port[1]))
    }
    function exited(code) {
      finish(new Error(`Production server exited (${code}).\n${output}`))
    }
    child.on('exit', exited)
    child.on('error', finish)
    child.stdout.on('data', receive)
    child.stderr.on('data', receive)
  })
}

class RoomProbe {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.queue = []
    this.history = []
    this.error = null
    this.ws.on('message', (data) => {
      try {
        const value = JSON.parse(data)
        this.queue.push(value)
        this.history.push(value.kind)
        this.pump()
      } catch (error) {
        this.fail(error)
      }
    })
    this.ws.on('error', (error) => this.fail(error))
    this.ws.on('close', () => this.fail(new Error('Room connection closed')))
  }

  async ready() {
    const signal = AbortSignal.timeout(timeout)
    await once(this.ws, 'open', { signal })
  }

  send(body) {
    this.ws.send(JSON.stringify(body))
  }

  fail(error) {
    this.error ??= error
    this.pump()
  }

  pump() {
    if (!this.waiter) return
    const waiting = this.waiter
    const match = this.queue.findIndex(
      (data) => data.kind === waiting.kind && waiting.check(data),
    )
    if (match >= 0) waiting.end(null, this.queue.splice(match, 1)[0])
    else if (this.error) waiting.end(this.error)
  }

  wait(kind, check = () => true) {
    assert.equal(
      this.waiter,
      undefined,
      'probe waits sequentially per connection',
    )
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          end(
            new Error(
              `Missing ${kind}; received: ${this.history.slice(-10).join(', ')}`,
            ),
          ),
        timeout,
      )
      const end = (error, value) => {
        this.waiter = undefined
        clearTimeout(timer)
        if (error) reject(error)
        else resolve(value)
      }
      this.waiter = { kind, check, end }
      this.pump()
    })
  }

  dispose() {
    this.ws.terminate()
  }
}

async function checkHttp(origin) {
  const routes = [
    ['/?room=ABCDE', /^text\/html/u],
    ['/media/garrison.webp', /^image\/webp/u],
    ['/media/floodline.webp', /^image\/webp/u],
    ['/media/relay-works.webp', /^image\/webp/u],
    ['/models/armory/mistral.glb', /^model\/gltf-binary/u],
    ['/models/armory/bulwark.glb', /^model\/gltf-binary/u],
    ['/models/armory/harrier.glb', /^model\/gltf-binary/u],
    ['/models/armory/raven.glb', /^model\/gltf-binary/u],
    ['/models/operators/warden.glb', /^model\/gltf-binary/u],
    ['/models/field/textures/T_Ornaments_Normal.jpg', /^image\/jpeg/u],
    ['/models/CREDITS.md', /^text\/plain/u],
  ]
  for (const [route, type] of routes) {
    const result = await fetch(origin + route, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeout),
    })
    assert.equal(result.status, 200, route)
    assert.match(result.headers.get('content-type') ?? '', type, route)
    assert.notEqual(Number(result.headers.get('content-length')), 0, route)
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff')
    const tag = result.headers.get('etag')
    assert.ok(tag, `${route} must be revalidatable`)
    const again = await fetch(origin + route, {
      method: 'HEAD',
      headers: { 'If-None-Match': tag },
      signal: AbortSignal.timeout(timeout),
    })
    assert.equal(again.status, 304, route)
    assert.equal(again.headers.get('etag'), tag)
  }
  const health = await fetch(origin + '/health', {
    signal: AbortSignal.timeout(timeout),
  })
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok' })
  const entry = await fetch(origin + '/?room=ABCDE', {
    signal: AbortSignal.timeout(timeout),
  })
  const html = await entry.text()
  assert.match(html, /NDX WARZONE/u)
  const script = html.match(/<script[^>]+src="(\/assets\/[^" ]+\.js)"/u)?.[1]
  assert.ok(script, 'entry has a production asset reference')
  const js = await fetch(origin + script, {
    method: 'HEAD',
    signal: AbortSignal.timeout(timeout),
  })
  assert.match(js.headers.get('cache-control') ?? '', /immutable/u)
  const glb = await fetch(origin + '/models/armory/spectre.glb', {
    signal: AbortSignal.timeout(timeout),
  })
  const bytes = Buffer.from(await glb.arrayBuffer())
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF')
  assert.equal(bytes.readUInt32LE(8), bytes.length)
  const missing = await fetch(origin + '/models/field/not-a-model.glb', {
    signal: AbortSignal.timeout(timeout),
  })
  assert.equal(missing.status, 404)
  const post = await fetch(origin + '/', {
    method: 'POST',
    signal: AbortSignal.timeout(timeout),
  })
  assert.equal(post.status, 405)
  assert.equal(post.headers.get('allow'), 'GET, HEAD')
  console.log(
    `HTTP: invite entry, immutable script, ${routes.length - 1} media/model HEAD + cache checks, GLB bytes, health`,
  )
}

async function checkRoom(address) {
  const one = new RoomProbe(address),
    two = new RoomProbe(address)
  try {
    await Promise.all([one.ready(), two.ready()])
    one.send({
      op: 'create',
      mode: 'garrison',
      map: 'relay-works',
      difficulty: 'elite',
      loadout: { primary: 'bulwark', finish: 'carbon' },
      teamSize: 4,
      fill: false,
      name: 'Smoke One',
    })
    const me = await one.wait('welcome')
    const lobby = await one.wait('lobby')
    assert.match(lobby.code, /^[A-Z2-9]{5}$/u)
    assert.deepEqual([lobby.map, lobby.difficulty], ['relay-works', 'elite'])
    two.send({ op: 'join', code: lobby.code, name: 'Smoke Two' })
    const other = await two.wait('welcome')
    assert.notEqual(me.id, other.id)
    await one.wait('lobby', (state) => state.players.length === 2)
    one.send({ op: 'start' })
    const games = await Promise.all([one.wait('begin'), two.wait('begin')])
    assert.ok(
      games.every(
        (begin) =>
          begin.mode === 'garrison' &&
          begin.room === lobby.code &&
          begin.map === 'relay-works' &&
          begin.difficulty === 'elite',
      ),
    )
    assert.equal(games[0].seed, games[1].seed)
    const a = await one.wait('state'),
      b = await two.wait('state')
    for (const state of [a, b]) {
      assert.deepEqual(
        state.players.map((operator) => operator[0]),
        [me.id, other.id],
      )
      assert.deepEqual(
        state.control.relays.map((r) => r.title),
        ['North Yard', 'Turbine Hall', 'South Bay'],
      )
    }
    const host = (await one.wait('self')).self
    assert.deepEqual([host.weapon, host.loadout.finish], ['bulwark', 'carbon'])
    const { self } = await two.wait('self')
    two.send({ op: 'input', seq: 1, input: { yaw: self.yaw, sidearm: true } })
    const next = (await two.wait('self', (wrapper) => wrapper.self.ack >= 1))
      .self
    assert.equal(next.weapon, 'spectre')
    console.log(
      'WebSocket: invite, authoritative Relay Works and Elite rules, equipped kit, shared relays, and acknowledged switch',
    )
  } finally {
    one.dispose()
    two.dispose()
  }
}

async function main() {
  try {
    await access(new URL('../dist/index.html', import.meta.url))
  } catch {
    throw new Error('Run npm run build before npm run test:production.')
  }
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const exited = once(child, 'close').catch(() => undefined)
  try {
    const port = await waitForServer(child)
    await checkHttp(`http://127.0.0.1:${port}`)
    await checkRoom(`ws://127.0.0.1:${port}/ws`)
  } finally {
    child.kill('SIGTERM')
    if (
      !(await Promise.race([
        exited.then(() => true),
        delay(2500, false, { ref: false }),
      ]))
    ) {
      child.kill('SIGKILL')
      await exited
    }
  }
}

await main()
