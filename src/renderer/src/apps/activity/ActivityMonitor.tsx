import { useState } from 'react'
import {
  POLICY_LABEL,
  STATE_LABEL,
  type ProcessInfo,
  type ProcState,
  type SchedulerPolicy
} from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { useKernel } from '../../store/kernel'
import { useUi } from '../../store/ui'
import { WindowToolbar } from '../../wm/WindowContext'
import { Segmented } from '../../components/Segmented'
import { PidDot, StateChip } from '../../components/Chips'
import { STARVATION_TICKS, memText, pct, waitingText } from '../../lib/format'
import { STATE_COLOR } from '../../lib/colors'
import { CpuGantt } from './CpuGantt'
import { Inspector } from './Inspector'
import { DevicesTab } from './DevicesTab'

type Tab = 'cpu' | 'io'
type SortKey =
  | 'pid'
  | 'name'
  | 'state'
  | 'priority'
  | 'quantum'
  | 'share'
  | 'cpuTime'
  | 'waitTime'
  | 'readyStreak'
  | 'memSize'

const STATE_ORDER: ProcState[] = [
  'RUNNING',
  'READY',
  'BLOCKED',
  'NEW',
  'READY_SUSPENDED',
  'BLOCKED_SUSPENDED',
  'TERMINATED'
]

const COLUMNS: {
  key: SortKey
  label: string
  num?: boolean
  title?: string
  optional?: boolean
}[] = [
  { key: 'name', label: 'Proceso' },
  { key: 'pid', label: 'PID', num: true },
  { key: 'state', label: 'Estado' },
  { key: 'priority', label: 'Prioridad', num: true, title: '0 = máxima · 9 = mínima' },
  { key: 'quantum', label: 'Quantum', num: true },
  { key: 'share', label: '% CPU', num: true, title: 'Porcentaje de los últimos ticks del Gantt' },
  { key: 'cpuTime', label: 'Tiempo CPU', num: true, optional: true },
  { key: 'waitTime', label: 'Espera', num: true, title: 'Ticks totales en Listo', optional: true },
  {
    key: 'readyStreak',
    label: 'Racha en Listo',
    num: true,
    title: 'Ticks seguidos en Listo sin CPU'
  },
  {
    key: 'memSize',
    label: 'Memoria',
    num: true,
    title: 'Partición asignada (swap = imagen en el área de intercambio)'
  }
]

export function ActivityMonitor(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const [tab, setTab] = useState<Tab>('cpu')

  return (
    <div className="activity">
      <WindowToolbar>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'cpu', label: 'CPU' },
            { value: 'io', label: 'E/S' }
          ]}
        />
        <span className="toolbar-spacer" />
        {snapshot && <PolicyControls snapshot={snapshot} />}
      </WindowToolbar>
      {!snapshot ? (
        <div className="empty">Conectando con el kernel…</div>
      ) : tab === 'cpu' ? (
        <CpuTab snapshot={snapshot} />
      ) : (
        <DevicesTab snapshot={snapshot} />
      )}
    </div>
  )
}

function PolicyControls({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const send = useKernel((s) => s.send)
  return (
    <div className="toolbar-controls" data-nodrag>
      <label title="Algoritmo del planificador de corto plazo">
        <select
          value={snapshot.config.policy}
          onChange={(e) => send({ type: 'setPolicy', policy: e.target.value as SchedulerPolicy })}
        >
          {Object.entries(POLICY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label className="inline-field" title="Ticks que consume cada cambio de contexto">
        <span>Cambio de contexto</span>
        <select
          aria-label="Cambio de contexto"
          value={snapshot.config.contextSwitchTicks}
          onChange={(e) => send({ type: 'setContextSwitch', ticks: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n} {n === 1 ? 'tick' : 'ticks'}
            </option>
          ))}
        </select>
      </label>
      <label
        className="switch"
        title={`Envejecimiento: cada ${snapshot.config.agingInterval} ticks en Listo la prioridad efectiva mejora un nivel`}
      >
        <input
          type="checkbox"
          checked={snapshot.config.aging}
          onChange={(e) => send({ type: 'setAging', enabled: e.target.checked })}
        />
        <span className="switch-track" />
        <span>Aging</span>
      </label>
    </div>
  )
}

/** Aviso cuando algún proceso lleva demasiado tiempo en Listo sin recibir CPU. */
function StarvationBanner({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element | null {
  const send = useKernel((s) => s.send)
  const selectPid = useUi((s) => s.selectPid)
  const starving = snapshot.processes.filter(
    (p) => p.state === 'READY' && p.readyStreak >= snapshot.config.starvationTicks
  )
  if (starving.length === 0) return null
  return (
    <div className="starve-banner">
      <div>
        <b>Inanición:</b>{' '}
        {starving.map((p, i) => (
          <span key={p.pid}>
            {i > 0 && ', '}
            <a onClick={() => selectPid(p.pid)}>
              {p.name} (PID {p.pid}, prioridad {p.priority})
            </a>{' '}
            lleva {p.readyStreak} ticks en Listo sin CPU
          </span>
        ))}
        . Los procesos de mayor prioridad siempre le ganan el turno.
      </div>
      {!snapshot.config.aging && (
        <button onClick={() => send({ type: 'setAging', enabled: true })}>Activar aging</button>
      )}
    </div>
  )
}

function CpuTab({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const selectedPid = useUi((s) => s.selectedPid)
  const selectPid = useUi((s) => s.selectPid)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'pid', dir: 1 })

  const recent = snapshot.gantt
  const shares = new Map<number, number>()
  for (const s of recent)
    if (s.pid !== null && s.kind === 'run') shares.set(s.pid, (shares.get(s.pid) ?? 0) + 1)
  const share = (p: ProcessInfo): number => (shares.get(p.pid) ?? 0) / Math.max(1, recent.length)

  const value = (p: ProcessInfo, key: SortKey): number | string => {
    switch (key) {
      case 'name':
        return p.name.toLowerCase()
      case 'state':
        return STATE_ORDER.indexOf(p.state)
      case 'share':
        return share(p)
      default:
        return p[key]
    }
  }
  const q = query.trim().toLowerCase()
  const rows = snapshot.processes
    .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.pid) === q)
    .sort((a, b) => {
      const va = value(a, sort.key)
      const vb = value(b, sort.key)
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir || a.pid - b.pid
    })
  const selected = snapshot.processes.find((p) => p.pid === selectedPid)

  return (
    <div className="activity-cpu">
      <StarvationBanner snapshot={snapshot} />
      <div className="activity-main">
        <div className="table-area">
          <div className="search-row">
            <input
              className="search"
              placeholder="Buscar proceso o PID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="muted small">
              {snapshot.processes.filter((p) => p.state !== 'TERMINATED').length} procesos activos ·
              cola de listos:{' '}
              {snapshot.readyQueue.length ? snapshot.readyQueue.join(' → ') : 'vacía'}
            </span>
          </div>
          <div className="table-scroll">
            <table className="proc-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className={`${c.num ? 'num' : ''} ${c.optional ? 'col-optional' : ''}`}
                      title={c.title}
                      onClick={() =>
                        setSort((s) => ({
                          key: c.key,
                          dir: s.key === c.key ? (-s.dir as 1 | -1) : 1
                        }))
                      }
                    >
                      {c.label}
                      {sort.key === c.key && (
                        <span className="sort">{sort.dir === 1 ? '▲' : '▼'}</span>
                      )}
                    </th>
                  ))}
                  <th>Bloqueado por</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.pid}
                    className={`${p.pid === selectedPid ? 'selected' : ''} ${p.state === 'TERMINATED' ? 'dead' : ''}`}
                    onClick={() => selectPid(p.pid === selectedPid ? null : p.pid)}
                  >
                    <td>
                      <PidDot pid={p.pid} />
                      {p.name}
                    </td>
                    <td className="num">{p.pid}</td>
                    <td>
                      <StateChip state={p.state} />
                    </td>
                    <td className="num">
                      {p.priority}
                      {p.priority !== p.basePriority && (
                        <span className="muted"> ({p.basePriority})</span>
                      )}
                    </td>
                    <td className="num">
                      {p.state === 'RUNNING' ? (
                        <span className="muted">{p.quantumUsed}/</span>
                      ) : null}
                      {p.quantum}
                    </td>
                    <td className="num">{pct(share(p))}</td>
                    <td className="num col-optional">{p.cpuTime}</td>
                    <td className="num col-optional">{p.waitTime}</td>
                    <td className={`num${p.readyStreak >= STARVATION_TICKS ? ' starving' : ''}`}>
                      {p.readyStreak >= STARVATION_TICKS && (
                        <span title="Posible inanición">⚠ </span>
                      )}
                      {p.readyStreak}
                    </td>
                    <td className={`num${memText(p) === 'swap' ? ' swapped' : ''}`}>
                      {memText(p)}
                    </td>
                    <td className="muted">{waitingText(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {selected && <Inspector p={selected} now={snapshot.tick} />}
      </div>
      <CpuFooter snapshot={snapshot} />
    </div>
  )
}

function CpuFooter({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const { stats, processes } = snapshot
  const total = Math.max(1, stats.busyTicks + stats.idleTicks + stats.csTicks + stats.osTicks)
  const counts = new Map<ProcState, number>()
  for (const p of processes) counts.set(p.state, (counts.get(p.state) ?? 0) + 1)

  return (
    <div className="activity-footer">
      <div className="footer-stats">
        <div>
          <span>Procesos de usuario</span>
          <b style={{ color: '#30d158' }}>{pct(stats.busyTicks / total)}</b>
        </div>
        <div>
          <span>Cambio de contexto</span>
          <b style={{ color: '#64d2ff' }}>{pct(stats.csTicks / total)}</b>
        </div>
        <div>
          <span>Kernel (compactación)</span>
          <b style={{ color: '#aeaeb2' }}>{pct(stats.osTicks / total)}</b>
        </div>
        <div>
          <span>Inactiva</span>
          <b>{pct(stats.idleTicks / total)}</b>
        </div>
        <div>
          <span>Cambios de contexto</span>
          <b>{stats.contextSwitches.toLocaleString('es-MX')}</b>
        </div>
      </div>
      <div className="footer-gantt">
        <div className="section-title">Uso de la CPU por tick (Gantt)</div>
        <CpuGantt slots={snapshot.gantt.slice(-160)} processes={processes} />
      </div>
      <div className="footer-stats">
        <div>
          <span>Espera promedio</span>
          <b>{stats.avgWait.toFixed(1)} ticks</b>
        </div>
        <div>
          <span>Respuesta promedio</span>
          <b>{stats.avgResponse.toFixed(1)} ticks</b>
        </div>
        <div>
          <span>Retorno promedio</span>
          <b>{stats.finished ? `${stats.avgTurnaround.toFixed(1)} ticks` : '—'}</b>
        </div>
        <div className="state-counts">
          {STATE_ORDER.filter((s) => counts.get(s)).map((s) => (
            <span key={s} title={STATE_LABEL[s]} style={{ color: STATE_COLOR[s] }}>
              ● {counts.get(s)}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
