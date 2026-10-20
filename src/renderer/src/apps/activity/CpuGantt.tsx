import type { GanttSlot, ProcessInfo } from '@shared/kernelTypes'
import { pidColor } from '../../lib/colors'
import { useUi } from '../../store/ui'

/** Diagrama de Gantt de la CPU: un bloque por tick, coloreado según el proceso. */
export function CpuGantt({
  slots,
  processes
}: {
  slots: GanttSlot[]
  processes: ProcessInfo[]
}): React.JSX.Element {
  const selected = useUi((s) => s.selectedPid)
  const names = new Map(processes.map((p) => [p.pid, p.name]))
  const first = slots[0]?.tick ?? 0
  return (
    <div className="cpu-gantt">
      <div className="gantt-bars">
        {slots.map((s) => (
          <div
            key={s.tick}
            className={`gantt-slot ${s.kind}${selected !== null && s.pid !== selected ? ' dim' : ''}`}
            style={s.pid === null ? undefined : { background: pidColor(s.pid) }}
            title={
              s.kind === 'idle'
                ? `t=${s.tick} · CPU ociosa`
                : s.kind === 'os'
                  ? `t=${s.tick} · kernel compactando la memoria`
                  : `t=${s.tick} · PID ${s.pid} ${names.get(s.pid!) ?? ''}${s.kind === 'cs' ? ' (cambio de contexto)' : ''}`
            }
          />
        ))}
      </div>
      <div className="gantt-axis">
        <span>t={first}</span>
        <span>t={slots.at(-1)?.tick ?? 0}</span>
      </div>
    </div>
  )
}
