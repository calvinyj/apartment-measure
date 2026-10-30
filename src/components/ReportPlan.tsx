import type { Solved } from '../geometry/solve'
import { useStore } from '../store'
import type { LengthUnit } from '../types'
import { useWidth } from './common'
import { FloorPlan, PLAN_CUT, useFloorPlan, type FloorPlanData } from './FloorPlan'

/** Clear space round the drawing, px. */
const PAD = 8

export const PLAN_NOTE = `Drawn from the measurements, with the walls cut at ${PLAN_CUT / 1000} m: a gap in a wall is a door or opening, a white band a window. Each length is a wall’s inside face; ≈ marks one worked out from the other walls, not measured.`

/**
 * The measured layout with only the room labels and wall lengths, as large as fits in `width` × `maxHeight`
 * px and as wide as `width`. Its text is sized for that, so it reads the same however large it's shown.
 */
export function PlanDrawing({
  plan,
  solved,
  unit,
  width,
  maxHeight,
}: {
  plan: FloorPlanData
  solved: Solved
  unit: LengthUnit
  width: number
  maxHeight: number
}) {
  const { box } = plan.walls
  // Screen px per mm.
  const ke = Math.min((width - 2 * PAD) / box.w, (maxHeight - 2 * PAD) / box.h)
  const height = box.h * ke + 2 * PAD
  // Centred across the width.
  const minX = box.minX - (width / ke - box.w) / 2
  const minY = box.minY - PAD / ke
  return (
    <svg width={width} height={height} viewBox={`${minX} ${minY} ${width / ke} ${height / ke}`} className="report-plan">
      <FloorPlan plan={plan} solved={solved} ke={ke} labels dims unit={unit} />
    </svg>
  )
}

/** Narrower than this, the plan is drawn this wide and shrunk to fit, text and all, so room names don't run into each other. */
const MIN_WIDTH = 480

/** The report's floor plan, as wide as its card. */
export function ReportPlan({ solved }: { solved: Solved }) {
  const unit = useStore((s) => s.project.settings.inputUnit)
  const plan = useFloorPlan(solved)
  const [ref, width] = useWidth()
  const drawn = Math.max(width, MIN_WIDTH)
  return (
    <>
      <div ref={ref} className="report-plan-fit">
        {plan && width > 0 && <PlanDrawing plan={plan} solved={solved} unit={unit} width={drawn} maxHeight={(560 * drawn) / width} />}
      </div>
      <p className="muted small">{PLAN_NOTE}</p>
    </>
  )
}
