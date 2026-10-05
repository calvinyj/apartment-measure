import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApi } from './app.ts'
import { layoutRepo, openDb } from './db.ts'
import { imageFiles } from './images.ts'

const port = Number(process.env.PORT ?? 8787)
const dbPath = process.env.DB_PATH ?? 'data/apartment-measure.db'
const uploadsDir = process.env.UPLOADS_DIR ?? 'data/uploads'

const app = createApi(layoutRepo(openDb(dbPath), imageFiles(uploadsDir)), { accessKey: process.env.ACCESS_KEY || undefined })

// In production the same process serves the built web app.
if (process.env.NODE_ENV === 'production') {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`API listening on http://localhost:${info.port} · database ${dbPath} · images ${uploadsDir}${process.env.ACCESS_KEY ? ' · access key required' : ''}`)
})
