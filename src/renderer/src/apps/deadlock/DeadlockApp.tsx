import {
  DEADLOCK_POLICY_LABEL,
  type DeadlockPolicy,
  type ProcessInfo,
  type RecoveryMethod,
  type ResourcesInfo
} from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { useKernel } from '../../store/kernel'
import { WindowToolbar } from '../../wm/WindowContext'
import { Segmented } from '../../components/Segmented'
import { PidBadge, StateChip } from '../../components/Chips'
import { RagGraph } from './RagGraph'

export function DeadlockApp(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const send = useKernel((s) => s.send)
  if (!snapshot) return <div className="empty">Conectando con el kernel…</div>
  const info = snapshot.resources

  return (
    <div className="deadlock-app">
      <WindowToolbar>
        <div className="toolbar-controls" data-nodrag>
          <label className="inline-field">
            <span>Estrategia</span>
            <select
              value={info.policy}
              onChange={(e) =>
                send({ type: 'setDeadlockPolicy', policy: e.target.value as DeadlockPolicy })
              }
            >
              {Object.entries(DEADLOCK_POLICY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {info.policy === 'DETECT' && (
            <>
              <Segmented<RecoveryMethod>
                value={info.recovery}
                onChange={(method) => send({ type: 'setRecoveryMethod', method })}
                options={[
                  { value: 'rollback', label: 'Retroceso' },
                  { value: 'kill', label: 'Abortar' }
                ]}
              />
              <label className="switch">
                <input
                  type="checkbox"
                  checked={info.autoRecover}
                  onChange={(e) => send({ type: 'setAutoRecover', enabled: e.target.checked })}
                />
                <span className="switch-track" />
                <span>Automática</span>
              </label>
            </>
          )}
        </div>
        <span className="toolbar-spacer" />
        {info.policy === 'IGNORE' && (
          <button data-nodrag onClick={() => send({ type: 'detectDeadlock' })}>
            Detectar ahora
          </button>
        )}
      </WindowToolbar>
      <div className="deadlock-scroll">
        <DeadlockBanner snapshot={snapshot} />
        <div className="rag-card">
          <div className="section-title">Grafo de asignación de recursos</div>
          <RagGraph info={info} processes={snapshot.processes} />
          <div className="rag-legend small muted">
            <span>
              <i className="lg assign" /> asignación (recurso → proceso)
            </span>
            <span>
              <i className="lg request" /> solicitud pendiente (proceso → recurso)
            </span>
            <span>
              <i className="lg unsafe" /> retenida por el banquero
            </span>
            <span>
              <i className="lg cycle" /> ciclo de interbloqueo
            </span>
          </div>
        </div>
        <div className="deadlock-columns">
          <Matrices info={info} processes={snapshot.processes} />
          <div className="deadlock-side">
            <Coffman info={info} />
            <Stats info={info} />
          </div>
        </div>
      </div>
    </div>
  )
}

function DeadlockBanner({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element | null {
  const send = useKernel((s) => s.send)
  const info = snapshot.resources
  const dl = info.deadlock
  if (!dl) {
    return (
      <div className="dl-banner ok">
        {info.policy === 'IGNORE'
          ? 'Estrategia del avestruz: el kernel no busca interbloqueos. Si los procesos se quedan bloqueados para siempre, usa «Detectar ahora».'
          : 'No hay interbloqueo. El algoritmo de detección se ejecuta en cada tick.'}
      </div>
    )
  }
  const names = new Map(snapshot.processes.map((p) => [p.pid, p.name]))
  const label = (n: string): string =>
    n.startsWith('P')
      ? `PID ${n.slice(1)} ${names.get(Number(n.slice(1))) ?? ''}`
      : n.startsWith('mutex:')
        ? `mutex ${n.slice(6)}`
        : (info.resources.find((r) => r.id === n)?.name ?? n)
  return (
    <div className="dl-banner bad">
      <div>
        <b>Interbloqueo</b> desde t={dl.since} ({snapshot.tick - dl.since} ticks):{' '}
        {dl.cycle.length > 0
          ? [...dl.cycle, dl.cycle[0]].map(label).join(' → ')
          : dl.pids.join(', ')}
        .
        <div className="small">
          Cada proceso retiene un recurso que el siguiente necesita y espera uno que retiene otro:
          ninguno puede avanzar.
          {info.policy === 'DETECT' && info.autoRecover && ' El kernel lo romperá automáticamente.'}
        </div>
      </div>
      <button onClick={() => send({ type: 'recoverDeadlock' })}>
        {info.recovery === 'kill' ? 'Abortar víctima' : 'Recuperar (retroceso)'}
      </button>
    </div>
  )
}

function Matrices({
  info,
  processes
}: {
  info: ResourcesInfo
  processes: ProcessInfo[]
}): React.JSX.Element {
  const res = info.resources.filter((r) => r.kind === 'resource')
  const involved = processes.filter(
    (p) =>
      p.state !== 'TERMINATED' &&
      (Object.keys(p.maxClaim).length > 0 || Object.keys(p.resources).length > 0)
  )
  const req = new Map<number, Record<string, number>>()
  for (const r of info.requests) {
    req.set(r.pid, { ...(req.get(r.pid) ?? {}), [r.resource]: r.count })
  }
  const cell = (v: number | undefined): string => (v ? String(v) : '·')
  const safe = info.safety
  return (
    <div className="matrices">
      <div className="section-title">Estado de asignación (algoritmo del banquero)</div>
      <table className="proc-table matrix">
        <thead>
          <tr>
            <th rowSpan={2}>Proceso</th>
            <th colSpan={res.length}>Asignado</th>
            <th colSpan={res.length}>Máximo</th>
            <th colSpan={res.length}>Necesidad</th>
            <th colSpan={res.length}>Solicita</th>
          </tr>
          <tr>
            {[0, 1, 2, 3].flatMap((g) =>
              res.map((r) => (
                <th
                  key={`${g}-${r.id}`}
                  className={`num${r === res[0] ? ' group-start' : ''}`}
                  title={r.name}
                >
                  {r.name.slice(0, 3)}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {involved.map((p) => (
            <tr key={p.pid} className={info.deadlock?.pids.includes(p.pid) ? 'dl-row' : undefined}>
              <td>
                <PidBadge pid={p.pid} /> {p.name} <StateChip state={p.state} />
              </td>
              {res.map((r) => (
                <td key={`a${r.id}`} className={`num${r === res[0] ? ' group-start' : ''}`}>
                  {cell(p.resources[r.id])}
                </td>
              ))}
              {res.map((r) => (
                <td key={`m${r.id}`} className={`num${r === res[0] ? ' group-start' : ''}`}>
                  {cell(p.maxClaim[r.id])}
                </td>
              ))}
              {res.map((r) => (
                <td key={`n${r.id}`} className={`num${r === res[0] ? ' group-start' : ''}`}>
                  {cell((p.maxClaim[r.id] ?? 0) - (p.resources[r.id] ?? 0))}
                </td>
              ))}
              {res.map((r) => (
                <td key={`s${r.id}`} className={`num req${r === res[0] ? ' group-start' : ''}`}>
                  {cell(req.get(p.pid)?.[r.id])}
                </td>
              ))}
            </tr>
          ))}
          <tr className="avail-row">
            <td>
              <b>Disponible</b>
            </td>
            {res.map((r) => (
              <td key={r.id} className={`num${r === res[0] ? ' group-start' : ''}`}>
                <b>{r.available}</b>
              </td>
            ))}
            <td colSpan={res.length * 3} />
          </tr>
        </tbody>
      </table>
      <div className={`safety ${safe.safe ? 'safe' : 'unsafe'}`}>
        {safe.safe ? '✓ Estado seguro' : '✗ Estado inseguro'}
        <span className="muted small">
          {safe.safe
            ? ` · secuencia segura: ${safe.sequence.map((p) => `P${p}`).join(' → ') || '—'}`
            : ' · no existe un orden en que todos puedan obtener su máximo y terminar'}
        </span>
      </div>
    </div>
  )
}

function Coffman({ info }: { info: ResourcesInfo }): React.JSX.Element {
  const p = info.policy
  const conditions: [string, string, boolean | 'note'][] = [
    ['Exclusión mutua', 'Cada recurso lo usa un solo proceso a la vez.', true],
    [
      'Retención y espera',
      p === 'PREVENT'
        ? 'Rota: quien no obtiene un recurso suelta todo lo que tenía y lo pide todo junto.'
        : 'Un proceso retiene recursos mientras espera otros.',
      p !== 'PREVENT'
    ],
    [
      'Sin expropiación',
      p === 'DETECT' && info.recovery === 'rollback'
        ? 'Se cumple, pero al recuperar el kernel expropia los recursos de la víctima.'
        : 'Nadie le quita un recurso a quien lo tiene.',
      true
    ],
    [
      'Espera circular',
      info.deadlock
        ? 'Presente: hay un ciclo en el grafo.'
        : p === 'AVOID'
          ? 'El banquero solo concede si queda un estado seguro, así nunca se cierra el ciclo.'
          : 'Ocurre si los procesos piden recursos en distinto orden.',
      info.deadlock ? true : 'note'
    ]
  ]
  return (
    <div className="side-card">
      <div className="section-title">Condiciones de Coffman</div>
      <ul className="coffman">
        {conditions.map(([name, text, holds]) => (
          <li key={name} className={holds === true ? 'holds' : holds === false ? 'broken' : ''}>
            <b>{name}</b>
            <span className="small muted">{text}</span>
          </li>
        ))}
      </ul>
      <p className="small muted note">
        Las cuatro deben cumplirse a la vez para que exista un interbloqueo.
      </p>
    </div>
  )
}

function Stats({ info }: { info: ResourcesInfo }): React.JSX.Element {
  const s = info.stats
  return (
    <div className="side-card">
      <div className="section-title">Estadísticas</div>
      <div className="dl-stats">
        <div>
          <span>Interbloqueos detectados</span>
          <b className={s.deadlocks ? 'bad' : ''}>{s.deadlocks}</b>
        </div>
        <div>
          <span>Recuperaciones</span>
          <b>{s.recoveries}</b>
        </div>
        <div>
          <span>Solicitudes retenidas (banquero)</span>
          <b>{s.unsafeDenials}</b>
        </div>
        <div>
          <span>Liberaciones preventivas</span>
          <b>{s.preventiveReleases}</b>
        </div>
      </div>
    </div>
  )
}
