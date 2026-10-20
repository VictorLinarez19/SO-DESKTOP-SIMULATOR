import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useKernel } from '../store/kernel'
import { useUi } from '../store/ui'
import { useWm } from '../store/windows'
import { APPS, type AppId } from '../apps/manifest'
import { STATE_LABEL } from '@shared/kernelTypes'
import { APP_ICONS } from './icons'
import { parentOf } from '../lib/files'
import { FileIcon } from '../apps/finder/FileIcon'
import { PidDot } from '../components/Chips'

interface Result {
  id: string
  group: 'Aplicaciones' | 'Procesos' | 'Archivos' | 'Acciones'
  title: string
  subtitle?: string
  icon: React.ReactNode
  run: () => void
}

const norm = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Spotlight (Ctrl+Espacio): apps, procesos, archivos de disk.img y acciones del sistema. */
export function Spotlight(): React.JSX.Element {
  const open = useUi((s) => s.spotlight)
  return <AnimatePresence>{open && <SpotlightPanel key="panel" />}</AnimatePresence>
}

function SpotlightPanel(): React.JSX.Element {
  // Se monta al abrir: la consulta y la selección empiezan vacías cada vez.
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const snapshot = useKernel((s) => s.snapshot)

  useEffect(() => {
    input.current?.focus()
  }, [])

  const close = (): void => useUi.getState().set({ spotlight: false })

  const all = useMemo<Result[]>(() => {
    const out: Result[] = []
    const wm = useWm.getState()
    for (const app of Object.values(APPS)) {
      const Icon = APP_ICONS[app.id as AppId]
      out.push({
        id: `app-${app.id}`,
        group: 'Aplicaciones',
        title: app.name,
        icon: (
          <span className="sp-icon">
            <Icon />
          </span>
        ),
        run: () => wm.activateApp(app.id)
      })
    }
    for (const p of snapshot?.processes ?? []) {
      out.push({
        id: `pid-${p.pid}`,
        group: 'Procesos',
        title: p.name,
        subtitle: `PID ${p.pid} · ${STATE_LABEL[p.state]} · prioridad ${p.priority}`,
        icon: <PidDot pid={p.pid} />,
        run: () => {
          useUi.getState().selectPid(p.pid)
          wm.activateApp('activity')
        }
      })
    }
    for (const f of snapshot?.disk.files ?? []) {
      if (f.path === '/') continue
      out.push({
        id: `file-${f.path}`,
        group: 'Archivos',
        title: f.name,
        subtitle: f.path,
        icon: <FileIcon name={f.name} dir={f.type === 'dir'} />,
        run: () => {
          const ui = useUi.getState()
          ui.setFinderPath(f.type === 'dir' ? f.path : parentOf(f.path))
          ui.selectFile(f.type === 'dir' ? null : f.path)
          wm.activateApp('finder')
        }
      })
    }
    const send = useKernel.getState().send
    const act = (id: string, title: string, run: () => void): void => {
      out.push({
        id: `act-${id}`,
        group: 'Acciones',
        title,
        icon: <span className="sp-act">⚙︎</span>,
        run
      })
    }
    act('pause', snapshot?.running ? 'Pausar el kernel' : 'Reanudar el kernel', () =>
      send({ type: snapshot?.running ? 'pause' : 'resume' })
    )
    act('compact', 'Compactar la memoria', () => send({ type: 'compact' }))
    act(
      'aging',
      `${snapshot?.config.aging ? 'Desactivar' : 'Activar'} el envejecimiento (aging)`,
      () => send({ type: 'setAging', enabled: !snapshot?.config.aging })
    )
    act('recover', 'Recuperar el interbloqueo', () => send({ type: 'recoverDeadlock' }))
    act('reset', 'Reiniciar el kernel', () => send({ type: 'reset' }))
    act('cc', 'Abrir el Centro de control', () => useUi.getState().set({ controlCenter: true }))
    act('mc', 'Mission Control', () => useUi.getState().set({ missionControl: true }))
    act('fs', 'Pantalla completa', () => void window.os.system.toggleFullscreen())
    return out
  }, [snapshot])

  const results = useMemo(() => {
    const q = norm(query.trim())
    const scored = all
      .map((r) => {
        if (!q) return { r, s: r.group === 'Aplicaciones' ? 1 : r.group === 'Acciones' ? 0.5 : 0 }
        const t = norm(r.title)
        const sub = norm(r.subtitle ?? '')
        const s = t.startsWith(q) ? 3 : t.includes(q) ? 2 : sub.includes(q) ? 1 : 0
        return { r, s }
      })
      .filter((x) => x.s > 0)
    scored.sort((a, b) => b.s - a.s)
    const order = ['Aplicaciones', 'Procesos', 'Archivos', 'Acciones']
    const limit = q ? 12 : 8
    return scored
      .map((x) => x.r)
      .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
      .slice(0, limit)
  }, [all, query])

  const choose = (r: Result | undefined): void => {
    if (!r) return
    close()
    r.run()
  }

  return (
    <>
      {
        <motion.div
          className="overlay-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={close}
        >
          <motion.div
            className="spotlight glass-strong"
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="spotlight-input">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                <circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M15 15l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                ref={input}
                value={query}
                placeholder="Buscar apps, procesos, archivos y acciones"
                onChange={(e) => {
                  setQuery(e.target.value)
                  setIndex(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setIndex((i) => Math.min(results.length - 1, i + 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setIndex((i) => Math.max(0, i - 1))
                  } else if (e.key === 'Enter') choose(results[index])
                  else if (e.key === 'Escape') close()
                }}
              />
            </div>
            {results.length > 0 && (
              <ul className="spotlight-results">
                {results.map((r, i) => (
                  <li key={r.id}>
                    {(i === 0 || results[i - 1].group !== r.group) && (
                      <div className="sp-group">{r.group}</div>
                    )}
                    <button
                      className={`sp-item${i === index ? ' active' : ''}`}
                      onMouseEnter={() => setIndex(i)}
                      onClick={() => choose(r)}
                    >
                      {r.icon}
                      <span className="sp-title">{r.title}</span>
                      {r.subtitle && <span className="sp-sub">{r.subtitle}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {results.length === 0 && <div className="sp-empty">Sin resultados para «{query}»</div>}
          </motion.div>
        </motion.div>
      }
    </>
  )
}
