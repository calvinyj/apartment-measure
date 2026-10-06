import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the static build can be hosted from any path.
export default defineConfig({
  base: './',
  plugins: [react()],
  // In dev the API runs as a separate process (see `npm run dev`).
  server: { proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 8787}` } },
})
