import { PRIORITY_MAX, PRIORITY_MIN, type ProcessInfo } from '@shared/kernelTypes'
import { useKernel } from '../../store/kernel'
import { useUi } from '../../store/ui'
import { PidBadge, StateChip } from '../../components/Chips'
import { STARVATION_TICKS, addr, waitingText } from '../../lib/format'
import { ProgramListing } from '../../components/ProgramListing'

function Stepper({
  value,
  onChange,
  min,
  max
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
}): React.JSX.Element {
  return (
    <span className="stepper">
      <button disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <b>{value}</b>
      <button disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}

/** Bloque de control del proceso seleccionado, con su programa y acciones. */
export function Inspector({ p, now }: { p: ProcessInfo; now: number }): React.JSX.Element {
  const send = useKernel((s) => s.send)
  const selectPid = useUi((s) => s.selectPid)
  const alive = p.state !== 'TERMINATED'
  const suspended = p.state === 'READY_SUSPENDED' || p.state === 'BLOCKED_SUSPENDED'
  const rows: [string, React.ReactNode][] = [
    ['Estado', <StateChip key="s" state={p.state} />],
    [
      'Prioridad',
      <Stepper
        key="p"
        value={p.priority}
        min={PRIORITY_MAX}
        max={PRIORITY_MIN}
        onChange={(v) => send({ type: 'setPriority', pid: p.pid, priority: v })}
      />
    ],
    [
      'Quantum',
      <Stepper
        key="q"
        value={p.quantum}
        min={1}
        max={50}
        onChange={(v) => send({ type: 'setQuantum', pid: p.pid, quantum: v })}
      />
    ],
    ['Quantum usado', p.state === 'RUNNING' ? `${p.quantumUsed} de ${p.quantum}` : '—'],
    ['Contador de programa', p.pc],
    ['Ráfaga restante', p.burstRemaining ?? '—'],
    ['Bloqueado por', waitingText(p)],
    ['Llegada', `t=${p.arrival}`],
    [
      'Primera CPU',
      p.firstRun === null ? '—' : `t=${p.firstRun} (respuesta ${p.firstRun - p.arrival})`
    ],
    [
      'Fin',
      p.finishedAt === null ? '—' : `t=${p.finishedAt} (retorno ${p.finishedAt - p.arrival})`
    ],
    [
      'Tiempo de CPU',
      `${p.cpuTime} ticks (${((p.cpuTime / Math.max(1, now)) * 100).toFixed(1)} %)`
    ],
    ['Tiempo en Listo', `${p.waitTime} ticks`],
    ['Tiempo bloqueado', `${p.blockedTime} ticks`],
    [
      'Racha en Listo',
      <span key="r" className={p.readyStreak >= STARVATION_TICKS ? 'starving' : undefined}>
        {p.readyStreak} (máx. {p.maxReadyStreak})
      </span>
    ],
    ['Operaciones de E/S', p.ioCount],
    ['Cambios de contexto', p.contextSwitches],
    ['Memoria solicitada', `${p.memoryKb} KB`],
    [
      'Registro base',
      p.memBase === null
        ? p.state === 'TERMINATED'
          ? '—'
          : 'en swap'
        : `${p.memBase} KB · ${addr(p.memBase)}`
    ],
    [
      'Registro límite',
      p.memBase === null ? '—' : `${p.memSize} KB (hasta ${addr(p.memBase + p.memSize)})`
    ]
  ]
  if (p.regVar !== null || p.reg !== null) {
    rows.push(['Registro', `${p.reg ?? '—'}${p.regVar ? ` (cargado de ${p.regVar})` : ''}`])
  }
  if (p.holds.length > 0) rows.push(['Mutex que posee', p.holds.join(', ')])
  const vec = (v: Record<string, number>): string =>
    Object.entries(v)
      .map(([r, n]) => (n === 1 ? r : `${n}× ${r}`))
      .join(', ') || '—'
  if (Object.keys(p.maxClaim).length > 0 || Object.keys(p.resources).length > 0) {
    rows.push(['Recursos asignados', vec(p.resources)])
    rows.push(['Necesidad máxima', vec(p.maxClaim)])
  }
  if (p.rollbacks > 0) rows.push(['Retrocesos (rollback)', p.rollbacks])
  if (p.overlay) {
    rows.push([
      'Área de overlay',
      p.overlay.pending
        ? `cargando «${p.overlay.pending}»`
        : p.overlay.loaded
          ? `«${p.overlay.loaded}»`
          : 'vacía'
    ])
  }
  if (p.exitReason) rows.push(['Motivo de salida', p.exitReason])

  return (
    <aside className="inspector">
      <header>
        <PidBadge pid={p.pid} />
        <div>
          <div className="inspector-name">{p.name}</div>
          <div className="muted small">
            PID {p.pid} · programa «{p.programId}»
          </div>
        </div>
        <button className="icon-btn" aria-label="Cerrar inspector" onClick={() => selectPid(null)}>
          ×
        </button>
      </header>
      <div className="inspector-scroll">
        <dl className="pcb-grid">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <div className="section-title">Programa</div>
        <ProgramListing p={p} />
      </div>
      <footer>
        {alive ? (
          <>
            <button onClick={() => send({ type: suspended ? 'activate' : 'suspend', pid: p.pid })}>
              {suspended ? 'Reactivar' : 'Suspender'}
            </button>
            <button className="danger" onClick={() => send({ type: 'kill', pid: p.pid })}>
              Forzar salida
            </button>
          </>
        ) : (
          <button onClick={() => send({ type: 'spawn', programId: p.programId })}>Relanzar</button>
        )}
      </footer>
    </aside>
  )
}
