import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { LayoutRepo } from './db.ts'

const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const KEY_COOKIE = 'am_key'

const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const sameDigest = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

export interface AppOptions {
  /** When set, every API call needs this key (sent once, then kept in a cookie). */
  accessKey?: string
}

const isLayoutData = (d: unknown): d is { rooms: unknown[] } =>
  typeof d === 'object' && d !== null && Array.isArray((d as { rooms?: unknown }).rooms)

export function createApi(repo: LayoutRepo, opts: AppOptions = {}) {
  const api = new Hono()
  const keyDigest = opts.accessKey ? digest(opts.accessKey) : null

  api.post('/session', async (c) => {
    if (!keyDigest) return c.json({ ok: true })
    const { key } = await c.req.json<{ key?: string }>().catch(() => ({ key: undefined }))
    if (typeof key !== 'string' || !sameDigest(digest(key), keyDigest)) return c.json({ error: 'Wrong access key' }, 401)
    setCookie(c, KEY_COOKIE, keyDigest, {
      httpOnly: true,
      sameSite: 'Strict',
      secure: new URL(c.req.url).protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return c.json({ ok: true })
  })

  // Cookie rather than a header so <img>/texture loads of the plan image are covered too.
  api.use('*', async (c, next) => {
    if (keyDigest && !sameDigest(getCookie(c, KEY_COOKIE) ?? '', keyDigest)) return c.json({ error: 'Access key required' }, 401)
    await next()
  })

  api.get('/layouts', (c) => c.json(repo.list()))

  api.post('/layouts', async (c) => {
    const data = await c.req.json().catch(() => null)
    if (!isLayoutData(data)) return c.json({ error: 'Expected a layout with a rooms array' }, 400)
    return c.json(repo.create(data), 201)
  })

  api.get('/layouts/:id', (c) => {
    const layout = repo.get(c.req.param('id'))
    return layout ? c.json(layout) : c.json({ error: 'Not found' }, 404)
  })

  api.put('/layouts/:id', async (c) => {
    const body = await c.req.json<{ data?: unknown; baseRevision?: number; force?: boolean }>().catch(() => null)
    if (!body || !isLayoutData(body.data) || typeof body.baseRevision !== 'number')
      return c.json({ error: 'Expected { data, baseRevision }' }, 400)
    const res = repo.save(c.req.param('id'), body.data, body.baseRevision, body.force === true)
    if (res.status === 'not-found') return c.json({ error: 'Not found' }, 404)
    if (res.status === 'conflict') return c.json({ error: 'Changed elsewhere', revision: res.revision, updatedAt: res.updatedAt }, 409)
    return c.json({ revision: res.revision, updatedAt: res.updatedAt })
  })

  api.patch('/layouts/:id', async (c) => {
    const body = await c.req.json<{ name?: unknown }>().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) return c.json({ error: 'Expected { name }' }, 400)
    return repo.rename(c.req.param('id'), name) ? c.json(repo.get(c.req.param('id'))) : c.json({ error: 'Not found' }, 404)
  })

  api.delete('/layouts/:id', (c) => (repo.remove(c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Not found' }, 404)))

  api.post('/layouts/:id/duplicate', (c) => {
    const copy = repo.duplicate(c.req.param('id'))
    return copy ? c.json(copy, 201) : c.json({ error: 'Not found' }, 404)
  })

  api.put('/layouts/:id/image', async (c) => {
    const mime = c.req.header('content-type') ?? ''
    if (!mime.startsWith('image/')) return c.json({ error: 'Expected an image body' }, 415)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return c.json({ error: 'Image is empty or too large' }, 413)
    const version = repo.putImage(c.req.param('id'), mime, bytes)
    return version == null ? c.json({ error: 'Not found' }, 404) : c.json({ version })
  })

  api.get('/layouts/:id/image', (c) => {
    const img = repo.getImage(c.req.param('id'))
    if (!img) return c.json({ error: 'Not found' }, 404)
    // URLs carry ?v=<version>, so a given URL never changes content.
    return c.body(new Uint8Array(img.bytes), 200, {
      'Content-Type': img.mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
    })
  })

  return new Hono().route('/api', api)
}
