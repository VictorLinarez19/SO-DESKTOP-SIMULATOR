import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNotifications, type Notice } from '../store/notifications'
import { useWm } from '../store/windows'
import { useUi } from '../store/ui'
import type { AppId } from '../apps/manifest'

const LIFETIME_MS = 7000

const APP_FOR: Partial<Record<Notice['kind'], AppId>> = {
  deadlock: 'deadlock',
  resource: 'deadlock',
  starvation: 'activity',
  memory: 'memory',
  sync: 'sync',
  interrupt: 'devices',
  file: 'devices'
}

/** Notificaciones del sistema (esquina superior derecha), como en macOS. */
export function Notifications(): React.JSX.Element {
  const notices = useNotifications((s) => s.notices)
  return (
    <div className="notifications">
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <NoticeCard key={n.id} n={n} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function NoticeCard({ n }: { n: Notice }): React.JSX.Element {
  const dismiss = useNotifications((s) => s.dismiss)
  useEffect(() => {
    const t = setTimeout(() => dismiss(n.id), LIFETIME_MS)
    return () => clearTimeout(t)
  }, [n.id, dismiss])
  return (
    <motion.div
      layout
      className={`notice glass-strong ${n.level}`}
      initial={{ opacity: 0, x: 60, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      onClick={() => {
        const app = APP_FOR[n.kind]
        if (app) useWm.getState().activateApp(app)
        if (n.pid) useUi.getState().selectPid(n.pid)
        dismiss(n.id)
      }}
    >
      <div className="notice-icon">
        {n.level === 'critical' ? '⛔' : n.level === 'warning' ? '⚠️' : 'ℹ️'}
      </div>
      <div className="notice-text">
        <div className="notice-title">
          {n.title}
          <span className="muted small"> · ahora</span>
        </div>
        <div className="notice-body">{n.body}</div>
      </div>
      <button
        className="notice-close"
        aria-label="Cerrar"
        onClick={(e) => {
          e.stopPropagation()
          dismiss(n.id)
        }}
      >
        ×
      </button>
    </motion.div>
  )
}
