import type { Solved } from '../geometry/solve'
import { centroid } from '../geometry/polygon'
import { roomTypeInfo, type Room } from '../types'
import { formatArea } from '../units'

/** Room outlines drawn over the plan image, in plan pixel space. */
export function RoomShapes({
  rooms,
  solved,
  k,
  selectedId,
  dimmed,
  showArea = true,
}: {
  rooms: Room[]
  solved: Solved
  k: number
  selectedId?: string | null
  /** draw everything faint except the selected room */
  dimmed?: boolean
  showArea?: boolean
}) {
  return (
    <g>
      {rooms.map((r) => {
        const info = roomTypeInfo(r.type)
        const selected = r.id === selectedId
        const faded = dimmed && !selected
        const c = centroid(r.points)
        const s = solved.byId.get(r.id)
        const fs = 13 / k
        return (
          <g key={r.id} opacity={faded ? 0.35 : 1}>
            <polygon
              points={r.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={info.color}
              fillOpacity={selected ? 0.35 : 0.25}
              stroke={selected ? '#2563eb' : info.color}
              strokeWidth={selected ? 3 : 2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            {r.edges.map((e, i) =>
              e.kind === 'open' ? (
                <line
                  key={e.id}
                  x1={r.points[i].x}
                  y1={r.points[i].y}
                  x2={r.points[(i + 1) % r.points.length].x}
                  y2={r.points[(i + 1) % r.points.length].y}
                  stroke="#fff"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
            {!faded && (
              <text x={c.x} y={c.y} fontSize={fs} textAnchor="middle" className="plan-label">
                <tspan x={c.x} dy={showArea && s && solved.mmPerPx ? -fs * 0.2 : fs * 0.35} fontWeight={600}>
                  {r.name}
                </tspan>
                {showArea && s && solved.mmPerPx && (
                  <tspan x={c.x} dy={fs * 1.2}>
                    {formatArea(s.area)}
                    {s.status !== 'complete' ? ' (est.)' : ''}
                  </tspan>
                )}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
