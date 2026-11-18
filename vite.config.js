import { defineConfig, normalizePath } from 'vite'
import { attachRoomServer } from './server/rooms.js'
import { createAccountHandler, openAccounts } from './server/accounts/http.js'
import { accountDatabase } from './server/accounts/store.js'

function attach(server) {
  if (!server.httpServer) return
  const accounts = openAccounts()
  const rooms = attachRoomServer(server.httpServer, { accounts })
  server.middlewares.use(createAccountHandler(accounts, rooms.summary))
  server.httpServer.once('close', () => accounts.close())
}

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  const db = accountDatabase()
  return {
    // Pages serves a project subdirectory, and doesn't run the room server.
    base: pages ? './' : '/',
    server: {
      host: '0.0.0.0',
      allowedHosts: ['.e2b.app'],
      fs: {
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          '**/.local/**',
          '**/*.sqlite*',
          ...(db === ':memory:'
            ? []
            : ['', '-wal', '-shm', '-journal'].map((suffix) =>
                normalizePath(db + suffix),
              )),
        ],
      },
    },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
    plugins: pages
      ? []
      : [
          {
            name: 'ndx-match-server',
            configureServer: attach,
            configurePreviewServer: attach,
          },
        ],
    build: {
      outDir: pages ? 'out/pages' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/three/build/three.webgpu')) return 'three-webgpu'
            if (id.includes('/three/build/three.module')) return 'three-webgl'
            if (id.includes('/three/build/three.core')) return 'three-core'
          },
        },
      },
    },
  }
})
