import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { APPS } from '../apps/manifest'
import { useWm, type WinState } from '../store/windows'
import { dockIcons, MENU_BAR_H, snapZoneAt, type Bounds } from './geometry'
import { WindowContext } from './WindowContext'

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const SPRING = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 } as const
const INSTANT = { duration: 0 } as const

/** Elementos dentro de la barra de título que no inician el arrastre. */
const NO_DRAG = 'button, input, select, textarea, a, [data-nodrag]'

interface Props {
  win: WinState
  focused: boolean
  children: ReactNode
}

export function Window({ win, focused, children }: Props): React.JSX.Element {
  const app = APPS[win.appId]
  const [toolbarEl, setToolbarEl] = useState<HTMLElement | null>(null)
  const {
    focus,
    close,
    minimize,
    toggleMaximize,
    setBounds,
    endInteraction,
    snap,
    setSnapPreview
  } = useWm.getState()

  // ── arrastre por la barra de título ──
  function onTitlePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0 || (e.target as HTMLElement).closest(NO_DRAG)) return
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    let start = { x: win.x, y: win.y, w: win.w }
    let grabX = e.clientX - win.x
    const grabY = e.clientY - win.y
    let detached = !(win.maximized || win.snapped)
    let moved = false

    const onMove = (ev: PointerEvent): void => {
      if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
      moved = true
      if (!detached && win.restore) {
        // Al arrastrar una ventana maximizada recupera su tamaño bajo el puntero (como macOS).
        const ratio = grabX / start.w
        start = { x: win.x, y: win.y, w: win.restore.w }
        grabX = Math.round(win.restore.w * ratio)
        setBounds(win.id, { w: win.restore.w, h: win.restore.h }, true)
        detached = true
      }
      const x = ev.clientX - grabX
      const y = Math.max(MENU_BAR_H, ev.clientY - grabY)
      setBounds(win.id, { x, y }, true)
      setSnapPreview(app.resizable ? snapZoneAt(ev.clientX, ev.clientY) : null)
    }
    const onUp = (ev: PointerEvent): void => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setSnapPreview(null)
      const zone = moved && app.resizable ? snapZoneAt(ev.clientX, ev.clientY) : null
      if (zone) snap(win.id, zone)
      else endInteraction(win.id)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // ── redimensión por bordes y esquinas ──
  function onResizePointerDown(edge: Edge, e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    focus(win.id)
    const start: Bounds = { x: win.x, y: win.y, w: win.w, h: win.h }
    const { w: minW, h: minH } = app.minSize

    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - e.clientX
      const dy = ev.clientY - e.clientY
      const b = { ...start }
      if (edge.includes('e')) b.w = Math.max(minW, start.w + dx)
      if (edge.includes('s')) b.h = Math.max(minH, start.h + dy)
      if (edge.includes('w')) {
        b.w = Math.max(minW, start.w - dx)
        b.x = start.x + start.w - b.w
      }
      if (edge.includes('n')) {
        const maxGrow = start.y - MENU_BAR_H
        b.h = Math.max(minH, Math.min(start.h - dy, start.h + maxGrow))
        b.y = start.y + start.h - b.h
      }
      setBounds(win.id, b, true)
    }
    const onUp = (): void => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      endInteraction(win.id)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const target = win.minimized ? minimizeTarget(win) : { x: win.x, y: win.y, scale: 1, opacity: 1 }

  return (
    <WindowContext.Provider value={{ id: win.id, focused, toolbarEl }}>
      <motion.div
        className={`window${focused ? ' focused' : ''}${win.maximized ? ' maximized' : ''}`}
        style={{ zIndex: win.z, pointerEvents: win.minimized ? 'none' : undefined }}
        initial={{ x: win.x, y: win.y + 16, width: win.w, height: win.h, scale: 0.94, opacity: 0 }}
        animate={{ ...target, width: win.w, height: win.h }}
        exit={{ scale: 0.94, opacity: 0, transition: { duration: 0.16 } }}
        transition={
          win.interacting
            ? INSTANT
            : win.minimized
              ? { duration: 0.32, ease: [0.4, 0, 1, 1] }
              : SPRING
        }
        onPointerDownCapture={() => focus(win.id)}
        role="dialog"
        aria-label={app.name}
      >
        <div
          className="titlebar"
          onPointerDown={onTitlePointerDown}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest(NO_DRAG)) toggleMaximize(win.id)
          }}
        >
          <div className="traffic-lights" data-nodrag>
            <button className="tl close" aria-label="Cerrar" onClick={() => close(win.id)}>
              <svg viewBox="0 0 12 12">
                <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
              </svg>
            </button>
            <button className="tl min" aria-label="Minimizar" onClick={() => minimize(win.id)}>
              <svg viewBox="0 0 12 12">
                <path d="M3 6h6" />
              </svg>
            </button>
            <button
              className="tl max"
              aria-label="Zoom"
              disabled={!app.resizable}
              onClick={() => toggleMaximize(win.id)}
            >
              <svg viewBox="0 0 12 12">
                <path d="M3.5 7.8V3.5h4.3zM8.5 4.2v4.3H4.2z" fill="currentColor" stroke="none" />
              </svg>
            </button>
          </div>
          <div className="title">{app.name}</div>
          <div className="toolbar-slot" ref={setToolbarEl} />
        </div>
        <div className="window-body">{children}</div>
        {app.resizable &&
          !win.maximized &&
          EDGES.map((edge) => (
            <div
              key={edge}
              className={`resize resize-${edge}`}
              onPointerDown={(e) => onResizePointerDown(edge, e)}
            />
          ))}
      </motion.div>
    </WindowContext.Provider>
  )
}

/** Hacia dónde viaja la ventana al minimizarse: el icono de su app en el Dock. */
function minimizeTarget(win: WinState): { x: number; y: number; scale: number; opacity: number } {
  const icon = dockIcons.get(win.appId)?.getBoundingClientRect()
  const cx = icon ? icon.left + icon.width / 2 : window.innerWidth / 2
  const cy = icon ? icon.top + icon.height / 2 : window.innerHeight
  return { x: cx - win.w / 2, y: cy - win.h / 2, scale: 0.06, opacity: 0 }
}
