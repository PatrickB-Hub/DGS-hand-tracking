import { mkdirSync, writeFileSync } from 'node:fs'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

// Nur im Dev-Server: Kameraaufnahmen landen direkt in data/videos/. Im Production-Build existiert der Endpunkt nicht.
const saveVideos = {
  name: 'save-videos',
  apply: 'serve' as const,
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use('/__save-video', (req, res) => {
      const name = new URL(req.url ?? '', 'http://localhost').searchParams.get('name') ?? ''
      // Strenger Dateiname: keine Pfadteile, nur Buchstaben/Ziffern/_/-
      if (req.method !== 'POST' || !/^[\w-]+\.(mp4|webm)$/.test(name)) {
        res.statusCode = 400
        return res.end()
      }
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        mkdirSync('data/videos', { recursive: true })
        writeFileSync(`data/videos/${name}`, Buffer.concat(chunks))
        res.end()
      })
    })
  },
}

// `npm run dev:phone`: HTTPS mit selbstsigniertem Zertifikat und im WLAN erreichbar, denn die Kamera
// funktioniert auf dem Smartphone nur über HTTPS. Der normale Dev-Start bleibt bei http://localhost.
export default defineConfig(({ mode }) => ({ plugins: [saveVideos, ...(mode === 'phone' ? [basicSsl()] : [])] }))
