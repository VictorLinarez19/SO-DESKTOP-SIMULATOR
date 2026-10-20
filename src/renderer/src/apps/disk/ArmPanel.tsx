import { motion } from 'framer-motion'
import { DISK_POLICY_LABEL, type DiskInfo } from '@shared/kernelTypes'
import { pidColor } from '../../lib/colors'
import { PidBadge } from '../../components/Chips'

const W = 640
const TRACK_Y = 34

/** Brazo del disco: posición, cola de solicitudes y recorrido reciente. */
export function ArmPanel({ disk, now }: { disk: DiskInfo; now: number }): React.JSX.Element {
  const { arm, cylinders } = disk
  const x = (c: number): number => 16 + (c / (cylinders - 1)) * (W - 32)
  const ticks = [0, 25, 50, 75, 100, 125, 150, 175, cylinders - 1]
  const moves = arm.history.slice(-18)
  const rowH = 14
  const chartH = 30 + moves.length * rowH

  return (
    <div className="arm-panel">
      <svg viewBox={`0 0 ${W} 70`} className="arm-track">
        <line x1={x(0)} x2={x(cylinders - 1)} y1={TRACK_Y} y2={TRACK_Y} className="track" />
        {ticks.map((c) => (
          <g key={c}>
            <line x1={x(c)} x2={x(c)} y1={TRACK_Y - 4} y2={TRACK_Y + 4} className="track" />
            <text x={x(c)} y={TRACK_Y + 20} textAnchor="middle" className="axis">
              {c}
            </text>
          </g>
        ))}
        {arm.queue.map((r, i) => (
          <circle key={i} cx={x(r.cylinder)} cy={TRACK_Y} r={5} fill={pidColor(r.pid)}>
            <title>{`PID ${r.pid} · ${r.label} · cilindro ${r.cylinder}`}</title>
          </circle>
        ))}
        {arm.current && (
          <circle
            cx={x(arm.current.cylinder)}
            cy={TRACK_Y}
            r={8}
            className="target"
            stroke={pidColor(arm.current.pid)}
          />
        )}
        <motion.g
          initial={false}
          animate={{ x: x(arm.head) }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <path d={`M0,${TRACK_Y - 10} l-7,-12 h14 z`} className="head" />
          <text y={TRACK_Y - 26} textAnchor="middle" className="head-label">
            {arm.head}
          </text>
        </motion.g>
      </svg>

      <div className="section-title">Recorrido del brazo (últimas {moves.length} solicitudes)</div>
      <svg viewBox={`0 0 ${W} ${chartH}`} className="arm-chart">
        {ticks.map((c) => (
          <line key={c} x1={x(c)} x2={x(c)} y1={10} y2={chartH - 4} className="grid" />
        ))}
        {moves.map((m, i) => {
          // Cada solicitud baja una fila; los extremos de SCAN/C-SCAN se dibujan como tramos.
          const y0 = 18 + i * rowH
          const y1 = y0 + rowH
          let at = m.from
          const pts = [`${x(at)},${y0}`]
          m.path.forEach((p, j) => {
            const y = y0 + ((j + 1) / m.path.length) * rowH
            // C-SCAN: el regreso de 199 a 0 se marca discontinuo
            pts.push(`${x(p)},${y}`)
            at = p
          })
          return (
            <g key={i}>
              <polyline points={pts.join(' ')} className="move" stroke={pidColor(m.pid)} />
              <circle cx={x(at)} cy={y1} r={3} fill={pidColor(m.pid)}>
                <title>{`t=${m.tick} · PID ${m.pid} · ${m.label} · ${m.distance} cilindros`}</title>
              </circle>
            </g>
          )
        })}
      </svg>

      <div className="arm-stats">
        <div>
          <span>Algoritmo</span>
          <b>{DISK_POLICY_LABEL[arm.policy]}</b>
        </div>
        <div>
          <span>Movimiento total</span>
          <b>{arm.stats.totalMovement.toLocaleString('es-MX')} cil.</b>
        </div>
        <div>
          <span>Búsqueda promedio</span>
          <b>{arm.stats.avgSeek.toFixed(1)} cil.</b>
        </div>
        <div>
          <span>Solicitudes atendidas</span>
          <b>{arm.stats.served}</b>
        </div>
        <div>
          <span>Espera promedio / máxima</span>
          <b>
            {arm.stats.avgWait.toFixed(1)} / {arm.stats.maxWait} ticks
          </b>
        </div>
      </div>

      <table className="proc-table arm-queue">
        <thead>
          <tr>
            <th>PID</th>
            <th>Operación</th>
            <th className="num">Cilindro</th>
            <th className="num">KB</th>
            <th className="num">Espera</th>
          </tr>
        </thead>
        <tbody>
          {arm.current && (
            <tr className="serving">
              <td>
                <PidBadge pid={arm.current.pid} />
              </td>
              <td>
                {arm.current.label}{' '}
                <span className="muted small">· atendiendo, faltan {arm.current.remaining}</span>
              </td>
              <td className="num">{arm.current.cylinder}</td>
              <td className="num">{arm.current.kb || '—'}</td>
              <td className="num">—</td>
            </tr>
          )}
          {arm.queue.map((r, i) => (
            <tr key={i}>
              <td>
                <PidBadge pid={r.pid} />
              </td>
              <td>{r.label}</td>
              <td className="num">{r.cylinder}</td>
              <td className="num">{r.kb || '—'}</td>
              <td className="num">{now - r.since}</td>
            </tr>
          ))}
          {!arm.current && arm.queue.length === 0 && (
            <tr>
              <td colSpan={5} className="muted empty-row">
                Sin solicitudes pendientes
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
