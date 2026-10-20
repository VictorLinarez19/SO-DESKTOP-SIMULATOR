import type { DeviceInfo, HwState } from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { useKernel } from '../../store/kernel'
import { useHardware } from '../../store/hardware'
import { PidBadge } from '../../components/Chips'
import { fmtSize } from '../../lib/files'

/** Información del sistema: el hardware real de la máquina y los controladores de guiñanOS. */
export function DevicesApp(): React.JSX.Element {
  const hw = useHardware((s) => s.hw)
  const snapshot = useKernel((s) => s.snapshot)
  if (!hw || !snapshot) return <div className="empty">Leyendo el hardware…</div>
  return (
    <div className="devices-app">
      <div className="devices-scroll">
        <HostCard hw={hw} snapshot={snapshot} />
        <div className="devices-grid">
          <PowerCard hw={hw} snapshot={snapshot} />
          <UsbCard hw={hw} snapshot={snapshot} />
        </div>
        <ControllersCard snapshot={snapshot} />
        <div className="devices-grid">
          <OtherCard hw={hw} snapshot={snapshot} />
          <LogCard hw={hw} />
        </div>
      </div>
    </div>
  )
}

function fmtUptime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

function Bar({ value, color }: { value: number; color?: string }): React.JSX.Element {
  return (
    <span className="hw-bar">
      <span style={{ width: `${Math.min(100, value * 100)}%`, background: color }} />
    </span>
  )
}

function HostCard({ hw, snapshot }: { hw: HwState; snapshot: KernelSnapshot }): React.JSX.Element {
  const h = hw.host
  const memUsed = h.memTotal - h.memAvailable
  return (
    <section className="side-card host-card">
      <div className="host-head">
        <div>
          <h2>{h.hostname}</h2>
          <div className="muted small">
            {h.kernel} · {h.cpuModel} · encendido hace {fmtUptime(h.uptime)}
          </div>
        </div>
        <div className="compare small">
          <div>
            <span>CPU real del equipo</span>
            <b>{(h.cpu * 100).toFixed(0)} %</b>
          </div>
          <div>
            <span>CPU simulada de guiñanOS</span>
            <b>{(snapshot.stats.cpuUtilization * 100).toFixed(0)} %</b>
          </div>
          <div>
            <span>Carga promedio</span>
            <b>{h.load.map((l) => l.toFixed(2)).join(' · ')}</b>
          </div>
        </div>
      </div>
      <div className="section-title">Núcleos del procesador real</div>
      <div className="cores">
        {h.cores.map((c, i) => (
          <div key={i} className="core">
            <span className="muted small">CPU {i}</span>
            <Bar value={c} color={c > 0.8 ? '#ff453a' : c > 0.5 ? '#ff9f0a' : '#30d158'} />
            <span className="small">{(c * 100).toFixed(0)} %</span>
          </div>
        ))}
      </div>
      <div className="section-title">Memoria RAM real</div>
      <div className="core">
        <span className="muted small">En uso</span>
        <Bar value={memUsed / h.memTotal} color="#0a84ff" />
        <span className="small">
          {fmtSize(memUsed)} de {fmtSize(h.memTotal)}
        </span>
      </div>
      <p className="muted small note">
        guiñanOS simula su propia RAM de {snapshot.memory.totalKb} KB y su disco de{' '}
        {fmtSize(snapshot.disk.blockCount * snapshot.disk.blockSize)} (archivo real {hw.diskPath}).
      </p>
    </section>
  )
}

function PowerCard({ hw, snapshot }: { hw: HwState; snapshot: KernelSnapshot }): React.JSX.Element {
  const b = hw.battery
  const kernel = snapshot.hardware
  return (
    <section className="side-card">
      <div className="section-title">Energía</div>
      {b ? (
        <>
          <div className="battery">
            <div className="battery-body">
              <span
                style={{
                  width: `${b.capacity}%`,
                  background: b.capacity < 20 ? '#ff453a' : hw.ac ? '#30d158' : '#ffd60a'
                }}
              />
            </div>
            <b>{b.capacity} %</b>
            <span className="muted">{hw.ac ? '🔌 Cargador conectado' : '🔋 Con batería'}</span>
          </div>
          <dl className="pcb-grid">
            <div>
              <dt>Estado</dt>
              <dd>{b.status}</dd>
            </div>
            <div>
              <dt>Consumo</dt>
              <dd>{b.powerW ? `${b.powerW.toFixed(1)} W` : '—'}</dd>
            </div>
            <div>
              <dt>Energía</dt>
              <dd>{b.energyWh ? `${b.energyWh.toFixed(1)} de ${b.fullWh?.toFixed(1)} Wh` : '—'}</dd>
            </div>
            <div>
              <dt>{b.status === 'Cargando' ? 'Hasta cargarse' : 'Tiempo restante'}</dt>
              <dd>
                {b.minutesLeft
                  ? `${Math.floor(b.minutesLeft / 60)} h ${b.minutesLeft % 60} min`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Batería</dt>
              <dd>{b.model}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="muted">Este equipo no tiene batería.</p>
      )}
      <div className={`power-policy${kernel.lowPower ? ' low' : ''}`}>
        {kernel.lowPower
          ? `Modo de bajo consumo: el kernel ralentizó su reloj a ${snapshot.tickMs} ms por tick.`
          : 'Política de energía: sin cargador y por debajo del 20 % el kernel ralentiza su reloj.'}
      </div>
    </section>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span>{label}</span>
    </label>
  )
}

function UsbCard({ hw, snapshot }: { hw: HwState; snapshot: KernelSnapshot }): React.JSX.Element {
  const send = useKernel((s) => s.send)
  const k = snapshot.hardware
  return (
    <section className="side-card">
      <div className="section-title">Puertos USB</div>
      <ul className="usb-list">
        {hw.usb.map((d) => (
          <li key={d.id}>
            <span className="usb-type">{d.type}</span>
            <span>
              <b>{d.product}</b>
              <span className="muted small">
                {' '}
                {d.manufacturer} · {d.vendorId}:{d.productId} · bus {d.id} ·{' '}
                {d.speedMbps >= 1000 ? `${d.speedMbps / 1000} Gb/s` : `${d.speedMbps} Mb/s`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="section-title">Memoria USB</div>
      {hw.storage.length === 0 ? (
        <p className="muted small">
          No hay ninguna memoria USB conectada. Conecta una: el kernel recibirá la interrupción y el
          proceso Respaldo USB copiará <code>informe.txt</code> a la carpeta{' '}
          <code>guiñanOS-respaldos</code>.
        </p>
      ) : (
        hw.storage.map((s) => (
          <div key={s.id} className="storage">
            <b>💾 {s.label}</b>
            <span className="muted small">
              {' '}
              {s.model} · {fmtSize(s.sizeBytes)} · {s.fstype} · montada en {s.mount}
            </span>
            <button onClick={() => void window.os.system.openPath(s.mount)}>Abrir</button>
          </div>
        ))
      )}
      {k.lastBackup && <p className="small">Último respaldo real: {k.lastBackup}</p>}
      <div className="toggles">
        <Toggle
          checked={k.realModes.usb}
          onChange={(v) => send({ type: 'setRealDevice', device: 'usb', real: v })}
          label="USB real"
        />
        <Toggle
          checked={k.usbStrict}
          onChange={(v) => send({ type: 'setUsbStrict', enabled: v })}
          label="Exigir memoria USB (sin ella, la E/S USB espera)"
        />
        <Toggle
          checked={k.usbBackup}
          onChange={(v) => send({ type: 'setUsbBackup', enabled: v })}
          label="Copiar los respaldos a la memoria"
        />
      </div>
    </section>
  )
}

const MODE_TEXT: Record<DeviceInfo['mode'], string> = {
  timed: 'simulado',
  event: 'hardware real (IRQ)',
  media: 'hardware real (medio)'
}

function ControllersCard({ snapshot }: { snapshot: KernelSnapshot }): React.JSX.Element {
  const send = useKernel((s) => s.send)
  const k = snapshot.hardware
  return (
    <section className="side-card">
      <div className="section-title">Controladores de dispositivo de guiñanOS</div>
      <table className="proc-table">
        <thead>
          <tr>
            <th>Dispositivo</th>
            <th>Modo</th>
            <th>Atendiendo</th>
            <th>Cola</th>
            <th className="num">IRQ reales</th>
            <th className="num">Búfer</th>
            <th className="num">Atendidas</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.devices.map((d) => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td>
                <span className={`mode-chip ${d.mode}`}>{MODE_TEXT[d.mode]}</span>
                {d.medium === false && <span className="muted small"> · sin medio</span>}
              </td>
              <td>
                {d.busyPid !== null ? (
                  <PidBadge pid={d.busyPid} />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {d.queue.length ? (
                  d.queue.map((p) => <PidBadge key={p} pid={p} />)
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="num">{d.irqs || '—'}</td>
              <td className="num">{d.buffered || '—'}</td>
              <td className="num">{d.served}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="toggles">
        <Toggle
          checked={k.realModes.teclado}
          onChange={(v) => send({ type: 'setRealDevice', device: 'teclado', real: v })}
          label="Teclado real: cada tecla es una interrupción"
        />
        <Toggle
          checked={k.realModes.raton}
          onChange={(v) => send({ type: 'setRealDevice', device: 'raton', real: v })}
          label="Ratón real"
        />
      </div>
    </section>
  )
}

function OtherCard({ hw, snapshot }: { hw: HwState; snapshot: KernelSnapshot }): React.JSX.Element {
  const rows: [string, React.ReactNode][] = [
    ['Cámaras', hw.cameras.join(', ') || '—'],
    ['Audio', hw.audio.join(' · ') || '—'],
    ['Entrada', hw.inputs.join(' · ') || '—'],
    [
      'Impresoras (CUPS)',
      hw.printers.length ? hw.printers.join(', ') : 'Ninguna: los trabajos se imprimen a PDF'
    ],
    [
      'Puertos serie',
      hw.serial.length
        ? hw.serial
            .map((s) => `${s.path} (${s.accessible ? 'accesible' : 'sin permiso: grupo dialout'})`)
            .join(', ')
        : '—'
    ]
  ]
  return (
    <section className="side-card">
      <div className="section-title">Otros dispositivos</div>
      <dl className="pcb-grid other-hw">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="print-row small">
        <span className="muted">
          {snapshot.hardware.lastPrint
            ? `Último trabajo: ${snapshot.hardware.lastPrint}`
            : 'Aún no hay trabajos impresos.'}
        </span>
        <button onClick={() => void window.os.system.openPath(hw.printDir)}>
          Abrir impresiones
        </button>
      </div>
    </section>
  )
}

function LogCard({ hw }: { hw: HwState }): React.JSX.Element {
  return (
    <section className="side-card">
      <div className="section-title">Eventos del hardware real</div>
      {hw.log.length === 0 ? (
        <p className="muted small">
          Conecta o desconecta un dispositivo USB, o el cargador, y aparecerá aquí (y como
          interrupción en el kernel).
        </p>
      ) : (
        <ul className="hw-log">
          {hw.log.map((l, i) => (
            <li key={i}>
              <span className="muted">{new Date(l.time).toLocaleTimeString('es-MX')}</span> {l.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
