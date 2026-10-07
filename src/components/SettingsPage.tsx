import { useState } from 'react'
import { downloadFile, useStore } from '../store'
import { exportLayout, uploadPlanImage } from '../sync'
import type { LengthUnit, TraceMode } from '../types'
import { ColorInput, Field, LengthInput, Segmented, useSolved } from './common'

const TRACE_LABEL: Record<Exclude<TraceMode, 'auto'>, string> = {
  inside: 'Inside face',
  centre: 'Centre line',
  outside: 'Outside face',
}

export function SettingsPage() {
  const project = useStore((s) => s.project)
  const { updateSettings, setName, setCalibration, setTab } = useStore.getState()
  const s = project.settings
  const solved = useSolved()
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
        <h3>Paint</h3>
        <Field
          label="Wall paint colour"
          hint="Hex colour code for the inside of every wall in the 3D view. Change a single wall on its Measure step. The outside of the unit stays off-white."
        >
          <ColorInput value={s.wallPaint} onChange={(wallPaint) => updateSettings({ wallPaint })} />
        </Field>
      </section>

      <section className="card stack">
        <h3>Tracing</h3>
        <Field
          label="Outer walls were traced along their"
          hint={
            <>
              Shared walls are worked out from the gap between rooms. Outer walls have no neighbour, so this says which line
              you followed. Auto copies what you did on shared walls — currently <strong>{TRACE_LABEL[solved.traceMode].toLowerCase()}</strong>.
            </>
          }
        >
          <select value={s.traceMode} onChange={(e) => updateSettings({ traceMode: e.target.value as TraceMode })}>
            <option value="auto">Auto</option>
            <option value="inside">{TRACE_LABEL.inside}</option>
            <option value="centre">{TRACE_LABEL.centre}</option>
            <option value="outside">{TRACE_LABEL.outside}</option>
          </select>
        </Field>
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
          <Field label="Allowed shortfall (%)" hint="An installed unit still counts as enough if the estimate is up to this much above its rating.">
            <input
              inputMode="decimal"
              defaultValue={Math.round(s.acShortfall * 100)}
              onChange={(e) => updateSettings({ acShortfall: num(e.target.value, s.acShortfall * 100) / 100 })}
            />
          </Field>
        </div>
      </section>
    </div>
  )
}
