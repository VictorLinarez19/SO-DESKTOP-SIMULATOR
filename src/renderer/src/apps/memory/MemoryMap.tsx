import { AnimatePresence, motion } from 'framer-motion'
import type { MemoryInfo, ProcessInfo } from '@shared/kernelTypes'
import { pidColor } from '../../lib/colors'
import { addr } from '../../lib/format'
import { useUi } from '../../store/ui'

const SPRING = { type: 'spring', stiffness: 170, damping: 24 } as const

/**
 * Mapa de la memoria física: cada bloque ocupa un ancho proporcional a su tamaño.
 * Las particiones conservan su identidad (clave = PID), así que al compactar se
 * ven deslizarse hacia las direcciones bajas.
 */
export function MemoryMap({
  memory,
  processes
}: {
  memory: MemoryInfo
  processes: ProcessInfo[]
}): React.JSX.Element {
  const selectedPid = useUi((s) => s.selectedPid)
  const selectPid = useUi((s) => s.selectPid)
  const byPid = new Map(processes.map((p) => [p.pid, p]))
  const pct = (kb: number): string => `${(kb / memory.totalKb) * 100}%`
  const ruler: number[] = []
  for (let kb = 0; kb <= memory.totalKb; kb += 256) ruler.push(kb)
  if (ruler.at(-1) !== memory.totalKb) ruler.push(memory.totalKb)

  return (
    <div className="mem-map-wrap">
      <div className="mem-map">
        <AnimatePresence initial={false}>
          {memory.blocks.map((b) => {
            const key = b.kind === 'process' ? `p${b.pid}` : b.kind === 'os' ? 'os' : `h${b.base}`
            const p = b.pid === null ? undefined : byPid.get(b.pid)
            const wide = b.size / memory.totalKb
            const title =
              b.kind === 'os'
                ? `Sistema operativo · ${addr(0)}–${addr(b.size)} · ${b.size} KB`
                : b.kind === 'hole'
                  ? `Hueco libre · ${addr(b.base)} · ${b.size} KB`
                  : `PID ${b.pid} ${p?.name ?? ''} · base ${addr(b.base)} · límite ${b.size} KB` +
                    (b.requested !== b.size
                      ? ` · pidió ${b.requested} KB (${b.size - b.requested!} KB de fragmentación interna)`
                      : '')
            return (
              <motion.div
                key={key}
                className={`mem-block ${b.kind}${b.loading ? ' loading' : ''}${b.pid !== null && b.pid === selectedPid ? ' selected' : ''}`}
                style={b.kind === 'process' ? { background: pidColor(b.pid!) } : undefined}
                initial={{ opacity: 0, left: pct(b.base), width: pct(b.size) }}
                animate={{ opacity: 1, left: pct(b.base), width: pct(b.size) }}
                exit={{ opacity: 0 }}
                transition={SPRING}
                title={title}
                onClick={() => b.pid !== null && selectPid(b.pid === selectedPid ? null : b.pid)}
              >
                {b.kind === 'process' && p?.overlay && <OverlaySplit p={p} size={b.size} />}
                <span className="mem-label">
                  {b.kind === 'os' ? (
                    'Sistema operativo'
                  ) : b.kind === 'hole' ? (
                    wide > 0.025 ? (
                      `${b.size} KB`
                    ) : (
                      ''
                    )
                  ) : (
                    <>
                      <b>{b.pid}</b>
                      {wide > 0.06 && <span className="mem-name"> {p?.name}</span>}
                      {wide > 0.035 && <span className="mem-size">{b.size} KB</span>}
                    </>
                  )}
                </span>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
      <div className="mem-ruler">
        {ruler.map((kb) => (
          <span key={kb} style={{ left: pct(kb) }}>
            {kb}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Dentro de la partición del Compilador: parte residente y área de recubrimiento. */
function OverlaySplit({ p, size }: { p: ProcessInfo; size: number }): React.JSX.Element {
  const ov = p.overlay!
  const rootPct = (ov.rootKb / size) * 100
  return (
    <div className="ov-split">
      <div className="ov-root" style={{ width: `${rootPct}%` }}>
        raíz
      </div>
      <div className={`ov-area${ov.pending ? ' loading' : ''}`}>
        {ov.pending ? `↓ ${ov.pending}` : (ov.loaded ?? 'overlay vacío')}
      </div>
    </div>
  )
}
