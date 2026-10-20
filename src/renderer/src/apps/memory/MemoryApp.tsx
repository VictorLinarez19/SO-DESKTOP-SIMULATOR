import { FIT_LABEL, type FitPolicy, type ProcessInfo } from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { useKernel } from '../../store/kernel'
import { useUi } from '../../store/ui'
import { WindowToolbar } from '../../wm/WindowContext'
import { PidBadge, StateChip } from '../../components/Chips'
import { addr } from '../../lib/format'
import { MemoryMap } from './MemoryMap'

export function MemoryApp(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const send = useKernel((s) => s.send)
  if (!snapshot) return <div className="empty">Conectando con el kernel…</div>
  const { memory } = snapshot
  return (
    <div className="memory-app">
      <WindowToolbar>
        <div className="toolbar-controls" data-nodrag>
          <label className="inline-field" title="Política de colocación de particiones">
            <span>Colocación</span>
            <select
              value={memory.policy}
              onChange={(e) => send({ type: 'setFitPolicy', policy: e.target.value as FitPolicy })}
            >
              {Object.entries(FIT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label
            className="switch"
            title="Compactar automáticamente cuando la fragmentación impida cargar un proceso"
          >
            <input
              type="checkbox"
              checked={memory.autoCompact}
              onChange={(e) => send({ type: 'setAutoCompact', enabled: e.target.checked })}
            />
            <span className="switch-track" />
            <span>Compactación automática</span>
          </label>
        </div>
        <span className="toolbar-spacer" />
        <button data-nodrag onClick={() => send({ type: 'compact' })}>
          Compactar ahora
        </button>
      </WindowToolbar>
      <div className="memory-scroll">
        <MemoryMap memory={memory} processes={snapshot.processes} />
        <FragmentationAlert snapshot={snapshot} />
        <StatCards snapshot={snapshot} />
        <div className="memory-columns">
          <PartitionTable snapshot={snapshot} />
          <div className="memory-side">
            <SwapPanel snapshot={snapshot} />
            <OverlayPanel processes={snapshot.processes} />
            <CompactionPanel snapshot={snapshot} />
          </div>
        </div>
      </div>
    </div>
  )
}

function FragmentationAlert({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element | null {
  const send = useKernel((s) => s.send)
  const { memory } = snapshot
  const st = memory.stats
  // Solo los que de verdad no caben en el hueco mayor actual (tras compactar, se cargan en el siguiente tick).
  const frag = memory.waiting.filter(
    (w) => w.reason === 'fragmentation' && w.sizeKb > st.largestHoleKb
  )
  if (frag.length === 0) return null
  return (
    <div className="mem-alert">
      <div>
        <b>Fragmentación externa.</b> {frag.map((w) => `PID ${w.pid} (${w.sizeKb} KB)`).join(', ')}{' '}
        {frag.length === 1 ? 'espera' : 'esperan'} memoria aunque hay <b>{st.freeKb} KB libres</b>:
        el hueco contiguo más grande es de solo <b>{st.largestHoleKb} KB</b>.
      </div>
      {!memory.autoCompact && <button onClick={() => send({ type: 'compact' })}>Compactar</button>}
    </div>
  )
}

function StatCards({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const { memory } = snapshot
  const st = memory.stats
  const user = memory.totalKb - memory.osKb
  const cards: [string, React.ReactNode, string?][] = [
    [
      'En uso',
      `${st.usedKb} KB`,
      `${((st.usedKb / user) * 100).toFixed(0)} % de ${user} KB de usuario`
    ],
    ['Libre', `${st.freeKb} KB`, `en ${st.holeCount} ${st.holeCount === 1 ? 'hueco' : 'huecos'}`],
    ['Hueco mayor', `${st.largestHoleKb} KB`, 'máximo proceso que cabe sin compactar'],
    [
      'Fragmentación externa',
      <Gauge key="g" value={st.externalFragmentation} />,
      '1 − hueco mayor ÷ libre'
    ],
    [
      'Fragmentación interna',
      `${st.internalFragmentationKb} KB`,
      `redondeo a bloques de ${memory.unitKb} KB`
    ],
    ['Compactaciones', st.compactions, `${st.kbMoved} KB reubicados`],
    ['Intercambio', `${st.swapIns} ↓ · ${st.swapOuts} ↑`, 'swap in · swap out']
  ]
  return (
    <div className="stat-cards">
      {cards.map(([label, value, hint]) => (
        <div key={label} className="stat-card">
          <div className="stat-label">{label}</div>
          <div className="stat-value">{value}</div>
          {hint && <div className="stat-hint">{hint}</div>}
        </div>
      ))}
    </div>
  )
}

function Gauge({ value }: { value: number }): React.JSX.Element {
  const color = value > 0.5 ? '#ff453a' : value > 0.2 ? '#ff9f0a' : '#30d158'
  return (
    <span className="gauge">
      <span className="gauge-bar">
        <span style={{ width: `${value * 100}%`, background: color }} />
      </span>
      {(value * 100).toFixed(0)} %
    </span>
  )
}

function PartitionTable({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const selectPid = useUi((s) => s.selectPid)
  const selectedPid = useUi((s) => s.selectedPid)
  const byPid = new Map(snapshot.processes.map((p) => [p.pid, p]))
  return (
    <div className="mem-table">
      <div className="section-title">Tabla de particiones</div>
      <table className="proc-table">
        <thead>
          <tr>
            <th>Base</th>
            <th>Límite</th>
            <th className="num">Tamaño</th>
            <th>Contenido</th>
            <th className="num">Frag. interna</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.memory.blocks.map((b) => {
            const p = b.pid === null ? undefined : byPid.get(b.pid)
            return (
              <tr
                key={`${b.kind}-${b.base}`}
                className={`${b.kind === 'hole' ? 'hole-row' : ''} ${b.pid !== null && b.pid === selectedPid ? 'selected' : ''}`}
                onClick={() => b.pid !== null && selectPid(b.pid)}
              >
                <td className="mono">{addr(b.base)}</td>
                <td className="mono">{addr(b.base + b.size)}</td>
                <td className="num">{b.size} KB</td>
                <td>
                  {b.kind === 'os' ? (
                    <span className="muted">Sistema operativo (residente)</span>
                  ) : b.kind === 'hole' ? (
                    <span className="hole-text">Hueco libre</span>
                  ) : (
                    <>
                      <PidBadge pid={b.pid!} /> {p?.name}{' '}
                      {b.loading ? (
                        <span className="muted small">cargando desde swap…</span>
                      ) : (
                        p && <StateChip state={p.state} />
                      )}
                    </>
                  )}
                </td>
                <td className="num">
                  {b.kind === 'process' && b.size !== b.requested
                    ? `${b.size - b.requested!} KB`
                    : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SwapPanel({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const selectPid = useUi((s) => s.selectPid)
  const byPid = new Map(snapshot.processes.map((p) => [p.pid, p]))
  const { swapped, waiting, stats } = snapshot.memory
  const waitReason = new Map(
    waiting.map((w) => [w.pid, w.sizeKb <= stats.largestHoleKb ? 'fits' : w.reason])
  )
  return (
    <div className="side-card">
      <div className="section-title">Área de intercambio (disco)</div>
      {swapped.length === 0 ? (
        <p className="muted small">Todos los procesos están en memoria principal.</p>
      ) : (
        <ul className="swap-list">
          {swapped.map((s) => {
            const p = byPid.get(s.pid)!
            const reason = waitReason.get(s.pid)
            return (
              <li key={s.pid} onClick={() => selectPid(s.pid)}>
                <PidBadge pid={s.pid} />
                <span className="swap-name">{p.name}</span>
                <StateChip state={p.state} />
                <span className="muted small">{s.sizeKb} KB</span>
                <span className={`swap-reason ${reason ?? ''}`}>
                  {p.suspendedBy === 'user'
                    ? 'suspendido por el usuario'
                    : reason === 'fits'
                      ? 'cabe: se carga en el siguiente tick'
                      : reason === 'fragmentation'
                        ? 'espera: fragmentación'
                        : reason === 'no-memory'
                          ? 'espera: sin memoria'
                          : p.state === 'BLOCKED_SUSPENDED'
                            ? 'bloqueado en disco'
                            : 'esperando carga'}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function OverlayPanel({ processes }: { processes: ProcessInfo[] }): React.JSX.Element | null {
  const withOverlay = processes.filter((p) => p.overlay && p.state !== 'TERMINATED')
  if (withOverlay.length === 0) return null
  return (
    <>
      {withOverlay.map((p) => {
        const ov = p.overlay!
        const total = ov.modules.reduce((n, m) => n + m.sizeKb, ov.rootKb)
        const saved = 1 - p.memoryKb / total
        return (
          <div key={p.pid} className="side-card">
            <div className="section-title">Recubrimiento · {p.name}</div>
            <div className="ov-modules">
              <div className="ov-module root">
                <span>raíz (residente)</span>
                <b>{ov.rootKb} KB</b>
              </div>
              {ov.modules.map((m) => (
                <div
                  key={m.name}
                  className={`ov-module${m.name === ov.loaded ? ' loaded' : ''}${m.name === ov.pending ? ' pending' : ''}`}
                >
                  <span>
                    {m.name}
                    {m.name === ov.loaded && ' · en memoria'}
                    {m.name === ov.pending && ' · cargando…'}
                  </span>
                  <b>{m.sizeKb} KB</b>
                </div>
              ))}
            </div>
            <p className="muted small note">
              Sin recubrimiento necesitaría {total} KB; con él ocupa {p.memoryKb} KB (raíz + el
              módulo mayor): un ahorro del {(saved * 100).toFixed(0)} %. Los módulos se turnan en la
              misma área y se cargan desde disco al ejecutar <code>OVERLAY</code>.
            </p>
          </div>
        )
      })}
    </>
  )
}

function CompactionPanel({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const last = snapshot.memory.lastCompaction
  return (
    <div className="side-card">
      <div className="section-title">Última compactación</div>
      {!last ? (
        <p className="muted small">Aún no ha sido necesario compactar.</p>
      ) : (
        <>
          <p className="small">
            t={last.tick} · {last.moves.length} particiones reubicadas · {last.cost} ticks de CPU
            del kernel
          </p>
          <ul className="moves">
            {last.moves.map((m) => (
              <li key={m.pid}>
                <PidBadge pid={m.pid} />
                <span className="mono small">
                  {addr(m.from)} → {addr(m.to)}
                </span>
                <span className="muted small">{m.size} KB</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
