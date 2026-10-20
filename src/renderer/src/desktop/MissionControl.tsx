import { AnimatePresence, motion } from 'framer-motion'
import { useUi } from '../store/ui'
import { useWm } from '../store/windows'
import { APPS } from '../apps/manifest'
import { APP_ICONS } from './icons'
import { MENU_BAR_H } from '../wm/geometry'

/** Mission Control (F3 / Ctrl+↑): todas las ventanas abiertas en una cuadrícula. */
export function MissionControl(): React.JSX.Element {
  const open = useUi((s) => s.missionControl)
  const windows = useWm((s) => s.windows)
  const close = (): void => useUi.getState().set({ missionControl: false })
  const ordered = [...windows].sort((a, b) => a.z - b.z)
  const n = ordered.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.6)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const pad = 48
  const areaW = window.innerWidth - pad * 2
  const areaH = window.innerHeight - MENU_BAR_H - 120 - pad
  const cellW = areaW / cols
  const cellH = areaH / rows

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="mission-control"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={close}
        >
          {n === 0 && <div className="mc-empty">No hay ventanas abiertas</div>}
          {ordered.map((w, i) => {
            const Icon = APP_ICONS[w.appId]
            const scale = Math.min((cellW - 24) / w.w, (cellH - 48) / w.h, 0.9)
            const col = i % cols
            const row = Math.floor(i / cols)
            const cx = pad + col * cellW + cellW / 2
            const cy = MENU_BAR_H + 24 + row * cellH + cellH / 2
            return (
              <motion.button
                key={w.id}
                className="mc-card glass-strong"
                style={{ width: w.w, height: w.h, left: 0, top: 0, transformOrigin: 'center' }}
                initial={{ x: w.x, y: w.y, scale: 1, opacity: 0.6 }}
                animate={{ x: cx - w.w / 2, y: cy - w.h / 2, scale, opacity: 1 }}
                exit={{ x: w.x, y: w.y, scale: 1, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  close()
                  useWm.getState().unminimize(w.id)
                }}
              >
                <span className="mc-icon">
                  <Icon />
                </span>
                <span className="mc-name">{APPS[w.appId].name}</span>
                {w.minimized && <span className="mc-min">minimizada</span>}
              </motion.button>
            )
          })}
          {n > 0 && <div className="mc-hint">Haz clic en una ventana · Esc para salir</div>}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
