import { useEffect, useState, type FormEvent } from 'react'
import { api, type LayoutSummary } from '../api'
import { useStore } from '../store'
import { createLayout, deleteLayout, duplicateLayout, importLayout, openLayout, renameLayout } from '../sync'

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function ago(iso: string) {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ]
  let v = s
  for (const [unit, size] of steps) {
    if (Math.abs(v) < size) return rtf.format(Math.round(v), unit)
    v /= size
  }
  return ''
}

export function LayoutsPage() {
  const currentId = useStore((s) => s.layoutId)
  const currentName = useStore((s) => s.project.name)
  const [layouts, setLayouts] = useState<LayoutSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await f()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const refresh = () => run(async () => setLayouts(await api.list()))

  useEffect(() => {
    refresh()
  }, [])

  const create = (e: FormEvent) => {
    e.preventDefault()
    run(() => createLayout(name.trim() || 'My apartment'))
  }

  return (
    <div className="page narrow">
      <h2>Layouts</h2>
      <p className="muted">
        Each layout is one apartment or floor plan, stored in the app’s database and available on all your devices.
      </p>

      <form className="row" onSubmit={create}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New layout name, e.g. Block B 12-3" />
        <button className="btn primary" disabled={busy}>
          Create
        </button>
      </form>

      {error && <div className="callout warn">{error}</div>}

      {layouts == null ? (
        <p className="muted">Loading…</p>
      ) : layouts.length === 0 ? (
        <div className="card">
          <p>No layouts yet. Create one above, then upload its floor plan.</p>
        </div>
      ) : (
        <ul className="layout-list">
          {layouts.map((l) => {
            const isCurrent = l.id === currentId
            const shownName = isCurrent ? currentName : l.name
            return (
              <li key={l.id} className={`card${isCurrent ? ' current' : ''}`}>
                {renaming?.id === l.id ? (
                  <form
                    className="row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const n = renaming.name.trim()
                      if (!n) return
                      run(async () => {
                        await renameLayout(l.id, n)
                        setRenaming(null)
                        setLayouts(await api.list())
                      })
                    }}
                  >
                    <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: l.id, name: e.target.value })} />
                    <button className="btn primary small">Save</button>
                    <button type="button" className="btn ghost small" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <div className="row between">
                    <div>
                      <strong>{shownName}</strong> {isCurrent && <span className="badge ok">open</span>}
                      <div className="muted small">
                        {l.roomCount} room{l.roomCount === 1 ? '' : 's'} · {l.imageVersion ? 'plan uploaded' : 'no plan yet'} · updated{' '}
                        {ago(l.updatedAt)}
                      </div>
                    </div>
                    <button className="btn primary small" disabled={busy} onClick={() => run(() => openLayout(l.id))}>
                      Open
                    </button>
                  </div>
                )}
                <div className="row wrap">
                  <button className="btn ghost small" onClick={() => setRenaming({ id: l.id, name: shownName })}>
                    Rename
                  </button>
                  <button className="btn ghost small" disabled={busy} onClick={() =>
                      run(async () => {
                        await duplicateLayout(l.id)
                        setLayouts(await api.list())
                      })
                    }>
                    Duplicate
                  </button>
                  <button
                    className="btn ghost small danger"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`Delete “${shownName}”? This can’t be undone.`)) return
                      run(async () => {
                        await deleteLayout(l.id)
                        setLayouts(await api.list())
                      })
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="row">
        <label className="btn">
          Import from file
          <input
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) run(async () => openLayout((await importLayout(JSON.parse(await f.text()))).id))
            }}
          />
        </label>
        <span className="muted small">Files exported from Settings → Export layout.</span>
      </div>
    </div>
  )
}
