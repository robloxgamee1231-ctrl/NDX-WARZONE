import { defineConfig } from 'vite'
import { attachRoomServer } from './server/rooms.js'

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  return {
    // Pages serves a project subdirectory, and doesn't run the room server.
    base: pages ? './' : '/',
    server: { host: '0.0.0.0', allowedHosts: true },
    preview: { host: '0.0.0.0', allowedHosts: true },
    plugins: pages
      ? []
      : [
          {
            name: 'ndx-match-server',
            configureServer(server) {
              if (server.httpServer) attachRoomServer(server.httpServer)
            },
            configurePreviewServer(server) {
              attachRoomServer(server.httpServer)
            },
          },
        ],
    build: {
      outDir: pages ? 'out/pages' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('/node_modules/three/')) return 'three'
          },
        },
      },
    },
  }
})
