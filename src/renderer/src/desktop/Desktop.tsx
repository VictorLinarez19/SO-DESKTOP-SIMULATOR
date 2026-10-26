import { useEffect } from 'react'
import { useUi } from '../store/ui'
import { useSession } from '../store/session'
import { useKernel } from '../store/kernel'
import { APP_PROGRAM } from '../apps/manifest'
import { useWm } from '../store/windows'
import { WindowLayer } from '../wm/WindowLayer'
import { workArea } from '../wm/geometry'
import { MenuBar } from './MenuBar'
import { Dock } from './Dock'
import { Notifications } from './Notifications'
import { Spotlight } from './Spotlight'
import { ControlCenter } from './ControlCenter'
import { MissionControl } from './MissionControl'
import { PowerScreens } from './PowerScreens'

/** Ventanas que se abren al iniciar sesión. */
function openStartupWindows(): void {
  const wm = useWm.getState()
  if (wm.windows.length > 0) return
  // El diagrama queda detrás, a la derecha; el Monitor de actividad al frente, a la izquierda.
  const diagram = wm.open('diagram')
  const area = workArea()
  wm.setBounds(diagram, { x: area.x + area.w - 980 - 12, y: area.y + 10 })
  wm.endInteraction(diagram)
  const activity = wm.open('activity')
  wm.setBounds(activity, { x: area.x + 12, y: area.y + 40 })
  wm.endInteraction(activity)
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && !!target.closest('input, textarea, select, [contenteditable]')
  )
}

export function Desktop(): React.JSX.Element {
  const power = useUi((s) => s.power)
  const wallpaper = useUi((s) => s.wallpaper)

  // Las ventanas iniciales se abren cuando termina el arranque.
  useEffect(() => {
    if (power === 'on') openStartupWindows()
  }, [power])

  useEffect(() => {
    // El teclado y el ratón reales generan interrupciones en el kernel de LinarezOS.
    const send = (cmd: Parameters<typeof window.os.command>[0]): void => void window.os.command(cmd)
    let lastMove = 0
    const onPointerDown = (): void =>
      send({ type: 'hwEvent', event: { kind: 'mouse', action: 'click' } })
    const onPointerMove = (): void => {
      const now = Date.now()
      if (now - lastMove < 800) return
      lastMove = now
      send({ type: 'hwEvent', event: { kind: 'mouse', action: 'move' } })
    }
    const keyIrq = (e: KeyboardEvent): void => {
      // Contraseñas y pantallas de energía no generan IRQ de teclado hacia los procesos.
      if (useUi.getState().power !== 'on') return
      if (e.target instanceof HTMLInputElement && e.target.type === 'password') return
      if (e.repeat || ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return
      const wm = useWm.getState()
      const app = wm.windows.find((w) => w.id === wm.focusedId)?.appId
      const target = app ? APP_PROGRAM[app] : undefined
      const key = e.key.length === 1 ? e.key : e.key === ' ' ? 'espacio' : e.key
      send({ type: 'hwEvent', event: { kind: 'key', key, ...(target ? { target } : {}) } })
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('keydown', keyIrq, true)

    const onKey = (e: KeyboardEvent): void => {
      const wm = useWm.getState()
      const ui = useUi.getState()
      const focused = wm.focusedId
      if (ui.power !== 'on') return
      const session = useSession.getState()
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        session.lock()
        return
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        session.logout()
        return
      }
      if (e.key === 'Escape') {
        if (ui.spotlight || ui.controlCenter || ui.missionControl) {
          ui.set({ spotlight: false, controlCenter: false, missionControl: false })
          e.preventDefault()
        }
      } else if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        ui.set({ spotlight: !ui.spotlight, controlCenter: false, missionControl: false })
      } else if (e.key === 'F3' || (e.ctrlKey && e.key === 'ArrowUp')) {
        e.preventDefault()
        ui.set({ missionControl: !ui.missionControl, spotlight: false, controlCenter: false })
      } else if (e.key === 'F11') {
        e.preventDefault()
        void window.os.system.toggleFullscreen()
      } else if (e.code === 'Space' && !isTyping(e.target) && !e.ctrlKey && !ui.missionControl) {
        e.preventDefault()
        const { snapshot, send } = useKernel.getState()
        if (snapshot) send({ type: snapshot.running ? 'pause' : 'resume' })
      } else if (e.ctrlKey && focused) {
        const win = wm.windows.find((w) => w.id === focused)!
        const key = e.key.toLowerCase()
        if (key === 'w') wm.close(focused)
        else if (key === 'm') wm.minimize(focused)
        else if (key === 'q') wm.closeApp(win.appId)
        else if (key === 'n') wm.open(win.appId)
        else return
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keydown', keyIrq, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [])

  return (
    <div className="desktop" data-wallpaper={wallpaper} data-power={power}>
      <div className="wallpaper" />
      <MenuBar />
      <WindowLayer />
      <Dock />
      <Notifications />
      <MissionControl />
      <ControlCenter />
      <Spotlight />
      <PowerScreens />
    </div>
  )
}
