import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval'
import { api, AuthError, ConflictError, imageUrl, NetworkError, type Layout } from './api'
import { emptyProject, normalizeProject, prepareImage, useStore, type Tab } from './store'
import type { Project } from './types'

/**
 * The server (SQLite) is the source of truth. Every edit is also written to
 * IndexedDB straight away, so a flaky connection on site never loses work:
 * unsent edits are pushed when the connection comes back, or next time the
 * layout is opened on this device.
 */

interface LocalCopy {
  data: Project
  /** server revision these edits were based on */
  revision: number
  dirty: boolean
}

const LAST_KEY = 'apartment-measure:last-layout'
const LEGACY_KEY = 'apartment-measure:project'
const localKey = (id: string) => `apartment-measure:layout:${id}`

const SAVE_DELAY = 800
const RETRY_DELAY = 5000

let saveTimer: ReturnType<typeof setTimeout> | undefined
let inflight = false

const state = () => useStore.getState()
const set = useStore.setState

function remember(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id)
    else localStorage.removeItem(LAST_KEY)
  } catch {
    // private mode etc.; only a convenience
  }
}

function lastOpened(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/** Point the image at the server copy for this layout (ids change on duplicate/import). */
function withServerImage(p: Project, id: string, imageVersion: number | null): Project {
  if (!p.image || imageVersion == null) return p
  return { ...p, image: { ...p.image, src: imageUrl(id, imageVersion) } }
}

function show(id: string, project: Project, revision: number, imageVersion: number | null, dirty: boolean) {
  set({
    layoutId: id,
    project,
    revision,
    imageVersion,
    dirty,
    conflict: null,
    saveState: dirty ? 'pending' : 'saved',
    selectedRoomId: null,
    wizard: null,
  })
  remember(id)
}

function scheduleSave(delay = SAVE_DELAY) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flush, delay)
}

/** Push the current edits to the server. */
export async function flush(force = false) {
  const s = state()
  if (!s.layoutId || (!s.dirty && !force) || inflight) return
  if (s.saveState === 'conflict' && !force) return
  inflight = true
  const { layoutId, project: sent, revision } = s
  set({ saveState: 'saving' })
  try {
    const res = await api.save(layoutId, sent, revision, force)
    if (state().layoutId !== layoutId) return
    const still = state().project !== sent
    set({ revision: res.revision, dirty: still, saveState: still ? 'pending' : 'saved', conflict: null })
    await idbSet(localKey(layoutId), { data: state().project, revision: res.revision, dirty: still } satisfies LocalCopy)
    if (still) scheduleSave()
  } catch (err) {
    if (state().layoutId !== layoutId) return
    if (err instanceof ConflictError) {
      set({ saveState: 'conflict', conflict: { revision: err.revision, updatedAt: err.updatedAt } })
    } else if (err instanceof AuthError) {
      set({ saveState: 'error', boot: 'needs-key' })
    } else {
      set({ saveState: err instanceof NetworkError ? 'offline' : 'error' })
      scheduleSave(RETRY_DELAY)
    }
  } finally {
    inflight = false
  }
}

let started = false

/** Called once at startup. */
export async function boot() {
  if (!started) {
    started = true
    // Keep a local copy of every edit and queue it for the server.
    useStore.subscribe((s, prev) => {
      if (s.project === prev.project || !s.dirty || !s.layoutId) return
      idbSet(localKey(s.layoutId), { data: s.project, revision: s.revision, dirty: true } satisfies LocalCopy).catch(() => {})
      if (s.saveState !== 'conflict') {
        if (s.saveState === 'saved') set({ saveState: 'pending' })
        scheduleSave()
      }
    })
    window.addEventListener('online', () => scheduleSave(0))
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush())
  }

  set({ boot: 'loading' })
  try {
    await api.list()
  } catch (err) {
    if (err instanceof AuthError) return set({ boot: 'needs-key' })
    // Offline at startup: carry on with this device's copy of the last layout, if any.
    const id = lastOpened()
    const local = id ? await idbGet<LocalCopy>(localKey(id)) : undefined
    if (id && local) {
      show(id, normalizeProject(local.data), local.revision, null, local.dirty)
      set({ boot: 'ready', saveState: 'offline', tab: 'measure' })
      scheduleSave(RETRY_DELAY)
      return
    }
    return set({ boot: 'unreachable' })
  }

  await migrateBrowserOnlyProject()
  set({ boot: 'ready' })
  const id = lastOpened()
  if (id) {
    try {
      await openLayout(id)
      return
    } catch {
      remember(null)
    }
  }
  set({ tab: 'layouts' })
}

export async function login(key: string) {
  await api.login(key)
  await boot()
}

export async function openLayout(id: string, tab: Tab = 'plan') {
  await flush()
  const layout = await api.get(id)
  const server = withServerImage(normalizeProject(layout.data), layout.id, layout.imageVersion)
  const local = await idbGet<LocalCopy>(localKey(id))

  if (local?.dirty && local.revision === layout.revision) {
    // Unsent edits made on this device on top of the latest server copy: keep them.
    show(id, withServerImage(normalizeProject(local.data), id, layout.imageVersion), layout.revision, layout.imageVersion, true)
    scheduleSave(0)
  } else if (local?.dirty) {
    // Unsent edits here, but the layout also changed elsewhere: let the user choose.
    show(id, withServerImage(normalizeProject(local.data), id, layout.imageVersion), local.revision, layout.imageVersion, true)
    set({ saveState: 'conflict', conflict: { revision: layout.revision, updatedAt: layout.updatedAt } })
  } else {
    show(id, server, layout.revision, layout.imageVersion, false)
    await idbSet(localKey(id), { data: server, revision: layout.revision, dirty: false } satisfies LocalCopy)
  }
  set({ tab })
}

/** Conflict resolution: "theirs" reloads the server copy, "mine" overwrites it. */
export async function resolveConflict(choice: 'theirs' | 'mine') {
  const id = state().layoutId
  if (!id) return
  if (choice === 'mine') {
    set({ saveState: 'pending', conflict: null })
    await flush(true)
  } else {
    await idbDel(localKey(id))
    set({ dirty: false })
    await openLayout(id, state().tab)
  }
}

export function closeLayout() {
  flush()
  set({ layoutId: null, project: emptyProject(), dirty: false, saveState: 'saved', conflict: null, tab: 'layouts' })
  remember(null)
}

export async function createLayout(name: string) {
  const layout = await api.create(emptyProject(name))
  await openLayout(layout.id, 'plan')
}

export async function duplicateLayout(id: string) {
  if (id === state().layoutId) await flush()
  return api.duplicate(id)
}

export async function renameLayout(id: string, name: string) {
  if (id === state().layoutId) {
    // Goes through the normal save so this tab's revision stays in step.
    state().setName(name)
    return
  }
  await api.rename(id, name)
}

export async function deleteLayout(id: string) {
  await api.remove(id)
  await idbDel(localKey(id))
  if (id === state().layoutId) closeLayout()
}

/** Upload a plan image for the open layout. */
export async function uploadPlanImage(file: Blob) {
  const id = state().layoutId
  if (!id) throw new Error('Open a layout first')
  const { blob, width, height } = await prepareImage(file)
  const { version } = await api.putImage(id, blob)
  set({ imageVersion: version })
  useStore.setState((s) => ({ project: { ...s.project, image: { src: imageUrl(id, version), width, height } }, dirty: true }))
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** A self-contained file (image embedded) for backup or moving between servers. */
export async function exportLayout(): Promise<string> {
  const p = state().project
  if (!p.image) return JSON.stringify(p)
  const blob = await (await fetch(p.image.src)).blob()
  return JSON.stringify({ ...p, image: { ...p.image, src: await blobToDataUrl(blob) } })
}

/** Create a new layout from an exported file (or an old browser-only project). */
export async function importLayout(raw: unknown): Promise<Layout> {
  const p = normalizeProject(raw)
  const layout = await api.create({ ...p, image: null })
  if (p.image?.src.startsWith('data:')) {
    const blob = await (await fetch(p.image.src)).blob()
    const { version } = await api.putImage(layout.id, blob)
    const data = { ...p, image: { ...p.image, src: imageUrl(layout.id, version) } }
    await api.save(layout.id, data, layout.revision)
  }
  return layout
}

/** Earlier versions kept a single project in this browser only; move it to the server once. */
async function migrateBrowserOnlyProject() {
  try {
    const legacy = await idbGet(LEGACY_KEY)
    if (!legacy) return
    const layout = await importLayout(legacy)
    await idbDel(LEGACY_KEY)
    remember(layout.id)
  } catch (err) {
    console.warn('Could not migrate the browser-only project', err)
  }
}
