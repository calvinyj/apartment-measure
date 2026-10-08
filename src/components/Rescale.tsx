import { useMemo, useState, type ReactNode } from 'react'
import { fitScale, withScale } from '../geometry/scale'
import { useStore } from '../store'
import type { Calibration } from '../types'
import { formatLength } from '../units'

/** Under this the plan is about as good as plans get; not worth a nudge. */
const NUDGE_OFF = 0.01
const NUDGE_WALLS = 3

/**
 * Fits the plan's scale to the walls measured on site. As a `nudge` it only shows once
 * there's enough to go on and the plan is noticeably off. `onChange` hears about every
 * calibration it sets (rescale and undo).
 */
export function RescaleToMeasurements({ nudge = false, onChange }: { nudge?: boolean; onChange?: (c: Calibration) => void }) {
  const project = useStore((s) => s.project)
  const setCalibration = useStore((s) => s.setCalibration)
  const fit = useMemo(() => fitScale(project), [project])
  const [done, setDone] = useState<{ from: Calibration; to: Calibration } | null>(null)
  const c = project.calibration
  const unit = project.settings.inputUnit
  if (!c) return null

  const apply = (next: Calibration) => {
    setCalibration(next)
    onChange?.(next)
  }

  if (done && done.to === c) {
    return (
      <div className="callout ok">
        Plan rescaled to your measurements. The dimension you set the scale with now counts as {formatLength(done.to.mm, unit)}{' '}
        (was {formatLength(done.from.mm, unit)}).
        <button
          className="btn small"
          onClick={() => {
            apply(done.from)
            setDone(null)
          }}
        >
          Undo
        </button>
      </div>
    )
  }

  const section = (body: ReactNode) => (
    <>
      <h3>Or fit it to your measurements</h3>
      {body}
    </>
  )

  if (!fit) {
    return nudge ? null : section(<p className="muted small">Once you’ve measured some walls on site, come back here to fit the scale to them.</p>)
  }
  const off = fit.factor - 1
  if (nudge && (Math.abs(off) < NUDGE_OFF || fit.used < NUDGE_WALLS)) return null

  const to = withScale(c, fit.mmPerPx)
  const rescale = () => {
    apply(to)
    setDone({ from: c, to })
  }
  const howFar = (
    <>
      On average, your {fit.used} measured wall{fit.used === 1 ? ' is' : 's are'}{' '}
      <strong>
        {Math.abs(off * 100).toFixed(1)}% {off > 0 ? 'longer' : 'shorter'}
      </strong>{' '}
      than the plan shows.
    </>
  )
  const leftOut =
    fit.outliers > 0 &&
    `${fit.outliers === 1 ? 'One wall is' : `${fit.outliers} walls are`} left out: even rescaled, ${fit.outliers === 1 ? 'it’s' : 'they’re'} more than 8% off the plan, so the plan (or the reading) is wrong there.`

  if (nudge) {
    return (
      <div className="callout">
        <div>
          <strong>The plan’s scale looks off.</strong> {howFar} Rescale it so the walls you skip get better estimates.
        </div>
        {leftOut && <div className="small">{leftOut}</div>}
        <button className="btn small" onClick={rescale}>
          Rescale the plan to match
        </button>
      </div>
    )
  }

  if (Math.abs(off) < 0.001) {
    return section(
      <p className="muted small">
        Your {fit.used} measured wall{fit.used === 1 ? ' agrees' : 's agree'} with this scale.
      </p>,
    )
  }
  return section(
    <>
      <p className="small">
        {howFar} Rescaling sets the dimension you tapped to {formatLength(to.mm, unit)} (now {formatLength(c.mm, unit)}), so the
        walls you haven’t measured get better estimates. Your measurements don’t change.
      </p>
      {leftOut && <p className="muted small">{leftOut}</p>}
      <div className="row">
        <button className="btn" onClick={rescale}>
          Rescale the plan to match
        </button>
      </div>
    </>,
  )
}
