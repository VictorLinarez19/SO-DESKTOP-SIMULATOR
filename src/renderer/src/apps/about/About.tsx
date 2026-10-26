import { useKernel } from '../../store/kernel'
import { LogoIcon } from '../../desktop/icons'

export function About(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const alive = snapshot?.processes.filter((p) => p.state !== 'TERMINATED').length ?? 0
  return (
    <div className="about">
      <div className="about-logo">
        <LogoIcon />
      </div>
      <h1>LinarezOS</h1>
      <div className="muted">
        Versión 0.6 · procesos, memoria, sincronización, interbloqueo y disco
      </div>
      <dl className="about-specs">
        <div>
          <dt>Kernel</dt>
          <dd>linarez-kernel · modelo de 7 estados</dd>
        </div>
        <div>
          <dt>Reloj</dt>
          <dd>
            {snapshot
              ? `t=${snapshot.tick.toLocaleString('es-MX')} · ${snapshot.tickMs} ms/tick`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Procesos</dt>
          <dd>
            {alive} activos de {snapshot?.processes.length ?? 0}
          </dd>
        </div>
        <div>
          <dt>Planificador</dt>
          <dd>{snapshot?.config.policy ?? '—'}</dd>
        </div>
      </dl>
      <div className="muted small">Proyecto de Sistemas de Operación · 7.º semestre</div>
    </div>
  )
}
