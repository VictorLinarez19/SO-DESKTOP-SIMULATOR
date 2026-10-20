import { AnimatePresence, motion } from 'framer-motion'
import {
  DEADLOCK_POLICY_LABEL,
  DISK_POLICY_LABEL,
  FIT_LABEL,
  POLICY_LABEL,
  type DeadlockPolicy,
  type DiskPolicy,
  type FitPolicy,
  type SchedulerPolicy
} from '@shared/kernelTypes'
import { MAX_TICK_MS, MIN_TICK_MS } from '@shared/ipc'
import { useState } from 'react'
import { useKernel } from '../store/kernel'
import { useHardware } from '../store/hardware'
import { useSession } from '../store/session'
import { useWm } from '../store/windows'
import { useUi, WALLPAPERS } from '../store/ui'

function Select<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: T
  options: Record<string, string>
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <label className="cc-row">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
    </label>
  )
}

function Tile({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`cc-tile${on ? ' on' : ''}`} onClick={onClick}>
      <span className="cc-dot" />
      {label}
    </button>
  )
}

function Bars({ signal }: { signal: number }): React.JSX.Element {
  const n = signal > 75 ? 4 : signal > 50 ? 3 : signal > 25 ? 2 : 1
  return (
    <span className="wifi-bars" title={`${signal} %`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= n ? 'on' : ''} style={{ height: 3 + i * 3 }} />
      ))}
    </span>
  )
}

/** Wi-Fi y Bluetooth reales (NetworkManager y BlueZ), con listas desplegables. */
function Network(): React.JSX.Element {
  const net = useHardware((s) => s.hw?.net)
  const [open, setOpen] = useState<'wifi' | 'bt' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const [ask, setAsk] = useState<{ ssid: string; password: string } | null>(null)

  const act = async (label: string, action: Parameters<typeof window.os.net>[0]): Promise<void> => {
    setBusy(label)
    setMsg(null)
    const r = await window.os.net(action)
    setBusy(null)
    if (r.message) setMsg({ text: r.message, bad: !r.ok })
  }
  if (!net) return <div className="cc-section muted small">Leyendo red…</div>
  const { wifi, bluetooth } = net

  return (
    <div className="cc-section">
      <div className="cc-net-head">
        <button
          className={`cc-net-toggle${wifi.enabled ? ' on' : ''}`}
          disabled={!wifi.available || busy !== null}
          onClick={() => void act('wifi', { type: 'wifiPower', on: !wifi.enabled })}
          aria-label="Activar o desactivar el Wi-Fi"
        >
          ≋
        </button>
        <button className="cc-net-title" onClick={() => setOpen(open === 'wifi' ? null : 'wifi')}>
          <b>Wi-Fi</b>
          <span className="muted small">
            {!wifi.available
              ? 'No disponible'
              : !wifi.enabled
                ? 'Desactivado'
                : (wifi.ssid ?? 'Sin conexión')}
          </span>
        </button>
      </div>
      {open === 'wifi' && wifi.enabled && (
        <div className="cc-net-list">
          {wifi.networks.map((n) => (
            <div key={n.ssid}>
              <button
                className={`cc-net-item${n.inUse ? ' active' : ''}`}
                disabled={busy !== null}
                onClick={() => {
                  if (n.inUse) return
                  if (n.known || n.security === 'Abierta') {
                    void act(n.ssid, { type: 'wifiConnect', ssid: n.ssid })
                  } else setAsk({ ssid: n.ssid, password: '' })
                }}
              >
                <span>{n.inUse ? '✓' : ''}</span>
                <span className="cc-net-name">{n.ssid}</span>
                {n.security !== 'Abierta' ? <span title={n.security}>🔒</span> : <span />}
                <Bars signal={n.signal} />
              </button>
              {ask?.ssid === n.ssid && (
                <form
                  className="cc-net-pass"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void act(n.ssid, { type: 'wifiConnect', ssid: n.ssid, password: ask.password })
                    setAsk(null)
                  }}
                >
                  <input
                    type="password"
                    autoFocus
                    placeholder={`Contraseña de «${n.ssid}»`}
                    value={ask.password}
                    onChange={(e) => setAsk({ ssid: n.ssid, password: e.target.value })}
                  />
                  <button type="submit">Conectar</button>
                </form>
              )}
            </div>
          ))}
          <div className="cc-net-actions">
            <button disabled={busy !== null} onClick={() => void act('scan', { type: 'wifiScan' })}>
              Buscar redes
            </button>
            {wifi.ssid && (
              <button
                disabled={busy !== null}
                onClick={() => void act('off', { type: 'wifiDisconnect' })}
              >
                Desconectar
              </button>
            )}
          </div>
        </div>
      )}

      <div className="cc-net-head">
        <button
          className={`cc-net-toggle${bluetooth.powered ? ' on' : ''}`}
          disabled={!bluetooth.available || busy !== null}
          onClick={() => void act('bt', { type: 'btPower', on: !bluetooth.powered })}
          aria-label="Activar o desactivar el Bluetooth"
        >
          ᛒ
        </button>
        <button className="cc-net-title" onClick={() => setOpen(open === 'bt' ? null : 'bt')}>
          <b>Bluetooth</b>
          <span className="muted small">
            {!bluetooth.available
              ? 'No disponible'
              : !bluetooth.powered
                ? 'Desactivado'
                : (bluetooth.devices.find((d) => d.connected)?.name ?? 'Activado')}
          </span>
        </button>
      </div>
      {open === 'bt' && bluetooth.powered && (
        <div className="cc-net-list">
          {bluetooth.devices.map((d) => (
            <button
              key={d.mac}
              className={`cc-net-item${d.connected ? ' active' : ''}`}
              disabled={busy !== null}
              onClick={() =>
                void act(d.mac, { type: 'btConnect', mac: d.mac, connect: !d.connected })
              }
            >
              <span>{d.connected ? '✓' : ''}</span>
              <span className="cc-net-name">{d.name}</span>
              <span />
              <span className="muted small">
                {d.connected ? 'Desconectar' : d.paired ? 'Conectar' : 'Emparejar'}
              </span>
            </button>
          ))}
          {bluetooth.devices.length === 0 && (
            <div className="muted small">Sin dispositivos conocidos</div>
          )}
          <div className="cc-net-actions">
            <button disabled={busy !== null} onClick={() => void act('scan', { type: 'btScan' })}>
              Buscar dispositivos
            </button>
          </div>
        </div>
      )}
      {busy && <div className="muted small">Trabajando… ({busy})</div>}
      {msg && <div className={`cc-net-msg${msg.bad ? ' bad' : ''}`}>{msg.text}</div>}
    </div>
  )
}

/** Centro de control: los ajustes del kernel en un panel, como en macOS. */
export function ControlCenter(): React.JSX.Element {
  const open = useUi((s) => s.controlCenter)
  const wallpaper = useUi((s) => s.wallpaper)
  const snap = useKernel((s) => s.snapshot)
  const send = useKernel((s) => s.send)
  const close = (): void => useUi.getState().set({ controlCenter: false })

  return (
    <AnimatePresence>
      {open && snap && (
        <>
          <div className="cc-scrim" onPointerDown={close} />
          <motion.div
            className="control-center glass-strong"
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          >
            <div className="cc-footer cc-power">
              {(
                [
                  ['Bloquear', () => useSession.getState().lock()],
                  ['Suspender', () => useSession.getState().sleep()],
                  ['Reiniciar', () => useSession.getState().restart()],
                  ['Apagar', () => useSession.getState().shutdown()]
                ] as [string, () => void][]
              ).map(([label, run]) => (
                <button
                  key={label}
                  className={label === 'Apagar' ? 'danger' : undefined}
                  onClick={() => {
                    close()
                    run()
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="cc-tiles">
              <Tile
                on={snap.running}
                label={snap.running ? 'Kernel en marcha' : 'Kernel en pausa'}
                onClick={() => send({ type: snap.running ? 'pause' : 'resume' })}
              />
              <Tile
                on={snap.config.aging}
                label="Aging"
                onClick={() => send({ type: 'setAging', enabled: !snap.config.aging })}
              />
              <Tile
                on={snap.memory.autoCompact}
                label="Compactación automática"
                onClick={() => send({ type: 'setAutoCompact', enabled: !snap.memory.autoCompact })}
              />
              <Tile
                on={snap.resources.autoRecover}
                label="Recuperar interbloqueos"
                onClick={() =>
                  send({ type: 'setAutoRecover', enabled: !snap.resources.autoRecover })
                }
              />
            </div>
            <Network />
            <div className="cc-section">
              <div className="cc-label">Velocidad del reloj · {snap.tickMs} ms por tick</div>
              <input
                type="range"
                min={MIN_TICK_MS}
                max={MAX_TICK_MS}
                step={10}
                value={MAX_TICK_MS + MIN_TICK_MS - snap.tickMs}
                onChange={(e) =>
                  send({
                    type: 'setSpeed',
                    tickMs: MAX_TICK_MS + MIN_TICK_MS - Number(e.target.value)
                  })
                }
              />
              <div className="cc-scale">
                <span>lento</span>
                <button onClick={() => send({ type: 'step' })} disabled={snap.running}>
                  Paso
                </button>
                <span>rápido</span>
              </div>
            </div>
            <div className="cc-section">
              <Select<SchedulerPolicy>
                label="CPU"
                value={snap.config.policy}
                options={POLICY_LABEL}
                onChange={(policy) => send({ type: 'setPolicy', policy })}
              />
              <Select<FitPolicy>
                label="Memoria"
                value={snap.memory.policy}
                options={FIT_LABEL}
                onChange={(policy) => send({ type: 'setFitPolicy', policy })}
              />
              <Select<DiskPolicy>
                label="Disco"
                value={snap.disk.arm.policy}
                options={DISK_POLICY_LABEL}
                onChange={(policy) => send({ type: 'setDiskPolicy', policy })}
              />
              <Select<DeadlockPolicy>
                label="Interbloqueo"
                value={snap.resources.policy}
                options={DEADLOCK_POLICY_LABEL}
                onChange={(policy) => send({ type: 'setDeadlockPolicy', policy })}
              />
            </div>
            <div className="cc-section">
              <div className="cc-label">Fondo de pantalla</div>
              <div className="cc-wallpapers">
                {WALLPAPERS.map((w) => (
                  <button
                    key={w.id}
                    className={`cc-wp wp-${w.id}${w.id === wallpaper ? ' active' : ''}`}
                    onClick={() => useUi.getState().setWallpaper(w.id)}
                    title={w.name}
                  />
                ))}
              </div>
            </div>
            <div className="cc-footer">
              <button
                onClick={() => {
                  close()
                  void window.os.system.toggleFullscreen()
                }}
              >
                Pantalla completa
              </button>
              <button
                onClick={() => {
                  close()
                  useUi.getState().set({ missionControl: true })
                }}
              >
                Mission Control
              </button>
              <button
                onClick={() => {
                  close()
                  useWm.getState().open('users')
                }}
              >
                Usuarios
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
