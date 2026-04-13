import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Plugin that serves the project-root /data folder at the /data/ URL path
function serveDataDir() {
  return {
    name: 'serve-data-dir',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/data/')) return next()
        const filePath = join(__dirname, req.url.split('?')[0])
        if (existsSync(filePath)) {
          const ext = filePath.split('.').pop().toLowerCase()
          const mime = ext === 'csv' ? 'text/csv; charset=utf-8'
                     : ext === 'json' ? 'application/json; charset=utf-8'
                     : 'application/octet-stream'
          res.setHeader('Content-Type', mime)
          res.end(readFileSync(filePath))
        } else {
          next()
        }
      })
    }
  }
}

export default defineConfig({
  base: '/habs-player-origins/',   // must match your GitHub repo name exactly
  plugins: [react(), serveDataDir()],
})
