import { DISK_POLICY_LABEL, type DiskPolicy } from '@shared/kernelTypes'
import { useKernel } from '../../store/kernel'
import { WindowToolbar } from '../../wm/WindowContext'
import { fmtDate, fmtSize } from '../../lib/files'
import { BlockMap } from './BlockMap'
import { ArmPanel } from './ArmPanel'

export function DiskUtility(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const send = useKernel((s) => s.send)
  if (!snapshot) return <div className="empty">Conectando con el kernel…</div>
  const disk = snapshot.disk
  const u = disk.usage
  const total = disk.blockCount * disk.blockSize
  const usedPct = u.usedBlocks / u.dataBlocks

  return (
    <div className="disk-app">
      <WindowToolbar>
        <div className="toolbar-controls" data-nodrag>
          <label className="inline-field" title="Algoritmo de planificación del brazo del disco">
            <span>Planificación del brazo</span>
            <select
              value={disk.arm.policy}
              onChange={(e) =>
                send({ type: 'setDiskPolicy', policy: e.target.value as DiskPolicy })
              }
            >
              {Object.entries(DISK_POLICY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      </WindowToolbar>
      <div className="disk-scroll">
        <div className="disk-header">
          <svg viewBox="0 0 48 48" width="56" height="56" aria-hidden>
            <rect x="4" y="12" width="40" height="24" rx="5" fill="#aeaeb2" />
            <rect
              x="4"
              y="12"
              width="40"
              height="24"
              rx="5"
              fill="none"
              stroke="#fff"
              strokeOpacity="0.4"
            />
            <circle cx="36" cy="24" r="2.5" fill="#30d158" />
          </svg>
          <div className="disk-title">
            <h2>Macintosh HD</h2>
            <div className="muted small">
              LinarezFS · asignación indexada · {fmtSize(total)} · bloques de {disk.blockSize / 1024}{' '}
              KB · {disk.cylinders} cilindros
            </div>
            <div className="mono small disk-path" title="Archivo real que contiene el disco">
              {disk.path ?? 'disco en memoria'}
            </div>
          </div>
          <div className="disk-facts small">
            <div>
              <span>Formateado</span>
              <b>{fmtDate(disk.formattedAt)}</b>
            </div>
            <div>
              <span>Montajes</span>
              <b>{disk.mountCount}</b>
            </div>
            <div>
              <span>Lecturas / escrituras</span>
              <b>
                {disk.io.reads} / {disk.io.writes}
              </b>
            </div>
            <div>
              <span>Transferido</span>
              <b>
                {fmtSize(disk.io.kbRead * 1024)} ↓ · {fmtSize(disk.io.kbWritten * 1024)} ↑
              </b>
            </div>
          </div>
        </div>

        <div className="usage-row">
          <div className="usage-track">
            <span className="seg used" style={{ width: `${usedPct * 100}%` }} />
          </div>
          <div className="small muted">
            Datos: {fmtSize(u.usedBlocks * disk.blockSize)} usados de{' '}
            {fmtSize(u.dataBlocks * disk.blockSize)} · libres{' '}
            {fmtSize(u.freeBlocks * disk.blockSize)} · swap {fmtSize(u.swapUsed * disk.blockSize)}{' '}
            de {fmtSize(u.swapBlocks * disk.blockSize)}
          </div>
        </div>

        <div className="disk-columns">
          <section className="side-card">
            <div className="section-title">Mapa de bloques</div>
            <BlockMap disk={disk} />
          </section>
          <section className="side-card">
            <div className="section-title">Brazo del disco</div>
            <ArmPanel disk={disk} now={snapshot.tick} />
          </section>
        </div>
      </div>
    </div>
  )
}
