import type { KernelSnapshot } from '@shared/ipc'
import { PidBadge } from '../../components/Chips'
import { useUi } from '../../store/ui'

/** Controladores de dispositivo: quién está siendo atendido y la cola de espera de cada uno. */
export function DevicesTab({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const selectPid = useUi((s) => s.selectPid)
  const names = new Map(snapshot.processes.map((p) => [p.pid, p.name]))
  const now = Math.max(1, snapshot.tick)
  return (
    <div className="table-scroll pad">
      <table className="proc-table">
        <thead>
          <tr>
            <th>Dispositivo</th>
            <th>Estado</th>
            <th>Atendiendo</th>
            <th className="num">Faltan</th>
            <th>Cola de espera (FCFS)</th>
            <th className="num">Atendidas</th>
            <th className="num">Uso</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.devices.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>
                <span className={`dev-state ${d.busyPid === null ? 'idle' : 'busy'}`}>
                  {d.busyPid === null ? 'Libre' : 'Ocupado'}
                </span>
              </td>
              <td>
                {d.busyPid !== null && (
                  <>
                    <PidBadge pid={d.busyPid} onClick={() => selectPid(d.busyPid)} />{' '}
                    {names.get(d.busyPid)}
                  </>
                )}
              </td>
              <td className="num">{d.busyPid === null ? '—' : d.remaining}</td>
              <td>
                {d.queue.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  d.queue.map((pid) => (
                    <PidBadge key={pid} pid={pid} onClick={() => selectPid(pid)} />
                  ))
                )}
              </td>
              <td className="num">{d.served}</td>
              <td className="num">
                <span className="usage-bar">
                  <span style={{ width: `${(d.busyTicks / now) * 100}%` }} />
                </span>
                {((d.busyTicks / now) * 100).toFixed(0)} %
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small note">
        Cada controlador atiende una petición a la vez. Al terminar genera una interrupción (IRQ) y
        el proceso pasa de Bloqueado a Listo. En F7 estos dispositivos se conectan al hardware real.
      </p>
    </div>
  )
}
