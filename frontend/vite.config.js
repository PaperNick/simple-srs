import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports are overridable so the e2e suite can run on distinct ports and never
// clash with a running dev server.
const port = Number(process.env.FRONTEND_PORT) || 5173
const backendPort = process.env.BACKEND_PORT || '3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
      // Proxy static files to the backend
      '/static': `http://localhost:${backendPort}`,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
