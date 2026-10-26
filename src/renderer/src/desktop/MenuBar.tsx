import { useEffect, useState } from 'react'
import { useKernel } from '../store/kernel'
import { useUi } from '../store/ui'
import { useSession } from '../store/session'
import { useWm } from '../store/windows'
import { APPS } from '../apps/manifest'
import { LogoGlyph } from './icons'
import { MenuGroup, type MenuDef } from './Menu'

const dateFmt = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit'
})

function Clock(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="menubar-clock">{dateFmt.format(now).replace(/\./g, '')}</span>
}

function KernelStatus(): React.JSX.Element | null {
  const tick = useKernel((s) => s.snapshot?.tick)
  const running = useKernel((s) => s.snapshot?.running)
  const cpu = useKernel((s) => s.snapshot?.stats.cpuUtilization)
  const send = useKernel((s) => s.send)
  if (tick === undefined) return null
  return (
    <button
      className="menubar-status"
      title={running ? 'Pausar el kernel' : 'Reanudar el kernel'}
      onClick={() => send({ type: running ? 'pause' : 'resume' })}
    >
      <span className={`status-dot ${running ? 'on' : 'off'}`} />
      <span>t={tick.toLocaleString('es-MX')}</span>
      <span className="muted">CPU {Math.round((cpu ?? 0) * 100)}%</span>
    </button>
  )
}

export function MenuBar(): React.JSX.Element {
  const windows = useWm((s) => s.windows)
  const focusedId = useWm((s) => s.focusedId)
  const running = useKernel((s) => s.snapshot?.running ?? true)
  const send = useKernel((s) => s.send)
  const wm = useWm.getState()
  const session = useSession.getState()
  const user = useSession((s) => s.user)

  const focused = windows.find((w) => w.id === focusedId)
  const app = focused ? APPS[focused.appId] : null

  const menus: MenuDef[] = [
    {
      id: 'system',
      label: <LogoGlyph />,
      items: [
        { label: 'Acerca de LinarezOS', action: () => wm.open('about') },
        'separator',
        {
          label: `Sesión de ${user?.fullName ?? '—'}${user?.admin ? ' (administrador)' : ''}`,
          disabled: true
        },
        { label: 'Usuarios y contraseñas…', action: () => wm.open('users') },
        'separator',
        {
          label: running ? 'Pausar el kernel' : 'Reanudar el kernel',
          shortcut: 'Espacio',
          action: () => send({ type: running ? 'pause' : 'resume' })
        },
        { label: 'Reiniciar el kernel', action: () => send({ type: 'reset' }) },
        {
          label: 'Spotlight',
          shortcut: 'Ctrl+Espacio',
          action: () => useUi.getState().set({ spotlight: true })
        },
        {
          label: 'Mission Control',
          shortcut: 'F3',
          action: () => useUi.getState().set({ missionControl: true })
        },
        'separator',
        {
          label: 'Pantalla completa',
          shortcut: 'F11',
          action: () => void window.os.system.toggleFullscreen()
        },
        'separator',
        { label: 'Suspender', action: () => session.sleep() },
        { label: 'Reiniciar…', action: () => session.restart() },
        { label: 'Apagar…', action: () => session.shutdown() },
        'separator',
        { label: 'Bloquear pantalla', shortcut: 'Ctrl+Alt+Q', action: () => session.lock() },
        {
          label: `Cerrar sesión de ${user?.fullName ?? ''}…`,
          shortcut: 'Ctrl+Mayús+Q',
          action: () => session.logout()
        }
      ]
    },
    {
      id: 'app',
      bold: true,
      label: app?.name ?? 'Finder',
      items: app
        ? [
            { label: `Acerca de ${app.name}`, action: () => wm.open('about') },
            'separator',
            { label: `Salir de ${app.name}`, shortcut: 'Ctrl+Q', action: () => wm.closeApp(app.id) }
          ]
        : [{ label: 'Acerca de LinarezOS', action: () => wm.open('about') }]
    },
    {
      id: 'file',
      label: 'Archivo',
      items: [
        {
          label: 'Nueva ventana',
          shortcut: 'Ctrl+N',
          disabled: !app || app.singleton,
          action: () => app && wm.open(app.id)
        },
        {
          label: 'Cerrar ventana',
          shortcut: 'Ctrl+W',
          disabled: !focused,
          action: () => focused && wm.close(focused.id)
        }
      ]
    },
    {
      id: 'window',
      label: 'Ventana',
      items: [
        {
          label: 'Minimizar',
          shortcut: 'Ctrl+M',
          disabled: !focused,
          action: () => focused && wm.minimize(focused.id)
        },
        {
          label: 'Zoom',
          disabled: !focused,
          action: () => focused && wm.toggleMaximize(focused.id)
        },
        {
          label: 'Mover a la mitad izquierda',
          disabled: !focused,
          action: () => focused && wm.snap(focused.id, 'left')
        },
        {
          label: 'Mover a la mitad derecha',
          disabled: !focused,
          action: () => focused && wm.snap(focused.id, 'right')
        },
        'separator',
        ...[...windows]
          .sort((a, b) => a.z - b.z)
          .map((w) => ({
            label: APPS[w.appId].name + (w.minimized ? ' (minimizada)' : ''),
            checked: w.id === focusedId,
            action: () => (w.minimized ? wm.unminimize(w.id) : wm.focus(w.id))
          }))
      ]
    }
  ]

  return (
    <div className="menubar glass-bar">
      <MenuGroup menus={menus} />
      <div className="menubar-right">
        <KernelStatus />
        <button
          className="menubar-icon"
          title="Spotlight (Ctrl+Espacio)"
          onClick={() => useUi.getState().set({ spotlight: true, controlCenter: false })}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
            <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M15 15l6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          className="menubar-icon"
          title="Centro de control"
          onClick={() =>
            useUi
              .getState()
              .set({ controlCenter: !useUi.getState().controlCenter, spotlight: false })
          }
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
            <rect
              x="3"
              y="5"
              width="18"
              height="5"
              rx="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="16" cy="7.5" r="1.8" fill="currentColor" />
            <rect
              x="3"
              y="14"
              width="18"
              height="5"
              rx="2.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="8" cy="16.5" r="1.8" fill="currentColor" />
          </svg>
        </button>
        <Clock />
      </div>
    </div>
  )
}
