import { useMemo, useState } from 'react'
import { normDeg } from '../geometry/facing'
import { roomAnchors } from '../geometry/lights'
import { useStore } from '../store'
import { LIGHT_KINDS, type Light, type PlugPoint } from '../types'
import { PlanImageToggle, useSolved } from './common'
import { CompassBadge } from './Compass'
import { FloorPlan, roomLabelBoxes, useFloorPlan } from './FloorPlan'
import { LightIcon, lightBoxes, LightLayer } from './Lights'
import { PlanView } from './PlanView'
import { placePlugs, plugBoxes, PlugIcon, PlugLayer } from './Plugs'

export function Viewer2D() {
  const project = useStore((s) => s.project)
  const { north } = project
  const solved = useSolved()
  const [labels, setLabels] = useState(true)
  const [dims, setDims] = useState(true)
  const [lights, setLights] = useState(true)
  const [specs, setSpecs] = useState(true)
  const [plugs, setPlugs] = useState(true)
  const [rotation, setRotation] = useState(0)
  const [resetKey, setResetKey] = useState(0)
  const plan = useFloorPlan(solved)
  const anchors = useMemo(() => roomAnchors(solved), [solved])
  const outlines = useMemo(() => new Map(solved.rooms.map((r) => [r.room.id, r.outline])), [solved])
  const mmPerPx = solved.mmPerPx

  if (!plan || !mmPerPx) {
    return (
      <div className="empty">
        <h2>Nothing to show yet</h2>
        <p>Set the plan’s scale and trace at least one room on the Plan tab.</p>
      </div>
    )
  }

  return (
    <div className="viewer2d banded">
      <div className="viewer-toolbar">
        <label className="check small">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
        </label>
        <label className="check small">
          <input type="checkbox" checked={dims} onChange={(e) => setDims(e.target.checked)} /> Dimensions
        </label>
        {project.lights.length > 0 && (
          <label className="check small">
            <input type="checkbox" checked={lights} onChange={(e) => setLights(e.target.checked)} /> Lights &amp; fans
          </label>
        )}
        {lights && project.lights.some((l) => l.watt != null || l.temp != null) && (
          <label className="check small">
            <input type="checkbox" checked={specs} onChange={(e) => setSpecs(e.target.checked)} /> Watt &amp; temp
          </label>
        )}
        {project.plugs.length > 0 && (
          <label className="check small">
            <input type="checkbox" checked={plugs} onChange={(e) => setPlugs(e.target.checked)} /> Plug points
          </label>
        )}
        <PlanImageToggle />
        <button
          className="btn small"
          title="Turn left 90° (or drag with the right mouse button, or twist with two fingers)"
          aria-label="Turn left 90°"
          onClick={() => setRotation((a) => normDeg(a - 90))}
        >
          ↺
        </button>
        <button
          className="btn small"
          title="Turn right 90° (or drag with the right mouse button, or twist with two fingers)"
          aria-label="Turn right 90°"
          onClick={() => setRotation((a) => normDeg(a + 90))}
        >
          ↻
        </button>
        {north != null && (
          <button className="btn small" onClick={() => setRotation(normDeg(-north))}>
            North up
          </button>
        )}
        <button
          className="btn small"
          onClick={() => {
            setRotation(0)
            setResetKey((k) => k + 1)
          }}
        >
          Reset view
        </button>
        {north != null && <CompassBadge north={north} turn={rotation} />}
      </div>
      <div className="band-canvas">
        <PlanView
          image={project.image}
          showImage={project.settings.showPlanImage}
          fit={plan.fit}
          fitKey={String(resetKey)}
          rotation={rotation}
          onRotate={setRotation}
          overlay={<Legend lights={lights ? project.lights : []} plugs={plugs ? project.plugs : []} />}
        >
          {(k, rot) => {
            const ke = k / mmPerPx
            const roomLabels = labels ? roomLabelBoxes(plan, ke) : []
            const placed = plugs
              ? placePlugs(project.plugs, solved, anchors, ke, rot, [
                  ...roomLabels,
                  ...(lights ? lightBoxes(project.lights, anchors, ke, rot) : []),
                ])
              : []
            return (
              // The view works in plan image pixels (so the plan image lines up); the drawing is in mm.
              <g transform={`scale(${1 / mmPerPx})`}>
                <FloorPlan
                  plan={plan}
                  solved={solved}
                  ke={ke}
                  rot={rot}
                  labels={labels}
                  dims={dims}
                  unit={project.settings.inputUnit}
                  avoid={plugBoxes(placed)}
                />
                {lights && (
                  <LightLayer
                    lights={project.lights}
                    anchors={anchors}
                    ke={ke}
                    rot={rot}
                    specs={specs}
                    avoid={[...roomLabels, ...plugBoxes(placed)]}
                    outlines={outlines}
                  />
                )}
                <PlugLayer placed={placed} ke={ke} rot={rot} />
              </g>
            )
          }}
        </PlanView>
      </div>
    </div>
  )
}

/**
 * What the symbols on the plan are: each kind of light and fan, and plug points, that's shown. It
 * starts folded on a narrow screen, where it would cover much of the plan; open, the plan fits beside it.
 */
function Legend({ lights, plugs }: { lights: Light[]; plugs: PlugPoint[] }) {
  const [open, setOpen] = useState(() => window.matchMedia('(min-width: 700px)').matches)
  const kinds = LIGHT_KINDS.filter((k) => lights.some((l) => l.kind === k.value))
  const existing = plugs.some((p) => p.existing)
  const added = plugs.some((p) => !p.existing)
  if (!kinds.length && !plugs.length) return null
  const toggle = (
    <button className="legend-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
      Legend <span aria-hidden>{open ? '▾' : '▸'}</span>
    </button>
  )
  if (!open) return <div className="plan-legend folded">{toggle}</div>
  return (
    <div className="plan-legend" data-fit-clear>
      {toggle}
      <ul>
        {kinds.map((k) => (
          <li key={k.value}>
            <LightIcon kind={k.value} />
            {k.label}
          </li>
        ))}
        {existing && (
          <li>
            <PlugIcon existing />
            Existing plug point
          </li>
        )}
        {added && (
          <li>
            <PlugIcon existing={false} />
            New plug point
          </li>
        )}
      </ul>
      {plugs.length > 0 && <p className="muted">The number is how many sockets.</p>}
    </div>
  )
}
