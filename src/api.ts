import type { Project } from './types'

export interface LayoutSummary {
  id: string
  name: string
  revision: number
  createdAt: string
  updatedAt: string
  roomCount: number
  imageVersion: number | null
}

export interface Layout extends LayoutSummary {
  data: unknown
}

/** The server couldn't be reached at all (offline, server down). */
export class NetworkError extends Error {}
export class AuthError extends Error {}
export class ConflictError extends Error {
  constructor(
    public revision: number,
    public updatedAt: string,
  ) {
    super('This layout was changed on another device')
  }
}
export class HttpError extends Error {}

// Relative so the app also works when hosted under a sub-path.
const BASE = 'api'

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', ...init })
  } catch {
    throw new NetworkError('Server unreachable')
  }
  if (res.status === 204) return undefined as T
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) throw new AuthError(body.error ?? 'Access key required')
  if (res.status === 409) throw new ConflictError(body.revision, body.updatedAt)
  if (res.status >= 500 && res.status !== 501) throw new NetworkError(body.error ?? `Server error ${res.status}`)
  if (!res.ok) throw new HttpError(body.error ?? `Request failed (${res.status})`)
  return body as T
}

const sendJson = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const imageUrl = (id: string, version: number) => `${BASE}/layouts/${id}/image?v=${version}`

export const api = {
  login: (key: string) => call<{ ok: true }>('/session', sendJson('POST', { key })),
  list: () => call<LayoutSummary[]>('/layouts'),
  get: (id: string) => call<Layout>(`/layouts/${id}`),
  create: (data: Project) => call<Layout>('/layouts', sendJson('POST', data)),
  save: (id: string, data: Project, baseRevision: number, force = false) =>
    call<{ revision: number; updatedAt: string }>(`/layouts/${id}`, sendJson('PUT', { data, baseRevision, force })),
  rename: (id: string, name: string) => call<Layout>(`/layouts/${id}`, sendJson('PATCH', { name })),
  remove: (id: string) => call<void>(`/layouts/${id}`, { method: 'DELETE' }),
  duplicate: (id: string) => call<Layout>(`/layouts/${id}/duplicate`, { method: 'POST' }),
  putImage: (id: string, blob: Blob) =>
    call<{ version: number }>(`/layouts/${id}/image`, { method: 'PUT', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob }),
}
