import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import type { Solved, SolvedRoom } from '../geometry/solve'
import { roomWallPieces, type WallPiece } from '../geometry/walls'
import { centroid } from '../geometry/polygon'
import { useStore } from '../store'
import { roomTypeInfo, type Vec2 } from '../types'
import { formatArea } from '../units'
import { useSolved } from './common'

const M = 1 / 1000 // scene units are metres

/** Plan (x, y-down) maps to scene (x, z) so the 3D view isn't mirrored. */
function prismsGeometry(pieces: WallPiece[]): THREE.BufferGeometry {
  const pos: number[] = []
  const push = (p: Vec2, y: number) => pos.push(p.x * M, y * M, p.y * M)
  for (const { footprint: f, y0, y1 } of pieces) {
    for (let i = 1; i < f.length - 1; i++) {
      push(f[0], y0), push(f[i + 1], y0), push(f[i], y0)
      push(f[0], y1), push(f[i], y1), push(f[i + 1], y1)
    }
    for (let i = 0; i < f.length; i++) {
      const a = f[i]
      const b = f[(i + 1) % f.length]
      push(a, y0), push(b, y0), push(b, y1)
      push(a, y0), push(b, y1), push(a, y1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

function floorGeometry(outline: Vec2[]): THREE.BufferGeometry {
  const contour = outline.map((p) => new THREE.Vector2(p.x, p.y))
  const tris = THREE.ShapeUtils.triangulateShape(contour, [])
  const pos: number[] = []
  for (const t of tris) for (const i of t) pos.push(outline[i].x * M, 0, outline[i].y * M)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

function RoomMesh({ solved, r, cutaway }: { solved: Solved; r: SolvedRoom; cutaway: boolean }) {
  const { walls, edges } = useMemo(() => {
    const walls = prismsGeometry(roomWallPieces(solved, r, cutaway ? 1200 : Infinity))
    return { walls, edges: new THREE.EdgesGeometry(walls, 25) }
  }, [solved, r, cutaway])
  const floor = useMemo(() => floorGeometry(r.outline), [r.outline])
  useEffect(
    () => () => {
      walls.dispose()
      edges.dispose()
    },
    [walls, edges],
  )
  useEffect(() => () => floor.dispose(), [floor])
  return (
    <group>
      <mesh geometry={floor} receiveShadow>
        <meshStandardMaterial color={roomTypeInfo(r.room.type).color} side={THREE.DoubleSide} roughness={0.9} />
      </mesh>
      <mesh geometry={walls} castShadow receiveShadow>
        <meshStandardMaterial color="#f1eee8" side={THREE.DoubleSide} roughness={0.85} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#8d877c" />
      </lineSegments>
    </group>
  )
}

/** Keeps DOM labels pinned over 3D points; cheaper and sturdier than a React root per label. */
function LabelProjector({ anchors, layer }: { anchors: THREE.Vector3[]; layer: RefObject<HTMLDivElement | null> }) {
  const v = useMemo(() => new THREE.Vector3(), [])
  useFrame(({ camera, size }) => {
    const els = layer.current?.children
    if (!els) return
    anchors.forEach((a, i) => {
      const el = els[i] as HTMLElement | undefined
      if (!el) return
      v.copy(a).project(camera)
      const visible = v.z < 1
      el.style.display = visible ? '' : 'none'
      if (visible) el.style.transform = `translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px) translate(-50%, -50%)`
    })
  })
  return null
}

function PlanUnderlay({ image, mmPerPx }: { image: { src: string; width: number; height: number }; mmPerPx: number }) {
  const texture = useMemo(() => {
    const t = new THREE.TextureLoader().load(image.src)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [image.src])
  useEffect(() => () => texture.dispose(), [texture])
  const w = image.width * mmPerPx * M
  const h = image.height * mmPerPx * M
  return (
    <mesh position={[w / 2, -0.01, h / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} transparent opacity={0.5} />
    </mesh>
  )
}

function CameraRig({ center, size, resetKey }: { center: THREE.Vector3; size: number; resetKey: number }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null
  useEffect(() => {
    camera.position.set(center.x + size * 0.15, size * 1.1, center.z + size * 0.9)
    camera.near = 0.05
    camera.far = size * 20
    camera.updateProjectionMatrix()
    if (controls) {
      controls.target.copy(center)
      controls.update()
    }
    // Only reframe on demand or when the model's footprint changes noticeably.
  }, [resetKey, controls, Math.round(size), Math.round(center.x), Math.round(center.z)])
  return null
}

export function Viewer3D() {
  const project = useStore((s) => s.project)
  const solved = useSolved()
  const [cutaway, setCutaway] = useState(false)
  const [labels, setLabels] = useState(true)
  const [underlay, setUnderlay] = useState(true)
  const [resetKey, setResetKey] = useState(0)
  const labelLayer = useRef<HTMLDivElement>(null)
  const anchors = useMemo(
    () =>
      solved.rooms.map((r) => {
        const c = centroid(r.outline)
        return new THREE.Vector3(c.x * M, 0.05, c.y * M)
      }),
    [solved],
  )

  const { center, size } = useMemo(() => {
    const pts = solved.rooms.flatMap((r) => r.outline)
    if (!pts.length) return { center: new THREE.Vector3(), size: 10 }
    const xs = pts.map((p) => p.x * M)
    const zs = pts.map((p) => p.y * M)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)
    return {
      center: new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2),
      size: Math.max(maxX - minX, maxZ - minZ, 3),
    }
  }, [solved])

  if (!solved.rooms.length || !solved.mmPerPx) {
    return (
      <div className="empty">
        <h2>Nothing to show yet</h2>
        <p>Set the plan’s scale and trace at least one room on the Plan tab.</p>
      </div>
    )
  }

  return (
    <div className="viewer3d">
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 45 }}>
        <color attach="background" args={['#eef1f4']} />
        <hemisphereLight args={['#ffffff', '#c9c2b5', 1.4]} />
        <directionalLight
          position={[center.x + size, size * 1.5, center.z + size * 0.6]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
          shadow-camera-left={-size}
          shadow-camera-right={size}
          shadow-camera-top={size}
          shadow-camera-bottom={-size}
        />
        {underlay && project.image && <PlanUnderlay image={project.image} mmPerPx={solved.mmPerPx} />}
        {solved.rooms.map((r) => (
          <RoomMesh key={r.room.id} solved={solved} r={r} cutaway={cutaway} />
        ))}
        {labels && <LabelProjector anchors={anchors} layer={labelLayer} />}
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} />
        <CameraRig center={center} size={size} resetKey={resetKey} />
      </Canvas>
      {labels && (
        <div className="label-layer" ref={labelLayer}>
          {solved.rooms.map((r) => (
            <div key={r.room.id} className="label3d">
              <strong>{r.room.name}</strong>
              <span>{formatArea(r.area)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="viewer-toolbar">
        <label className="check small">
          <input type="checkbox" checked={cutaway} onChange={(e) => setCutaway(e.target.checked)} /> Cut walls at 1.2 m
        </label>
        <label className="check small">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
        </label>
        <label className="check small">
          <input type="checkbox" checked={underlay} onChange={(e) => setUnderlay(e.target.checked)} /> Plan underlay
        </label>
        <button className="btn small" onClick={() => setResetKey((k) => k + 1)}>
          Reset view
        </button>
      </div>
    </div>
  )
}
