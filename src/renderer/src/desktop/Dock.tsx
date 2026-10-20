import { useEffect, useRef } from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue
} from 'framer-motion'
import { useWm } from '../store/windows'
import { APPS, DOCK_APPS, type AppId } from '../apps/manifest'
import { dockIcons } from '../wm/geometry'
import { APP_ICONS } from './icons'

const BASE = 52
const MAX = 84
const RANGE = 150

export function Dock(): React.JSX.Element {
  const mouseX = useMotionValue(Infinity)
  const windows = useWm((s) => s.windows)
  // Las apps abiertas que no están fijas también aparecen en el Dock mientras corren.
  const extra = [...new Set(windows.map((w) => w.appId))].filter((id) => !DOCK_APPS.includes(id))

  return (
    <div className="dock-wrap">
      <motion.div
        className="dock glass-bar"
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
      >
        {DOCK_APPS.map((id, i) =>
          id === '|' ? (
            <div key={`sep${i}`} className="dock-sep" />
          ) : (
            <DockIcon key={id} appId={id} mouseX={mouseX} />
          )
        )}
        {extra.length > 0 && <div className="dock-sep" />}
        {extra.map((id) => (
          <DockIcon key={id} appId={id} mouseX={mouseX} />
        ))}
      </motion.div>
    </div>
  )
}

function DockIcon({ appId, mouseX }: { appId: AppId; mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLButtonElement>(null)
  const running = useWm((s) => s.windows.some((w) => w.appId === appId))
  const launches = useWm((s) => s.launches[appId] ?? 0)
  const y = useMotionValue(0)

  const distance = useTransform(mouseX, (x) => {
    const r = ref.current?.getBoundingClientRect()
    return r ? x - (r.left + r.width / 2) : Infinity
  })
  const sizeTarget = useTransform(distance, [-RANGE, 0, RANGE], [BASE, MAX, BASE])
  const size = useSpring(sizeTarget, { mass: 0.1, stiffness: 170, damping: 14 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    dockIcons.set(appId, el)
    return () => {
      if (dockIcons.get(appId) === el) dockIcons.delete(appId)
    }
  }, [appId])

  // Rebote al abrir una ventana nueva de la app.
  useEffect(() => {
    if (launches === 0) return
    const controls = animate(y, [0, -22, 0, -9, 0], { duration: 0.7, ease: 'easeOut' })
    return () => controls.stop()
  }, [launches, y])

  const Icon = APP_ICONS[appId]
  return (
    <motion.button
      ref={ref}
      className="dock-icon"
      style={{ width: size, height: size, y }}
      onClick={() => useWm.getState().activateApp(appId)}
      aria-label={APPS[appId].name}
    >
      <span className="dock-tooltip glass-strong">{APPS[appId].name}</span>
      <Icon />
      {running && <span className="dock-dot" />}
    </motion.button>
  )
}
