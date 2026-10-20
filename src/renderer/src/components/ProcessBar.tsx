import type { ProcessInfo } from '@shared/kernelTypes'
import { useKernel } from '../store/kernel'
import { PidBadge, StateChip } from './Chips'
import { waitingText } from '../lib/format'

/** Barra que muestra el proceso detrás de una app y permite relanzarlo. */
export function ProcessBar({ p, programId }: { p: ProcessInfo | undefined; programId: string }) {
  const send = useKernel((s) => s.send)
  if (!p || p.state === 'TERMINATED') {
    return (
      <div className="process-bar dead">
        <span>El proceso «{programId}» no está en ejecución.</span>
        <button onClick={() => send({ type: 'spawn', programId })}>Lanzar proceso</button>
      </div>
    )
  }
  return (
    <div className="process-bar">
      <PidBadge pid={p.pid} />
      <b>{p.name}</b>
      <StateChip state={p.state} />
      <span className="muted small">{waitingText(p)}</span>
      <span className="toolbar-spacer" />
      <span className="muted small">
        prioridad {p.priority} · CPU {p.cpuTime} ticks
      </span>
    </div>
  )
}
