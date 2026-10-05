import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ImageFiles } from './images.ts'

/** Append-only; each entry runs once, tracked with PRAGMA user_version. */
const MIGRATIONS = [
  `
  CREATE TABLE layouts (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    data       TEXT NOT NULL CHECK (json_valid(data)),
    revision   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- The image itself is a file on disk (see images.ts); this row points at it.
  CREATE TABLE layout_images (
    layout_id  TEXT PRIMARY KEY REFERENCES layouts(id) ON DELETE CASCADE,
    mime       TEXT NOT NULL,
    file_name  TEXT NOT NULL,
    version    INTEGER NOT NULL
  );
  `,
]

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return db
}

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

export type SaveResult =
  | { status: 'ok'; revision: number; updatedAt: string }
  | { status: 'conflict'; revision: number; updatedAt: string }
  | { status: 'not-found' }

const nameOf = (data: unknown) => {
  const n = (data as { name?: unknown } | null)?.name
  return typeof n === 'string' && n.trim() ? n.trim() : 'Untitled'
}

const SUMMARY_COLUMNS = `
  l.id, l.name, l.revision, l.created_at AS createdAt, l.updated_at AS updatedAt,
  coalesce(json_array_length(l.data, '$.rooms'), 0) AS roomCount,
  i.version AS imageVersion`

export function layoutRepo(db: DatabaseSync, files: ImageFiles) {
  const now = () => new Date().toISOString()

  const get = (id: string): Layout | undefined => {
    const row = db
      .prepare(`SELECT ${SUMMARY_COLUMNS}, l.data FROM layouts l LEFT JOIN layout_images i ON i.layout_id = l.id WHERE l.id = ?`)
      .get(id) as (LayoutSummary & { data: string }) | undefined
    return row && { ...row, data: JSON.parse(row.data) }
  }

  const imageRow = (id: string) =>
    db.prepare('SELECT mime, file_name AS fileName, version FROM layout_images WHERE layout_id = ?').get(id) as
      | { mime: string; fileName: string; version: number }
      | undefined

  const create = (data: unknown): Layout => {
    const id = randomUUID()
    const t = now()
    db.prepare('INSERT INTO layouts (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      nameOf(data),
      JSON.stringify(data),
      t,
      t,
    )
    return get(id)!
  }

  return {
    list(): LayoutSummary[] {
      return db
        .prepare(`SELECT ${SUMMARY_COLUMNS} FROM layouts l LEFT JOIN layout_images i ON i.layout_id = l.id ORDER BY l.updated_at DESC`)
        .all() as unknown as LayoutSummary[]
    },

    get,

    create,

    /** Optimistic concurrency: only saves if the client edited the latest revision (unless forced). */
    save(id: string, data: unknown, baseRevision: number, force = false): SaveResult {
      const t = now()
      const res = db
        .prepare(
          `UPDATE layouts SET data = ?, name = ?, revision = revision + 1, updated_at = ?
           WHERE id = ? AND (revision = ? OR ?)`,
        )
        .run(JSON.stringify(data), nameOf(data), t, id, baseRevision, force ? 1 : 0)
      const row = db.prepare('SELECT revision, updated_at AS updatedAt FROM layouts WHERE id = ?').get(id) as
        | { revision: number; updatedAt: string }
        | undefined
      if (!row) return { status: 'not-found' }
      return { status: res.changes ? 'ok' : 'conflict', ...row }
    },

    rename(id: string, name: string): boolean {
      const res = db
        .prepare(
          `UPDATE layouts SET name = ?, data = json_set(data, '$.name', ?), revision = revision + 1, updated_at = ? WHERE id = ?`,
        )
        .run(name, name, now(), id)
      return res.changes > 0
    },

    remove(id: string): boolean {
      const removed = db.prepare('DELETE FROM layouts WHERE id = ?').run(id).changes > 0
      if (removed) files.removeAll(id)
      return removed
    },

    duplicate(id: string): Layout | undefined {
      const src = get(id)
      if (!src) return undefined
      const data = { ...(src.data as object), name: `${src.name} (copy)` }
      const copy = create(data)
      const img = imageRow(id)
      if (img) {
        db.prepare('INSERT INTO layout_images (layout_id, mime, file_name, version) VALUES (?, ?, ?, ?)').run(
          copy.id,
          img.mime,
          files.copy(img.fileName, copy.id),
          img.version,
        )
      }
      return get(copy.id)
    },

    putImage(id: string, mime: string, bytes: Uint8Array): number | undefined {
      if (!db.prepare('SELECT 1 FROM layouts WHERE id = ?').get(id)) return undefined
      const old = imageRow(id)
      const version = (old?.version ?? 0) + 1
      const fileName = files.write(id, version, mime, bytes)
      db.prepare(
        `INSERT INTO layout_images (layout_id, mime, file_name, version) VALUES (?, ?, ?, ?)
         ON CONFLICT (layout_id) DO UPDATE SET mime = excluded.mime, file_name = excluded.file_name, version = excluded.version`,
      ).run(id, mime, fileName, version)
      if (old && old.fileName !== fileName) files.remove(old.fileName)
      return version
    },

    getImage(id: string): { mime: string; bytes: Uint8Array; version: number } | undefined {
      const img = imageRow(id)
      if (!img) return undefined
      try {
        return { mime: img.mime, version: img.version, bytes: files.read(img.fileName) }
      } catch {
        return undefined // row exists but the file went missing
      }
    },
  }
}

export type LayoutRepo = ReturnType<typeof layoutRepo>
