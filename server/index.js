import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { extname, resolve, sep } from 'node:path'
import { attachRoomServer } from './rooms.js'
import { createAccountHandler, openAccounts } from './accounts/http.js'
import { localBootstrapEnabled } from './accounts/store.js'

const root = fileURLToPath(new URL('../dist/', import.meta.url))
if (!existsSync(resolve(root, 'index.html'))) {
  console.error('Build the game first: npm run build')
  process.exit(1)
}
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
}
const bind = process.env.NDX_BIND_HOST ?? '0.0.0.0'
const allowBootstrap = localBootstrapEnabled()
if (process.env.NDX_LOCAL_OWNER === '1' && !allowBootstrap) {
  throw new Error(
    'Local owner bootstrap requires NDX_BIND_HOST=127.0.0.1 outside production.',
  )
}
const accounts = openAccounts({ allowBootstrap })
if (allowBootstrap && !accounts.byName('NDX'))
  await accounts.register('NDX', 'NDX', { owner: true, bootstrap: true })
const api = createAccountHandler(accounts, () => live.summary())
const server = http.createServer(
  { requestTimeout: 20_000, headersTimeout: 10_000 },
  (req, res) => {
    if (api(req, res)) return
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    let path
    try {
      path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end()
      return
    }
    if (path === '/health') {
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end('{"status":"ok"}')
      return
    }
    let file = resolve(root, `.${path}`),
      ext = extname(file)
    if (file !== resolve(root) && !file.startsWith(`${resolve(root)}${sep}`)) {
      res.writeHead(404).end()
      return
    }
    if (!ext && /^\/(assets|models|media)\//u.test(path)) {
      res.writeHead(404).end()
      return
    }
    if (!ext) {
      file = resolve(root, 'index.html')
      ext = '.html'
    }
    let stat
    try {
      stat = statSync(file)
    } catch {
      res.writeHead(404).end()
      return
    }
    if (!stat.isFile()) {
      res.writeHead(404).end()
      return
    }
    const immutable = path.startsWith('/assets/')
    const tag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    const cacheHeaders = {
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
      ETag: tag,
      'X-Content-Type-Options': 'nosniff',
    }
    const known = req.headers['if-none-match']
      ?.split(',')
      .map((value) => value.trim())
    if (known?.includes(tag) || known?.includes('*')) {
      res.writeHead(304, cacheHeaders).end()
      return
    }
    res.writeHead(200, {
      ...cacheHeaders,
      'Content-Type': types[ext] ?? 'application/octet-stream',
      'Content-Length': stat.size,
    })
    if (req.method === 'HEAD') res.end()
    else {
      const content = createReadStream(file)
      content.on('error', () => {
        if (!res.destroyed) res.destroy()
      })
      res.once('close', () => content.destroy())
      content.pipe(res)
    }
  },
)
const live = attachRoomServer(server, { accounts })
server.once('close', () => accounts.close())
server.on('upgrade', (req, socket) => {
  if (req.url?.split('?')[0] !== '/ws') socket.destroy()
})
const port = Number(process.env.PORT ?? '5173')
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535.')
  process.exit(1)
}
server.listen(port, bind, () =>
  console.log(`NDX Combat is listening on ${server.address().port}`),
)
