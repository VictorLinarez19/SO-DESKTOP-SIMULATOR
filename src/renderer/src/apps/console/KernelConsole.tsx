import { useLayoutEffect, useRef, useState } from 'react'
import type { KernelEventKind } from '@shared/kernelTypes'
import { useKernel } from '../../store/kernel'
import { eventsToCsv, snapshotToReport } from '../../lib/exporter'
import { WindowToolbar } from '../../wm/WindowContext'
import { pidColor } from '../../lib/colors'

type Filter = 'all' | KernelEventKind

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'transition', label: 'Estados' },
  { value: 'dispatch', label: 'Despacho' },
  { value: 'interrupt', label: 'IRQ' },
  { value: 'syscall', label: 'Syscalls' },
  { value: 'memory', label: 'Memoria' },
  { value: 'sync', label: 'Sincronización' },
  { value: 'resource', label: 'Recursos' },
  { value: 'deadlock', label: 'Interbloqueo' },
  { value: 'starvation', label: 'Inanición / aging' },
  { value: 'command', label: 'Órdenes' }
]

/** Bitácora del kernel en vivo, con filtros por tipo de evento y búsqueda. */
export function KernelConsole(): React.JSX.Element {
  const events = useKernel((s) => s.snapshot?.events ?? [])
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [exported, setExported] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const doExport = async (kind: 'csv' | 'json' | 'md'): Promise<void> => {
    const snap = useKernel.getState().snapshot
    if (!snap) return
    const all = await window.os.query({ type: 'eventLog' })
    const names = new Map(snap.processes.map((p) => [p.pid, p.name]))
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
    const content =
      kind === 'csv'
        ? eventsToCsv(all, names)
        : kind === 'json'
          ? JSON.stringify(
              {
                tick: snap.tick,
                procesos: snap.processes.map((p) => ({
                  pid: p.pid,
                  nombre: p.name,
                  estado: p.state
                })),
                eventos: all
              },
              null,
              2
            )
          : snapshotToReport(snap, all)
    setExported(await window.os.system.saveExport(`guinanOS_${stamp}.${kind}`, content))
  }
  const stick = useRef(true)

  const q = query.trim().toLowerCase()
  const shown = events.filter(
    (e) =>
      (filter === 'all' || e.kind === filter) &&
      (!q || e.message.toLowerCase().includes(q) || `pid ${e.pid}` === q || String(e.pid) === q)
  )

  // Desplazamiento automático al final, salvo que el usuario haya subido a leer.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  })

  return (
    <div className="console">
      <WindowToolbar>
        <select data-nodrag value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="toolbar-spacer" />
        <div className="toolbar-controls" data-nodrag>
          <button onClick={() => void doExport('csv')} title="Toda la bitácora en CSV">
            CSV
          </button>
          <button onClick={() => void doExport('json')} title="Toda la bitácora en JSON">
            JSON
          </button>
          <button onClick={() => void doExport('md')} title="Reporte con métricas y estado final">
            Reporte
          </button>
        </div>
        <input
          className="search"
          placeholder="Filtrar (texto o PID)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </WindowToolbar>
      {exported && (
        <div className="export-note small">
          Guardado en {exported}
          <button onClick={() => void window.os.system.openPath(exported.replace(/\/[^/]*$/, ''))}>
            Abrir carpeta
          </button>
        </div>
      )}
      <div
        className="console-lines"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {shown.map((e) => (
          <div key={e.id} className={`console-line k-${e.kind}`}>
            <span className="c-tick">[{String(e.tick).padStart(5, ' ')}]</span>
            <span className="c-kind">{e.kind}</span>
            {e.pid ? (
              <span className="c-pid" style={{ color: pidColor(e.pid) }}>
                PID {String(e.pid).padStart(2, ' ')}
              </span>
            ) : (
              <span className="c-pid">kernel</span>
            )}
            <span className="c-msg">{e.message}</span>
          </div>
        ))}
        {shown.length === 0 && <div className="muted">Sin eventos que coincidan.</div>}
      </div>
    </div>
  )
}
