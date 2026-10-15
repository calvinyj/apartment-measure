import { create } from 'zustand'
import { DEFAULT_TUBE } from './geometry/lights'
import { signedArea } from './geometry/polygon'
import {
  DEFAULT_SETTINGS,
  type Cabinet,
  type Calibration,
  type Edge,
  type FurnitureItem,
  type Light,
  type Opening,
  type PlugPoint,
  type Project,
  type Room,
  type RoomType,
  type Settings,
  type Vec2,
} from './types'

/** crypto.randomUUID is missing on plain-http LAN origins (phone testing), so fall back. */
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const newEdge = (): Edge => ({ id: uid(), kind: 'wall', measured: null, thickness: null, side: 'auto', openings: [] })

export const emptyProject = (name = 'My apartment'): Project => ({
  version: 3,
  name,
  image: null,
  calibration: null,
  rooms: [],
  settings: { ...DEFAULT_SETTINGS },
  advertised: null,
  north: null,
  lights: [],
  plugs: [],
  cabinets: [],
  furniture: [],
})

/** Accepts current and older saved/exported shapes. */
export function normalizeProject(raw: unknown): Project {
  const p = raw as Partial<Project> & { image?: { src?: string; dataUrl?: string; width: number; height: number } | null }
  if (!p || typeof p !== 'object' || !Array.isArray(p.rooms)) throw new Error('Not an apartment-measure layout')
  const img = p.image
  // Before v3, "sunny" was a plain checkbox; an unticked one now means "work it out from the compass".
  const rooms = ((p.version as number | undefined) ?? 1) < 3 ? p.rooms.map((r) => ({ ...r, sunny: r.sunny ? true : null })) : p.rooms
  return {
    ...emptyProject(),
    ...p,
    version: 3,
    rooms,
    north: typeof p.north === 'number' ? p.north : null,
    // Lights saved before they had a size, power, colour temperature or model.
    lights: Array.isArray(p.lights)
      ? p.lights.map((l) => ({
          ...l,
          size: l.size ?? (l.kind === 'strip' ? DEFAULT_TUBE : null),
          watt: l.watt ?? null,
          temp: l.temp ?? null,
          model: l.model ?? '',
        }))
      : [],
    plugs: Array.isArray(p.plugs) ? p.plugs.map((x) => ({ ...x, note: x.note ?? '' })) : [],
    cabinets: Array.isArray(p.cabinets) ? p.cabinets : [],
    furniture: Array.isArray(p.furniture) ? p.furniture : [],
    image: img ? { src: img.src ?? img.dataUrl ?? '', width: img.width, height: img.height } : null,
    settings: { ...DEFAULT_SETTINGS, ...p.settings },
  }
}

export type Tab =
  | 'layouts'
  | 'plan'
  | 'measure'
  | '2d'
  | '3d'
  | 'lighting'
  | 'cabinets'
  | 'furniture'
  | 'report'
  | 'settings'
export type WizardStep = 'room' | number | 'summary'
export type CabinetStep = 'walls' | 'type' | 'size' | 'fronts' | 'top' | 'finish' | 'review'
export type SaveState = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'error'

interface State {
  project: Project
  /** server id of the open layout; null when none is open */
  layoutId: string | null
  /** server revision the in-memory project is based on */
  revision: number
  imageVersion: number | null
  /** in-memory edits not yet confirmed by the server */
  dirty: boolean
  saveState: SaveState
  conflict: { revision: number; updatedAt: string } | null
  boot: 'loading' | 'ready' | 'needs-key' | 'unreachable'
  tab: Tab
  selectedRoomId: string | null
  wizard: { roomId: string; step: WizardStep } | null
  /** the cabinet open on the Cabinets tab (null id: a new one, until its wall is picked), and its step */
  cabinetEdit: { id: string | null; step: CabinetStep } | null

  setTab: (t: Tab) => void
  select: (id: string | null) => void
  setWizard: (w: State['wizard']) => void
  setCabinetEdit: (e: State['cabinetEdit']) => void

  setName: (name: string) => void
  setCalibration: (c: Calibration | null) => void
  updateSettings: (patch: Partial<Settings>) => void
  setAdvertised: (a: Project['advertised']) => void
  setNorth: (deg: number | null) => void

  addRoom: (points: Vec2[], type?: RoomType) => string
  updateRoom: (id: string, patch: Partial<Room>) => void
  deleteRoom: (id: string) => void
  moveVertex: (id: string, index: number, p: Vec2) => void
  insertVertex: (id: string, edgeIndex: number, p: Vec2) => void
  deleteVertex: (id: string, index: number) => void

  updateEdge: (id: string, index: number, patch: Partial<Edge>) => void
  addOpening: (id: string, index: number, o: Omit<Opening, 'id'>) => void
  updateOpening: (id: string, index: number, openingId: string, patch: Partial<Opening>) => void
  removeOpening: (id: string, index: number, openingId: string) => void

  addLight: (light: Omit<Light, 'id'>) => string
  updateLight: (id: string, patch: Partial<Light>) => void
  updateLights: (ids: string[], patch: Partial<Light>) => void
  removeLight: (id: string) => void

  addPlug: (plug: Omit<PlugPoint, 'id'>) => string
  updatePlug: (id: string, patch: Partial<PlugPoint>) => void
  removePlug: (id: string) => void

  addCabinet: (cabinet: Omit<Cabinet, 'id'>) => string
  updateCabinet: (id: string, patch: Partial<Cabinet>) => void
  removeCabinet: (id: string) => void

  addFurniture: (item: Omit<FurnitureItem, 'id'>) => string
  /** one item, or several (e.g. all those at one spot) */
  updateFurniture: (id: string | string[], patch: Partial<FurnitureItem>) => void
  removeFurniture: (id: string) => void
}

const mapRoom = (p: Project, id: string, f: (r: Room) => Room): Project => ({
  ...p,
  rooms: p.rooms.map((r) => (r.id === id ? f(r) : r)),
})

const mapEdge = (r: Room, index: number, f: (e: Edge) => Edge): Room => ({
  ...r,
  edges: r.edges.map((e, i) => (i === index ? f(e) : e)),
})

export const useStore = create<State>((set, get) => {
  // Every user edit goes through here, which is what marks the layout as needing a save.
  const edit = (f: (p: Project) => Project) => set({ project: f(get().project), dirty: true })

  return {
    project: emptyProject(),
    layoutId: null,
    revision: 0,
    imageVersion: null,
    dirty: false,
    saveState: 'saved',
    conflict: null,
    boot: 'loading',
    tab: 'layouts',
    selectedRoomId: null,
    wizard: null,
    cabinetEdit: null,

    setTab: (tab) => set({ tab }),
    select: (selectedRoomId) => set({ selectedRoomId }),
    setWizard: (wizard) => set({ wizard }),
    setCabinetEdit: (cabinetEdit) => set({ cabinetEdit }),

    setName: (name) => edit((p) => ({ ...p, name })),
    setCalibration: (calibration) => edit((p) => ({ ...p, calibration })),
    updateSettings: (patch) => edit((p) => ({ ...p, settings: { ...p.settings, ...patch } })),
    setAdvertised: (advertised) => edit((p) => ({ ...p, advertised })),
    setNorth: (north) => edit((p) => ({ ...p, north })),

    addRoom: (points, type = 'bedroom') => {
      const pts = signedArea(points) < 0 ? [...points].reverse() : points
      const id = uid()
      const count = get().project.rooms.length + 1
      const room: Room = {
        id,
        name: `Room ${count}`,
        type,
        points: pts,
        edges: pts.map(newEdge),
        height: null,
        acZone: '',
        ac: null,
        sunny: null,
      }
      edit((p) => ({ ...p, rooms: [...p.rooms, room] }))
      return id
    },
    updateRoom: (id, patch) => edit((p) => mapRoom(p, id, (r) => ({ ...r, ...patch }))),
    deleteRoom: (id) =>
      set((s) => ({
        project: {
          ...s.project,
          rooms: s.project.rooms.filter((r) => r.id !== id),
          lights: s.project.lights.filter((l) => l.roomId !== id),
          plugs: s.project.plugs.filter((x) => x.roomId !== id),
          furniture: s.project.furniture.filter((x) => x.roomId !== id),
        },
        dirty: true,
        selectedRoomId: s.selectedRoomId === id ? null : s.selectedRoomId,
        wizard: s.wizard?.roomId === id ? null : s.wizard,
      })),
    moveVertex: (id, index, pt) =>
      edit((p) => mapRoom(p, id, (r) => ({ ...r, points: r.points.map((q, i) => (i === index ? pt : q)) }))),
    insertVertex: (id, edgeIndex, pt) =>
      edit((p) =>
        mapRoom(p, id, (r) => {
          // Splitting a wall invalidates its measurement; openings stay on the first half.
          const old = r.edges[edgeIndex]
          const points = [...r.points]
          points.splice(edgeIndex + 1, 0, pt)
          const edges = [...r.edges]
          edges.splice(edgeIndex, 1, { ...old, measured: null }, { ...newEdge(), kind: old.kind, thickness: old.thickness, side: old.side, openAir: old.openAir, paint: old.paint })
          return { ...r, points, edges }
        }),
      ),
    deleteVertex: (id, index) =>
      edit((p) =>
        mapRoom(p, id, (r) => {
          if (r.points.length <= 3) return r
          const n = r.points.length
          const prev = (index - 1 + n) % n
          const points = r.points.filter((_, i) => i !== index)
          // The previous edge absorbs this one; its length changed so drop the measurement.
          const edges = r.edges
            .map((e, i) => (i === prev ? { ...e, measured: null, openings: [...e.openings, ...r.edges[index].openings] } : e))
            .filter((_, i) => i !== index)
          return { ...r, points, edges }
        }),
      ),

    updateEdge: (id, index, patch) => edit((p) => mapRoom(p, id, (r) => mapEdge(r, index, (e) => ({ ...e, ...patch })))),
    addOpening: (id, index, o) =>
      edit((p) => mapRoom(p, id, (r) => mapEdge(r, index, (e) => ({ ...e, openings: [...e.openings, { ...o, id: uid() }] })))),
    updateOpening: (id, index, openingId, patch) =>
      edit((p) =>
        mapRoom(p, id, (r) =>
          mapEdge(r, index, (e) => ({ ...e, openings: e.openings.map((o) => (o.id === openingId ? { ...o, ...patch } : o)) })),
        ),
      ),
    removeOpening: (id, index, openingId) =>
      edit((p) =>
        mapRoom(p, id, (r) => mapEdge(r, index, (e) => ({ ...e, openings: e.openings.filter((o) => o.id !== openingId) }))),
      ),

    addLight: (light) => {
      const id = uid()
      edit((p) => ({ ...p, lights: [...p.lights, { ...light, id }] }))
      return id
    },
    updateLight: (id, patch) =>
      edit((p) => ({ ...p, lights: p.lights.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
    updateLights: (ids, patch) =>
      edit((p) => ({ ...p, lights: p.lights.map((l) => (ids.includes(l.id) ? { ...l, ...patch } : l)) })),
    removeLight: (id) => edit((p) => ({ ...p, lights: p.lights.filter((l) => l.id !== id) })),

    addPlug: (plug) => {
      const id = uid()
      edit((p) => ({ ...p, plugs: [...p.plugs, { ...plug, id }] }))
      return id
    },
    updatePlug: (id, patch) =>
      edit((p) => ({ ...p, plugs: p.plugs.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    removePlug: (id) => edit((p) => ({ ...p, plugs: p.plugs.filter((x) => x.id !== id) })),

    addCabinet: (cabinet) => {
      const id = uid()
      edit((p) => ({ ...p, cabinets: [...p.cabinets, { ...cabinet, id }] }))
      return id
    },
    updateCabinet: (id, patch) =>
      edit((p) => ({ ...p, cabinets: p.cabinets.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    removeCabinet: (id) =>
      set((s) => ({
        project: { ...s.project, cabinets: s.project.cabinets.filter((c) => c.id !== id) },
        dirty: true,
        cabinetEdit: s.cabinetEdit?.id === id ? null : s.cabinetEdit,
      })),

    addFurniture: (item) => {
      const id = uid()
      edit((p) => ({ ...p, furniture: [...p.furniture, { ...item, id }] }))
      return id
    },
    updateFurniture: (id, patch) => {
      const ids = typeof id === 'string' ? [id] : id
      edit((p) => ({ ...p, furniture: p.furniture.map((x) => (ids.includes(x.id) ? { ...x, ...patch } : x)) }))
    },
    removeFurniture: (id) => edit((p) => ({ ...p, furniture: p.furniture.filter((x) => x.id !== id) })),
  }
})

/** Decode, downscale very large photos, and re-encode as JPEG for upload. */
export async function prepareImage(file: Blob, maxSide = 3000): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('Could not read that image'))
      el.src = url
    })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.round(img.naturalWidth * k)
    const height = Math.round(img.naturalHeight * k)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error('Could not encode that image')
    return { blob, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadFile(name: string, content: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
