import { motion } from 'framer-motion'
import { STATE_LABEL, type ProcState, type TransitionKey } from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { useKernel } from '../../store/kernel'
import { useUi } from '../../store/ui'
import { pidColor, STATE_COLOR } from '../../lib/colors'
import { PidBadge } from '../../components/Chips'

// ── geometría del diagrama (coordenadas del viewBox) ──
const VIEW_W = 1060
const VIEW_H = 700
const NODE_W = 190
const NODE_H = 150
const TOKEN_R = 13
const TOKEN_CELL = 32
const TOKEN_COLS = 5

const NODES: Record<ProcState, { x: number; y: number }> = {
  NEW: { x: 110, y: 100 },
  READY: { x: 395, y: 100 },
  RUNNING: { x: 705, y: 100 },
  TERMINATED: { x: 955, y: 100 },
  READY_SUSPENDED: { x: 200, y: 395 },
  BLOCKED: { x: 560, y: 395 },
  BLOCKED_SUSPENDED: { x: 380, y: 610 }
}

interface EdgeDef {
  from: ProcState
  to: ProcState
  label: string
  /** Curvatura: 0 = recta; signo = lado hacia el que se curva. */
  bend: number
  /** Posición de la etiqueta a lo largo de la curva (0 = origen, 1 = destino). */
  labelT?: number
  /** Desplazamiento vertical de la etiqueta. */
  labelDy?: number
}

const EDGES: EdgeDef[] = [
  { from: 'NEW', to: 'READY', label: 'admitir', bend: 0, labelDy: -8 },
  { from: 'NEW', to: 'READY_SUSPENDED', label: 'admitir (sin memoria)', bend: 0.1, labelT: 0.45 },
  { from: 'READY', to: 'RUNNING', label: 'despachar', bend: -0.16, labelDy: -6 },
  {
    from: 'RUNNING',
    to: 'READY',
    label: 'fin de quantum / expropiación',
    bend: -0.16,
    labelDy: 14
  },
  { from: 'RUNNING', to: 'BLOCKED', label: 'esperar evento', bend: -0.12, labelT: 0.45 },
  { from: 'BLOCKED', to: 'READY', label: 'ocurre evento', bend: -0.12, labelT: 0.55 },
  { from: 'RUNNING', to: 'TERMINATED', label: 'salir', bend: 0, labelDy: -8 },
  { from: 'READY', to: 'READY_SUSPENDED', label: 'suspender', bend: -0.14 },
  { from: 'READY_SUSPENDED', to: 'READY', label: 'activar', bend: -0.14 },
  {
    from: 'RUNNING',
    to: 'READY_SUSPENDED',
    label: 'suspender',
    bend: 0.05,
    labelT: 0.8,
    labelDy: 16
  },
  { from: 'BLOCKED', to: 'BLOCKED_SUSPENDED', label: 'suspender', bend: -0.16 },
  { from: 'BLOCKED_SUSPENDED', to: 'BLOCKED', label: 'activar', bend: -0.16 },
  { from: 'BLOCKED_SUSPENDED', to: 'READY_SUSPENDED', label: 'ocurre evento', bend: 0.12 }
]

type Pt = { x: number; y: number }

/** Punto donde la recta del centro hacia `toward` sale del rectángulo del nodo. */
function exitPoint(c: Pt, toward: Pt, gap: number): Pt {
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  const len = Math.hypot(dx, dy) || 1
  const t = Math.min(NODE_W / 2 / Math.abs(dx || 1e-9), NODE_H / 2 / Math.abs(dy || 1e-9))
  return { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap }
}

function edgeGeometry(e: EdgeDef): { d: string; mid: Pt } {
  const a = NODES[e.from]
  const b = NODES[e.to]
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dist = Math.hypot(b.x - a.x, b.y - a.y)
  // Normal a la recta a→b para curvar las aristas de ida y vuelta.
  const nx = -(b.y - a.y) / dist
  const ny = (b.x - a.x) / dist
  const ctrl = { x: mx + nx * e.bend * dist, y: my + ny * e.bend * dist }
  const p0 = exitPoint(a, ctrl, 4)
  const p2 = exitPoint(b, ctrl, 9)
  // Punto de la curva de Bézier cuadrática en t.
  const t = e.labelT ?? 0.5
  const u = 1 - t
  const mid = {
    x: u * u * p0.x + 2 * u * t * ctrl.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * ctrl.y + t * t * p2.y + (e.labelDy ?? 0)
  }
  return { d: `M${p0.x},${p0.y} Q${ctrl.x},${ctrl.y} ${p2.x},${p2.y}`, mid }
}

const GEOMETRY = new Map(EDGES.map((e) => [`${e.from}>${e.to}` as TransitionKey, edgeGeometry(e)]))

function tokenPosition(state: ProcState, index: number): Pt {
  const n = NODES[state]
  const col = index % TOKEN_COLS
  const row = Math.floor(index / TOKEN_COLS)
  return {
    x: n.x - ((TOKEN_COLS - 1) * TOKEN_CELL) / 2 + col * TOKEN_CELL,
    y: n.y - NODE_H / 2 + 56 + row * TOKEN_CELL
  }
}

export function StateDiagram(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  if (!snapshot) return <div className="empty">Conectando con el kernel…</div>
  return (
    <div className="diagram">
      <DiagramSvg snapshot={snapshot} />
      <RecentTransitions snapshot={snapshot} />
    </div>
  )
}

function DiagramSvg({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const selectedPid = useUi((s) => s.selectedPid)
  const selectPid = useUi((s) => s.selectPid)

  // Aristas "calientes": transiciones ocurridas en los últimos ~0.7 s de tiempo real.
  const hotWindow = Math.max(1, Math.ceil(700 / snapshot.tickMs))
  const hot = new Set<string>()
  for (const e of snapshot.events) {
    if (e.kind === 'transition' && e.tick > snapshot.tick - hotWindow) hot.add(`${e.from}>${e.to}`)
  }

  const byState = new Map<ProcState, number[]>()
  for (const p of snapshot.processes) {
    byState.set(p.state, [...(byState.get(p.state) ?? []), p.pid])
  }
  const positions = new Map<number, Pt>()
  for (const [state, pids] of byState) {
    pids.forEach((pid, i) => positions.set(pid, tokenPosition(state, i)))
  }

  const counts = snapshot.transitionCounts
  const kills = (Object.keys(counts) as TransitionKey[])
    .filter((k) => k.endsWith('>TERMINATED') && k !== 'RUNNING>TERMINATED')
    .reduce((n, k) => n + (counts[k] ?? 0), 0)

  return (
    <svg
      className="diagram-svg"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,255,255,0.45)" />
        </marker>
        <marker
          id="arrow-hot"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#0a84ff" />
        </marker>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {EDGES.map((e) => {
        const key = `${e.from}>${e.to}` as TransitionKey
        const { d, mid } = GEOMETRY.get(key)!
        const isHot = hot.has(key)
        const n = counts[key] ?? 0
        return (
          <g key={key} className={`edge${isHot ? ' hot' : ''}`}>
            <path
              d={d}
              markerEnd={`url(#${isHot ? 'arrow-hot' : 'arrow'})`}
              filter={isHot ? 'url(#glow)' : undefined}
            />
            <text x={mid.x} y={mid.y} textAnchor="middle" className="edge-label">
              {e.label}
              <tspan className="edge-count"> ×{n}</tspan>
            </text>
          </g>
        )
      })}

      {(Object.keys(NODES) as ProcState[]).map((state) => {
        const n = NODES[state]
        const count = byState.get(state)?.length ?? 0
        return (
          <g key={state} className="state-node">
            <rect
              x={n.x - NODE_W / 2}
              y={n.y - NODE_H / 2}
              width={NODE_W}
              height={NODE_H}
              rx={18}
              style={{ stroke: STATE_COLOR[state] }}
            />
            <text
              x={n.x}
              y={n.y - NODE_H / 2 + 27}
              textAnchor="middle"
              className="state-title"
              style={{ fill: STATE_COLOR[state] }}
            >
              {STATE_LABEL[state]}
            </text>
            <text
              x={n.x + NODE_W / 2 - 14}
              y={n.y + NODE_H / 2 - 12}
              textAnchor="end"
              className="state-count"
            >
              {count}
            </text>
          </g>
        )
      })}

      {kills > 0 && (
        <text
          x={NODES.TERMINATED.x}
          y={NODES.TERMINATED.y + NODE_H / 2 + 22}
          textAnchor="middle"
          className="edge-label"
        >
          abortados desde otros estados ×{kills}
        </text>
      )}

      {snapshot.processes.map((p) => {
        const pos = positions.get(p.pid)!
        const selected = p.pid === selectedPid
        return (
          <motion.g
            key={p.pid}
            className={`token${p.state === 'RUNNING' ? ' running' : ''}${p.state === 'TERMINATED' ? ' dead' : ''}`}
            initial={false}
            animate={{ x: pos.x, y: pos.y }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={() => selectPid(selected ? null : p.pid)}
          >
            <title>{`PID ${p.pid} · ${p.name} · ${STATE_LABEL[p.state]}`}</title>
            {selected && <circle r={TOKEN_R + 4} className="token-ring" />}
            <circle r={TOKEN_R} fill={pidColor(p.pid)} />
            <text textAnchor="middle" dy="4.5">
              {p.pid}
            </text>
          </motion.g>
        )
      })}
    </svg>
  )
}

function RecentTransitions({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const selectPid = useUi((s) => s.selectPid)
  const selectedPid = useUi((s) => s.selectedPid)
  const transitions = snapshot.events
    .filter((e) => e.kind === 'transition' && (selectedPid === null || e.pid === selectedPid))
    .slice(-14)
    .reverse()
  const selected = snapshot.processes.find((p) => p.pid === selectedPid)
  return (
    <aside className="diagram-side">
      <div className="section-title side-title">
        {selected ? `Transiciones de ${selected.name}` : 'Transiciones recientes'}
        {selected && (
          <button className="link-btn" onClick={() => selectPid(null)}>
            Ver todos
          </button>
        )}
      </div>
      {selected && transitions.length === 0 && (
        <p className="muted small">
          Sin transiciones recientes: lleva en {STATE_LABEL[selected.state]}
          {selected.state === 'READY'
            ? ` ${selected.readyStreak} ticks seguidos sin recibir CPU`
            : ''}
          .
        </p>
      )}
      <ul className="transition-list">
        {transitions.map((e) => {
          const cause = e.message.slice(e.message.indexOf(': ') + 2)
          return (
            <li key={e.id}>
              <span className="muted">t={e.tick}</span>
              <PidBadge pid={e.pid!} onClick={() => selectPid(e.pid!)} />
              <span>
                <span style={{ color: STATE_COLOR[e.from!] }}>{STATE_LABEL[e.from!]}</span> →{' '}
                <span style={{ color: STATE_COLOR[e.to!] }}>{STATE_LABEL[e.to!]}</span>
                <span className="muted small cause">{cause}</span>
              </span>
            </li>
          )
        })}
      </ul>
      <p className="muted small note">
        Modelo de 7 estados. Las fichas son los procesos (PID); las aristas se iluminan al ocurrir
        la transición y ×n indica cuántas veces ha ocurrido. Haz clic en una ficha para seguir a un
        proceso.
      </p>
    </aside>
  )
}
