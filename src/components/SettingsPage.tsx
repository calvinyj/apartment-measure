import { useState } from 'react'
import { downloadFile, useStore } from '../store'
import { exportLayout, uploadPlanImage } from '../sync'
import type { LengthUnit } from '../types'
import { Field, LengthInput, Segmented } from './common'

export function SettingsPage() {
  const project = useStore((s) => s.project)
  const { updateSettings, setName, setCalibration, setTab } = useStore.getState()
  const s = project.settings
  const [msg, setMsg] = useState<string | null>(null)
  const run = (f: () => Promise<void>) => f().catch((err: Error) => setMsg(err.message))

  const num = (v: string, fallback: number) => {
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : fallback
  }

  return (
    <div className="page narrow">
      <section className="card stack">
        <h3>Layout</h3>
        <Field label="Name">
          <input value={project.name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <p className="muted small">
          Saved automatically to the app’s database, so it’s the same on your laptop and phone. Export a file for a backup or to
          move it to another server.
        </p>
        <div className="row wrap">
          <button
            className="btn"
            onClick={() =>
              run(async () => downloadFile(`${project.name || 'apartment'}.apartment.json`, await exportLayout(), 'application/json'))
            }
          >
            Export layout
          </button>
          <label className="btn">
            Replace plan image
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                if (project.rooms.length && !confirm('Rooms are traced on the current image. Replace it anyway? (Rooms stay in place.)')) return
                run(async () => {
                  await uploadPlanImage(f)
                  setCalibration(null)
                  setMsg('New image uploaded — set the scale again on the Plan tab.')
                })
              }}
            />
          </label>
          <button className="btn ghost" onClick={() => setTab('layouts')}>
            All layouts…
          </button>
        </div>
        {msg && <div className="callout">{msg}</div>}
      </section>

      <section className="card stack">
        <h3>Measuring</h3>
        <Field label="Unit for typing lengths" hint="You can always type a unit explicitly, e.g. 3.15m or 315cm.">
          <Segmented<LengthUnit>
            value={s.inputUnit}
            onChange={(inputUnit) => updateSettings({ inputUnit })}
            options={[
              { value: 'mm', label: 'mm' },
              { value: 'cm', label: 'cm' },
              { value: 'm', label: 'm' },
            ]}
          />
        </Field>
        <div className="grid2">
          <Field label="Default ceiling height">
            <LengthInput value={s.defaultHeight} unit={s.inputUnit} onChange={(v) => v && updateSettings({ defaultHeight: v })} />
          </Field>
          <Field label="Closure tolerance" hint="How far a room may fail to close before it's flagged.">
            <LengthInput value={s.closureTolerance} unit={s.inputUnit} onChange={(v) => v && updateSettings({ closureTolerance: v })} />
          </Field>
          <Field label="Internal wall thickness">
            <LengthInput value={s.internalThickness} unit={s.inputUnit} onChange={(v) => v && updateSettings({ internalThickness: v })} />
          </Field>
          <Field label="External wall thickness">
            <LengthInput value={s.externalThickness} unit={s.inputUnit} onChange={(v) => v && updateSettings({ externalThickness: v })} />
          </Field>
        </div>
      </section>

      <section className="card stack">
        <h3>Built-up area</h3>
        <Field
          label="External walls counted"
          hint="Built-up area is often measured to the outside face of external walls (100%); some methods use the wall centreline (50%)."
        >
          <Segmented
            value={String(s.externalShare)}
            onChange={(v) => updateSettings({ externalShare: Number(v) })}
            options={[
              { value: '1', label: '100%' },
              { value: '0.5', label: '50%' },
              { value: '0', label: 'None' },
            ]}
          />
        </Field>
      </section>

      <section className="card stack">
        <h3>Aircon rule of thumb</h3>
        <div className="grid2">
          <Field label="BTU/h per ft²" hint="Malaysian installers commonly use about 60.">
            <input inputMode="decimal" defaultValue={s.acBtuPerSqft} onChange={(e) => updateSettings({ acBtuPerSqft: num(e.target.value, s.acBtuPerSqft) })} />
          </Field>
          <Field label="Sun-exposed margin" hint="Multiplier for west-facing rooms.">
            <input inputMode="decimal" defaultValue={s.acSunnyFactor} onChange={(e) => updateSettings({ acSunnyFactor: num(e.target.value, s.acSunnyFactor) })} />
          </Field>
          <Field label="Reference ceiling height" hint="Rooms taller than this need proportionally more.">
            <LengthInput value={s.acRefHeight} unit={s.inputUnit} onChange={(v) => v && updateSettings({ acRefHeight: v })} />
          </Field>
        </div>
      </section>
    </div>
  )
}
