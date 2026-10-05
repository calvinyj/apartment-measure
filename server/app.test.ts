import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApi } from './app.ts'
import { layoutRepo, openDb } from './db.ts'
import { imageFiles } from './images.ts'

let uploads = ''
const fresh = (accessKey?: string) => {
  uploads = mkdtempSync(join(tmpdir(), 'am-uploads-'))
  return createApi(layoutRepo(openDb(':memory:'), imageFiles(uploads)), { accessKey })
}
// Response bodies are loosely typed on purpose; the assertions check their shape.
const read = async (res: Response | Promise<Response>): Promise<any> => (await res).json()
const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('layouts API', () => {
  it('creates, lists and loads layouts', async () => {
    const app = fresh()
    const created = await read(app.request('/api/layouts', json({ name: 'Unit A', rooms: [{}, {}] })))
    expect(created).toMatchObject({ name: 'Unit A', revision: 1, roomCount: 2, imageVersion: null })

    const list = await read(app.request('/api/layouts'))
    expect(list.map((l: { name: string }) => l.name)).toEqual(['Unit A'])

    const loaded = await read(app.request(`/api/layouts/${created.id}`))
    expect(loaded.data).toEqual({ name: 'Unit A', rooms: [{}, {}] })
  })

  it('rejects saves based on a stale revision unless forced', async () => {
    const app = fresh()
    const { id } = await read(app.request('/api/layouts', json({ name: 'A', rooms: [] })))

    const ok = await app.request(`/api/layouts/${id}`, json({ data: { name: 'A2', rooms: [] }, baseRevision: 1 }, 'PUT'))
    expect(await read(ok)).toMatchObject({ revision: 2 })

    // A second device still on revision 1 tries to save.
    const stale = await app.request(`/api/layouts/${id}`, json({ data: { name: 'old', rooms: [] }, baseRevision: 1 }, 'PUT'))
    expect(stale.status).toBe(409)
    expect(await read(stale)).toMatchObject({ revision: 2 })

    const forced = await app.request(`/api/layouts/${id}`, json({ data: { name: 'mine', rooms: [] }, baseRevision: 1, force: true }, 'PUT'))
    expect(await read(forced)).toMatchObject({ revision: 3 })
    expect((await read(app.request(`/api/layouts/${id}`))).name).toBe('mine')
  })

  it('keeps the plan image as a file on disk and copies it on duplicate', async () => {
    const app = fresh()
    const { id } = await read(app.request('/api/layouts', json({ name: 'A', rooms: [] })))
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])
    const put = await app.request(`/api/layouts/${id}/image`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes })
    expect(await read(put)).toEqual({ version: 1 })
    expect(readdirSync(join(uploads, id))).toEqual(['plan-1.jpg'])

    // Replacing the image writes a new version and drops the old file.
    await app.request(`/api/layouts/${id}/image`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: bytes })
    expect(readdirSync(join(uploads, id))).toEqual(['plan-2.jpg'])

    const copy = await read(app.request(`/api/layouts/${id}/duplicate`, { method: 'POST' }))
    expect(copy).toMatchObject({ name: 'A (copy)', imageVersion: 2 })
    const img = await app.request(`/api/layouts/${copy.id}/image`)
    expect(img.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(bytes)

    expect((await app.request(`/api/layouts/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/api/layouts/${id}/image`)).status).toBe(404)
    expect(existsSync(join(uploads, id))).toBe(false)
    expect((await app.request(`/api/layouts/${copy.id}/image`)).status).toBe(200)
  })

  it('renames inside the stored JSON too', async () => {
    const app = fresh()
    const { id } = await read(app.request('/api/layouts', json({ name: 'A', rooms: [] })))
    const renamed = await read(app.request(`/api/layouts/${id}`, json({ name: 'Block B 12-3' }, 'PATCH')))
    expect(renamed).toMatchObject({ name: 'Block B 12-3', revision: 2, data: { name: 'Block B 12-3' } })
  })

  it('requires the access key when one is configured', async () => {
    const app = fresh('s3cret')
    expect((await app.request('/api/layouts')).status).toBe(401)
    expect((await app.request('/api/session', json({ key: 'nope' }))).status).toBe(401)
    const login = await app.request('/api/session', json({ key: 's3cret' }))
    const cookie = login.headers.get('set-cookie')!.split(';')[0]
    expect((await app.request('/api/layouts', { headers: { cookie } })).status).toBe(200)
  })
})
