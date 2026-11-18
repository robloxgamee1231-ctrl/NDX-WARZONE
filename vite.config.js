import { defineConfig } from 'vite'
import { attachRoomServer } from './server/rooms.js'

export default defineConfig({
  server: { host: '0.0.0.0', allowedHosts: true },
  preview: { host: '0.0.0.0', allowedHosts: true },
  plugins: [
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
})
