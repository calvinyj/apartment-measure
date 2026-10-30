import { useEffect, useMemo, useRef, useState } from 'react'
import type { Solved } from '../geometry/solve'
import { svgToPng, type Png } from '../pdf/raster'
import { buildReportPdf, savePdf, type PdfImages } from '../pdf/reportPdf'
import { filledSections, REPORT_SECTIONS, type ReportSection } from '../report'
import { useStore } from '../store'
import { cabinetRows } from './CabinetReport'
import { Elevation, TopView } from './CabinetDrawings'
import { useFloorPlan } from './FloorPlan'
import { PlanDrawing } from './ReportPlan'

/** Sections left out last time, remembered on this device; a section added later starts ticked. */
const SKIP_KEY = 'apartment-measure:pdf:skip'

function loadSkip(): ReportSection[] {
  try {
    const v = JSON.parse(localStorage.getItem(SKIP_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function saveSkip(skip: ReportSection[]) {
  try {
    localStorage.setItem(SKIP_KEY, JSON.stringify(skip))
  } catch {
    // private mode etc.; only a convenience
  }
}

/**
 * Pick the report's sections, then download them as a PDF. The drawings are drawn off screen at the size
 * they'll have on the page, so they look the same whatever the screen.
 */
export function ExportPdf({ solved, onClose }: { solved: Solved; onClose: () => void }) {
  const project = useStore((s) => s.project)
  const unit = project.settings.inputUnit
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const plan = useFloorPlan(solved)
  const filled = useMemo(() => filledSections(project, solved), [project, solved])
  const [skip, setSkip] = useState(loadSkip)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = filled.filter((s) => !skip.includes(s))
  const withCabinets = chosen.includes('cabinets')
  const cabinets = useMemo(() => (withCabinets ? cabinetRows(project, solved) : []), [withCabinets, project, solved])

  useEffect(() => {
    // Effects run twice in development; it's already open the second time.
    if (!dialog.current?.open) dialog.current?.showModal()
  }, [])

  const tick = (id: ReportSection, on: boolean) => {
    const next = on ? skip.filter((s) => s !== id) : [...skip, id]
    setSkip(next)
    saveSkip(next)
  }

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      // Let drawings just ticked lay out first.
      await new Promise(requestAnimationFrame)
      await new Promise(requestAnimationFrame)
      const shot = async (key: string): Promise<Png | null> => {
        const svg = stage.current?.querySelector<SVGSVGElement>(`[data-pdf="${key}"] svg`)
        return svg ? svgToPng(svg) : null
      }
      const images: PdfImages = { plan: chosen.includes('plan') ? await shot('plan') : null, cabinets: new Map() }
      for (const { c, p } of cabinets) {
        if (p) images.cabinets.set(c.id, { front: await shot(`front-${c.id}`), top: await shot(`top-${c.id}`) })
      }
      const doc = buildReportPdf({ project, solved, chosen, images, date: new Date() })
      await savePdf(doc, `${project.name || 'apartment'}-report.pdf`)
      dialog.current?.close()
    } catch (e) {
      setError(`Couldn’t make the PDF: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <dialog ref={dialog} className="dialog" onClose={onClose}>
        <div className="stack">
          <h3>Export PDF</h3>
          <p className="muted small">Pick the sections to include.</p>
          <div className="stack tight">
            {REPORT_SECTIONS.filter((s) => filled.includes(s.id)).map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={!skip.includes(s.id)} onChange={(e) => tick(s.id, e.target.checked)} /> {s.label}
              </label>
            ))}
          </div>
          {error && <div className="callout warn small">{error}</div>}
          <div className="row dialog-actions">
            <button className="btn" onClick={() => dialog.current?.close()}>
              Cancel
            </button>
            <button className="btn primary" disabled={busy || chosen.length === 0} onClick={download}>
              {busy ? 'Making PDF…' : 'Download'}
            </button>
          </div>
        </div>
      </dialog>
      <div ref={stage} className="pdf-stage" aria-hidden>
        {plan && chosen.includes('plan') && (
          <div data-pdf="plan">
            <PlanDrawing plan={plan} solved={solved} unit={unit} width={720} maxHeight={840} />
          </div>
        )}
        {cabinets.map(
          ({ c, p }) =>
            p && (
              <div key={c.id}>
                <div data-pdf={`front-${c.id}`}>
                  <Elevation cabinet={c} placement={p} className="cab-drawing pdf-front" />
                </div>
                <div data-pdf={`top-${c.id}`}>
                  <TopView solved={solved} cabinet={c} placement={p} className="cab-drawing pdf-top" />
                </div>
              </div>
            ),
        )}
      </div>
    </>
  )
}
