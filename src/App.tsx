import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { LayoutsPage } from './components/LayoutsPage'
import { MeasureView } from './components/MeasureView'
import { PlanEditor } from './components/PlanEditor'
import { Report } from './components/Report'
import { SettingsPage } from './components/SettingsPage'
import { Viewer2D } from './components/Viewer2D'
import { useStore, type SaveState, type Tab } from './store'
import { boot, login, resolveConflict } from './sync'

// three.js is most of the bundle; only load it when the 3D tab opens.
const Viewer3D = lazy(() => import('./components/Viewer3D').then((m) => ({ default: m.Viewer3D })))

const TABS: { id: Tab; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'measure', label: 'Measure' },
  { id: '2d', label: '2D' },
  { id: '3d', label: '3D' },
  { id: 'report', label: 'Report' },
  { id: 'settings', label: 'Settings' },
]

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Saved',
  pending: 'Saving…',
  saving: 'Saving…',
  offline: 'Offline · kept on this device',
  conflict: 'Not saved · conflict',
  error: 'Not saved',
}

export function App() {
  const tab = useStore((s) => s.tab)
  const setTab = useStore((s) => s.setTab)
  const bootState = useStore((s) => s.boot)
  const layoutId = useStore((s) => s.layoutId)
  const name = useStore((s) => s.project.name)

  useEffect(() => {
    boot()
  }, [])

  if (bootState === 'loading') return <div className="empty">Loading…</div>
  if (bootState === 'needs-key') return <AccessKey />
  if (bootState === 'unreachable')
    return (
      <div className="empty">
        <h2>Can’t reach the server</h2>
        <p>Check your connection, or that the app server is running.</p>
        <button className="btn primary" onClick={() => boot()}>
          Try again
        </button>
      </div>
    )

  const current: Tab = layoutId ? tab : 'layouts'

  return (
    <div className="app">
      <header className="topbar">
        <button className={`layout-switch${current === 'layouts' ? ' on' : ''}`} onClick={() => setTab('layouts')} title="All layouts">
          <span className="layout-name">{layoutId ? name : 'Layouts'}</span>
          <span aria-hidden>▾</span>
        </button>
        {layoutId && (
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={t.id === current ? 'on' : ''} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        )}
        {layoutId && <SaveStatus />}
      </header>
      <ConflictBanner />
      <main>
        {current === 'layouts' && <LayoutsPage />}
        {current === 'plan' && <PlanEditor />}
        {current === 'measure' && <MeasureView />}
        {current === '2d' && <Viewer2D />}
        {current === '3d' && (
          <Suspense fallback={<div className="empty">Loading 3D…</div>}>
            <Viewer3D />
          </Suspense>
        )}
        {current === 'report' && <Report />}
        {current === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}

function SaveStatus() {
  const saveState = useStore((s) => s.saveState)
  return (
    <span className={`save-status ${saveState}`} title={SAVE_LABEL[saveState]}>
      <span className="dot" />
      <span className="save-label">{SAVE_LABEL[saveState]}</span>
    </span>
  )
}

function ConflictBanner() {
  const conflict = useStore((s) => s.conflict)
  const [busy, setBusy] = useState(false)
  if (!conflict) return null
  const choose = async (c: 'theirs' | 'mine') => {
    setBusy(true)
    try {
      await resolveConflict(c)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="banner warn">
      <span>
        This layout was changed on another device ({new Date(conflict.updatedAt).toLocaleString()}). Your changes here
        aren’t saved yet.
      </span>
      <span className="row">
        <button className="btn small" disabled={busy} onClick={() => choose('theirs')}>
          Load the other version
        </button>
        <button className="btn small" disabled={busy} onClick={() => choose('mine')}>
          Keep mine
        </button>
      </span>
    </div>
  )
}

function AccessKey() {
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await login(key)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <form className="empty" onSubmit={submit}>
      <h2>Access key</h2>
      <p>This server is protected. Enter the access key it was started with.</p>
      <input type="password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
      <button className="btn primary">Continue</button>
      {error && <div className="callout warn">{error}</div>}
    </form>
  )
}
