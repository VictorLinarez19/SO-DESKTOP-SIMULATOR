import { useState } from 'react'
import { SCENARIOS, type Scenario } from '@shared/scenarios'
import { useKernel } from '../../store/kernel'
import { useWm } from '../../store/windows'
import { APPS, type AppId } from '../manifest'

/** Demostración: escenarios de un clic para provocar y observar cada concepto. */
export function DemoApp(): React.JSX.Element {
  const [active, setActive] = useState<string | null>(null)
  const tick = useKernel((s) => s.snapshot?.tick ?? 0)
  const [startedAt, setStartedAt] = useState(0)

  const run = (s: Scenario): void => {
    const send = useKernel.getState().send
    for (const c of s.commands) send(c)
    send({ type: 'resume' })
    setActive(s.id)
    setStartedAt(0)
    useWm.getState().activateApp(s.app as AppId)
  }

  return (
    <div className="demo-app">
      <p className="muted small demo-intro">
        Cada escenario reinicia el kernel, lo configura para provocar un fenómeno y abre la app
        donde se ve. La barra indica cuánto falta para que aparezca.
      </p>
      <div className="demo-grid">
        {SCENARIOS.map((s) => {
          const on = active === s.id
          const progress = on && s.ticks > 0 ? Math.min(1, (tick - startedAt) / s.ticks) : 0
          return (
            <section key={s.id} className={`demo-card${on ? ' active' : ''}`}>
              <div className="demo-concept">{s.concept}</div>
              <h3>{s.title}</h3>
              <p className="small muted">{s.expect}</p>
              {on && s.ticks > 0 && (
                <div className="demo-progress" title={`${Math.round(progress * 100)} %`}>
                  <span style={{ width: `${progress * 100}%` }} />
                </div>
              )}
              <div className="demo-actions">
                <button onClick={() => run(s)}>{on ? 'Reiniciar escenario' : 'Iniciar'}</button>
                <button onClick={() => useWm.getState().activateApp(s.app as AppId)}>
                  Abrir {APPS[s.app as AppId].name}
                </button>
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
