import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Edge, type Light, type Project, type Room } from '../types'
import {
  fanSizeFor,
  fanSizeLabel,
  FAN_SIZES,
  fixtureList,
  isRound,
  lightCentre,
  lightEnds,
  lightSchedule,
  nearestWall,
  newLight,
  roomAnchors,
  roomAt,
  snapAngle,
  snapInLine,
  specsFrom,
  tempLabel,
  tubesFor,
  wallDistances,
  wattLabel,
} from './lights'
import { solveProject } from './solve'

function room(id: string, pts: [number, number][]): Room {
  const edges: Edge[] = pts.map((_, i) => ({
    id: `${id}-${i}`,
    kind: 'wall',
    measured: null,
    thickness: null,
    side: 'auto',
    openings: [],
  }))
  return {
    id,
    name: id,
    type: 'bedroom',
    points: pts.map(([x, y]) => ({ x, y })),
    edges,
    height: 2700,
    acZone: '',
    ac: null,
    sunny: null,
  }
}

// 1 px = 10 mm. Room A is 4 m × 3 m, room B (3 m × 3 m) beyond a 100 mm wall to its right.
function project(rooms: Room[]): Project {
  return {
    version: 3,
    north: null,
    lights: [],
    plugs: [],
    cabinets: [],
    name: 't',
    image: null,
    calibration: { a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, mm: 1000 },
    rooms,
    settings: { ...DEFAULT_SETTINGS, internalThickness: 100 },
    advertised: null,
  }
}
const a = room('a', [
  [0, 0],
  [400, 0],
  [400, 300],
  [0, 300],
])
const b = room('b', [
  [410, 0],
  [710, 0],
  [710, 300],
  [410, 300],
])
const solved = solveProject(project([a, b]))
const anchors = roomAnchors(solved)
const A = solved.byId.get('a')!

const light = (patch: Partial<Light>): Light => ({
  id: 'l',
  kind: 'downlight',
  roomId: 'a',
  x: 0,
  y: 0,
  angle: 0,
  length: 0,
  size: null,
  watt: null,
  temp: null,
  model: '',
  ...patch,
})

describe('lights', () => {
  it('finds the room a point is in', () => {
    expect(roomAt(solved, { x: 1000, y: 1000 })?.room.id).toBe('a')
    expect(roomAt(solved, { x: 5000, y: 1000 })?.room.id).toBe('b')
    expect(roomAt(solved, { x: 4050, y: 1000 })).toBeNull() // inside the wall
  })

  it('places a light relative to its room, so it moves with the room', () => {
    const l = newLight('downlight', A, anchors.get('a')!, { x: 1000, y: 1000 })
    expect(l).toMatchObject({ roomId: 'a', x: -1000, y: -500 })
    // Measuring room A 400 mm longer moves its centre 200 mm; the light keeps its offset from it.
    const longer = room('a', [
      [0, 0],
      [400, 0],
      [400, 300],
      [0, 300],
    ])
    longer.edges[0].measured = 4400
    longer.edges[2].measured = 4400
    const after = roomAnchors(solveProject(project([longer, b])))
    const c0 = lightCentre(anchors, light(l))!
    const c1 = lightCentre(after, light(l))!
    expect(c1.x - c0.x).toBeCloseTo(after.get('a')!.x - anchors.get('a')!.x)
    expect(lightCentre(new Map(), light(l))).toBeNull()
  })

  it('aims a new eyeball at the nearest wall and runs a strip along it', () => {
    // 500 mm from the top wall (y = 0), well away from the others.
    const p = { x: 2000, y: 500 }
    expect(nearestWall(A, p)?.dist).toBeCloseTo(500)
    expect(newLight('eyeball', A, anchors.get('a')!, p).angle).toBeCloseTo(270) // up the plan
    expect(newLight('strip', A, anchors.get('a')!, p).angle).toBeCloseTo(0)
  })

  it('runs a new pendant the long way of the room', () => {
    expect(newLight('pendant', A, anchors.get('a')!, { x: 2000, y: 1500 })).toMatchObject({ angle: 0, length: 1200 })
    const tall = solveProject(
      project([
        room('t', [
          [0, 0],
          [200, 0],
          [200, 500],
          [0, 500],
        ]),
      ]),
    ).byId.get('t')!
    expect(newLight('pendant', tall, { x: 1000, y: 2500 }, { x: 1000, y: 2500 }).angle).toBe(90)
  })

  it('sizes a new fan for the room', () => {
    expect(FAN_SIZES.find((s) => s.inches === 52)?.mm).toBe(1320)
    expect(fanSizeFor(6e6)).toBe(910) // 36″
    expect(fanSizeFor(12e6)).toBe(1070) // 42″
    expect(fanSizeFor(16.7e6)).toBe(1220) // 48″
    expect(fanSizeFor(30e6)).toBe(1320) // 52″
    // Room A is 12 m².
    expect(newLight('fan', A, anchors.get('a')!, { x: 2000, y: 1500 })).toMatchObject({
      kind: 'fan',
      length: 1070,
      angle: 270,
    })
  })

  it('starts a new light with the size, power, colour and model of the last of its kind', () => {
    const lights = [
      light({ id: '1', size: 75, watt: 7, temp: 3000 }),
      light({ id: '2', kind: 'eyeball', watt: 5 }),
      light({ id: '3', size: 150, watt: 12, temp: 'tri', model: 'Acme D150' }),
    ]
    expect(specsFrom(lights, 'downlight')).toEqual({ size: 150, watt: 12, temp: 'tri', model: 'Acme D150' })
    expect(specsFrom(lights, 'fan')).toEqual({ size: null, watt: null, temp: null, model: '' })
    expect(newLight('downlight', A, anchors.get('a')!, { x: 2000, y: 1500 })).toMatchObject({
      size: null,
      watt: null,
      temp: null,
      model: '',
    })
  })

  it('counts the tubes that light a run end to end', () => {
    expect(tubesFor({ length: 2960, size: 1200 })).toBe(3)
    expect(tubesFor({ length: 2400, size: 1200 })).toBe(2)
    expect(tubesFor({ length: 2440, size: 1200 })).toBe(2) // within 5% of a tube: the ends sit just short
    expect(tubesFor({ length: 2960, size: 600 })).toBe(5)
    expect(tubesFor({ length: 200, size: 1200 })).toBe(1)
    expect(newLight('strip', A, anchors.get('a')!, { x: 2000, y: 500 }).size).toBe(1200)
  })

  it('labels power and colour temperature', () => {
    expect(wattLabel(light({ watt: 12 }))).toBe('12W')
    expect(wattLabel(light({ kind: 'strip', watt: 16, length: 2960, size: 1200 }))).toBe('3×16W')
    expect(wattLabel(light({ watt: 16.25 }))).toBe('16.3W')
    expect(wattLabel(light({}))).toBeNull()
    expect(fanSizeLabel(light({ kind: 'fan', length: 1170 }))).toBe('46″')
    expect(fanSizeLabel(light({ kind: 'fan', length: 1320 }))).toBe('52″')
    expect(tempLabel(3000)).toBe('3000K')
    expect(tempLabel('tri')).toBe('3CCT')
    expect(tempLabel('rgb')).toBe('RGB')
    expect(isRound(light({ kind: 'surface' }))).toBe(true)
    expect(isRound(light({ kind: 'pendant', length: 0 }))).toBe(true)
    expect(isRound(light({ kind: 'pendant', length: 1200 }))).toBe(false)
  })

  it('lists alike lights together, with the rooms they go in', () => {
    const spec = { size: 150, watt: 12, temp: 3000, model: 'Acme D150' }
    const rows = fixtureList(
      [a, b],
      [
        light({ id: '1', roomId: 'b', ...spec }),
        light({ id: '2', ...spec, model: ' acme d150 ' }), // the same model, typed differently
        light({ id: '3', ...spec }),
        light({ id: '4', ...spec, watt: 9 }),
        light({ id: '5', kind: 'strip', length: 1500, watt: 10, model: 'Strip X' }),
        light({ id: '6', kind: 'strip', roomId: 'b', length: 800, watt: 10, model: 'Strip X' }),
        light({ id: '7', kind: 'fan', length: 1070, watt: 35 }),
        light({ id: '8', roomId: 'gone', ...spec }),
      ],
    )
    expect(rows.map((r) => [r.kind, r.watt, r.count])).toEqual([
      ['downlight', 9, 1],
      ['downlight', 12, 3],
      ['strip', 10, 2],
      ['fan', 35, 1],
    ])
    expect(rows[1].rooms.map((r) => [r.room.id, r.count])).toEqual([
      ['a', 2],
      ['b', 1],
    ])
    expect(rows[1].watts).toBe(36)
    // Two runs (1.5 m and 0.8 m) of 4ft tubes, the usual size when none is set: three tubes.
    expect(rows[2]).toMatchObject({ size: 1200, count: 2, length: 2300, tubes: 3, watts: 30, linear: true })
    expect(rows[3].size).toBe(1070)
  })

  it('finds both ends of a linear light', () => {
    const [p, q] = lightEnds({ x: 0, y: 0 }, { angle: 90, length: 1000 })
    expect(p.y).toBeCloseTo(-500)
    expect(q.y).toBeCloseTo(500)
    expect(q.x).toBeCloseTo(0)
  })

  it('snaps angles onto the walls and 45° steps, and otherwise to whole degrees', () => {
    expect(snapAngle(93, A)).toBe(90)
    expect(snapAngle(-2, A)).toBe(0)
    expect(snapAngle(48, null)).toBe(45)
    expect(snapAngle(62.4, A)).toBe(62)
  })

  it('measures from a point straight out to each wall', () => {
    const d = wallDistances(A, { x: 1000, y: 1000 })
      .map((x) => Math.round(x.dist))
      .sort((m, n) => m - n)
    // Inside faces at x = 0 and 4000 (outer walls traced on the inside), and y = 0 and 3000.
    expect(d).toEqual([1000, 1000, 2000, 3000])
  })

  it('pulls a dragged point into line with others within the tolerance', () => {
    const s = snapInLine(
      { x: 1004, y: 2000 },
      [
        { x: 1000, y: 500 },
        { x: 3000, y: 2050 },
      ],
      20,
    )
    expect(s.p).toEqual({ x: 1000, y: 2000 })
    expect(s.x).toBe(1000)
    expect(s.y).toBeNull()
  })

  it('counts lights room by room, with the LED tubes', () => {
    const lights = [
      light({ id: '1', watt: 12 }),
      light({ id: '2' }),
      light({ id: '3', kind: 'strip', length: 1500, watt: 10 }),
      light({ id: '4', kind: 'strip', length: 800 }),
      light({ id: '5', kind: 'pendant', roomId: 'b', length: 1200 }),
    ]
    const rows = lightSchedule(
      [
        a,
        b,
        room('c', [
          [0, 0],
          [1, 0],
          [1, 1],
        ]),
      ],
      lights,
    )
    expect(rows.map((r) => r.room.id)).toEqual(['a', 'b'])
    expect(rows[0].count).toEqual({ downlight: 2, surface: 0, eyeball: 0, pendant: 0, strip: 2, fan: 0 })
    // Runs of 1.5 m and 0.8 m take two 4ft tubes and one.
    expect(rows[0].tubes).toBe(3)
    // 12 W, plus two 10 W tubes; two have no power set.
    expect(rows[0].watts).toBe(32)
    expect(rows[0].unrated).toBe(2)
    expect(rows[1].count.pendant).toBe(1)
  })
})
