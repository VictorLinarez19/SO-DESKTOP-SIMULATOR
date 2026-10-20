import { motion } from 'framer-motion'
import type { ProcessInfo, ResourcesInfo } from '@shared/kernelTypes'
import { pidColor } from '../../lib/colors'
import { useUi } from '../../store/ui'

const W = 900
const H = 430
const RES_W = 118
const RES_H = 58
const PROC_R = 24
const MIN_GAP = 74

type Pt = { x: number; y: number }

/**
 * Grafo de asignación de recursos (Holt): los recursos son rectángulos con un punto por
 * instancia; los procesos, círculos. Recurso → proceso = asignación; proceso → recurso =
 * solicitud pendiente. El ciclo de un interbloqueo se dibuja en rojo.
 */
export function RagGraph({
  info,
  processes
}: {
  info: ResourcesInfo
  processes: ProcessInfo[]
}): React.JSX.Element {
  const selectedPid = useUi((s) => s.selectedPid)
  const selectPid = useUi((s) => s.selectPid)
  const names = new Map(processes.map((p) => [p.pid, p.name]))

  // Recursos: todos los del sistema y los mutex que están en uso.
  const active = new Set([...info.allocation, ...info.requests].map((e) => e.resource))
  const resources = info.resources.filter((r) => r.kind === 'resource' || active.has(r.id))
  const resPos = new Map<string, Pt>()
  resources.forEach((r, i) => {
    resPos.set(r.id, { x: ((i + 0.5) * W) / resources.length, y: H / 2 })
  })

  // Procesos: cerca de los recursos con que se relacionan, alternando arriba y abajo.
  const pids = [...new Set([...info.allocation, ...info.requests].map((e) => e.pid))]
  const anchor = (pid: number): number => {
    const xs = [...info.allocation, ...info.requests]
      .filter((e) => e.pid === pid)
      .map((e) => resPos.get(e.resource)?.x ?? W / 2)
    return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
  }
  const sorted = pids.sort((a, b) => anchor(a) - anchor(b) || a - b)
  const rows: [number[], number[]] = [[], []]
  sorted.forEach((pid, i) => rows[i % 2].push(pid))
  const procPos = new Map<number, Pt>()
  rows.forEach((row, r) => {
    let lastX = -Infinity
    for (const pid of row) {
      const x = Math.min(W - 40, Math.max(40, anchor(pid), lastX + MIN_GAP))
      procPos.set(pid, { x, y: r === 0 ? 62 : H - 62 })
      lastX = x
    }
  })

  // Aristas del ciclo (pares consecutivos, cerrando la vuelta).
  const cyc = info.deadlock?.cycle ?? []
  const cycleEdges = new Set(cyc.map((n, i) => `${n}|${cyc[(i + 1) % cyc.length]}`))
  const deadPids = new Set(info.deadlock?.pids ?? [])

  const edge = (from: Pt, to: Pt, fromProc: boolean): string => {
    // Recorta en el borde de cada nodo para que se vea la flecha.
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.hypot(dx, dy) || 1
    const clipProc = PROC_R + 3
    const clipRes =
      Math.min(RES_W / 2 / Math.abs(dx / len || 1e-9), RES_H / 2 / Math.abs(dy / len || 1e-9)) + 4
    const a = fromProc ? clipProc : clipRes
    const b = fromProc ? clipRes : clipProc
    return `M${from.x + (dx / len) * a},${from.y + (dy / len) * a} L${to.x - (dx / len) * b},${to.y - (dy / len) * b}`
  }

  return (
    <svg className="rag" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        {[
          ['rag-arrow', 'rgba(255,255,255,0.6)'],
          ['rag-arrow-req', '#64d2ff'],
          ['rag-arrow-unsafe', '#ff9f0a'],
          ['rag-arrow-cycle', '#ff453a']
        ].map(([id, color]) => (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill={color} />
          </marker>
        ))}
      </defs>

      {info.allocation.map((e) => {
        const r = resPos.get(e.resource)
        const p = procPos.get(e.pid)
        if (!r || !p) return null
        const inCycle = cycleEdges.has(`${e.resource}|P${e.pid}`)
        return (
          <path
            key={`a-${e.resource}-${e.pid}`}
            className={`rag-edge assign${inCycle ? ' cycle' : ''}`}
            d={edge(r, p, false)}
            markerEnd={`url(#${inCycle ? 'rag-arrow-cycle' : 'rag-arrow'})`}
          />
        )
      })}
      {info.requests.map((e) => {
        const r = resPos.get(e.resource)
        const p = procPos.get(e.pid)
        if (!r || !p) return null
        const inCycle = cycleEdges.has(`P${e.pid}|${e.resource}`)
        const cls = inCycle ? 'cycle' : e.unsafe ? 'unsafe' : ''
        return (
          <path
            key={`r-${e.resource}-${e.pid}`}
            className={`rag-edge request ${cls}`}
            d={edge(p, r, true)}
            markerEnd={`url(#${inCycle ? 'rag-arrow-cycle' : e.unsafe ? 'rag-arrow-unsafe' : 'rag-arrow-req'})`}
          />
        )
      })}

      {resources.map((r) => {
        const pos = resPos.get(r.id)!
        const used = r.total - r.available
        return (
          <g
            key={r.id}
            className={`rag-res${r.kind === 'mutex' ? ' mutex' : ''}`}
            transform={`translate(${pos.x} ${pos.y})`}
          >
            <rect x={-RES_W / 2} y={-RES_H / 2} width={RES_W} height={RES_H} rx={10} />
            <text y={-6} textAnchor="middle" className="rag-res-name">
              {r.kind === 'mutex' ? `🔒 ${r.name}` : r.name}
            </text>
            {Array.from({ length: r.total }, (_, i) => (
              <circle
                key={i}
                cx={(i - (r.total - 1) / 2) * 16}
                cy={13}
                r={5}
                className={i < used ? 'inst used' : 'inst'}
              />
            ))}
          </g>
        )
      })}

      {pids.map((pid) => {
        const pos = procPos.get(pid)!
        const top = pos.y < H / 2
        return (
          <motion.g
            key={pid}
            className={`rag-proc${deadPids.has(pid) ? ' dead' : ''}${pid === selectedPid ? ' selected' : ''}`}
            initial={false}
            animate={{ x: pos.x, y: pos.y }}
            transition={{ type: 'spring', stiffness: 220, damping: 26 }}
            onClick={() => selectPid(pid === selectedPid ? null : pid)}
          >
            <circle r={PROC_R} fill={pidColor(pid)} />
            <text textAnchor="middle" dy="5" className="rag-pid">
              {pid}
            </text>
            <text textAnchor="middle" dy={top ? -PROC_R - 8 : PROC_R + 16} className="rag-name">
              {names.get(pid)}
            </text>
          </motion.g>
        )
      })}
      {pids.length === 0 && (
        <text x={W / 2} y={H / 2 + 60} textAnchor="middle" className="rag-name">
          Ningún proceso tiene o pide recursos en este momento
        </text>
      )}
    </svg>
  )
}
