import type { ProcessInfo } from '@shared/kernelTypes'

/** Código del programa con la instrucción actual (contador de programa) resaltada. */
export function ProgramListing({
  p,
  highlight
}: {
  p: ProcessInfo
  /** Rango de líneas a marcar (p. ej. la sección crítica). */
  highlight?: { from: number; to: number; className: string }
}): React.JSX.Element {
  const alive = p.state !== 'TERMINATED'
  // Un proceso bloqueado ya avanzó su PC: se marca la instrucción por la que espera.
  const blocked = p.state === 'BLOCKED' || p.state === 'BLOCKED_SUSPENDED'
  const waitsOn =
    blocked && p.waitingOn && p.waitingOn.kind !== 'memory' && p.waitingOn.kind !== 'swap'
      ? p.pc - 1
      : -1
  return (
    <ol className="program-listing">
      {p.program.map((line, i) => {
        const cls = [
          i === waitsOn ? 'waiting' : i === p.pc && alive && waitsOn < 0 ? 'current' : '',
          highlight && i >= highlight.from && i <= highlight.to ? highlight.className : ''
        ]
          .join(' ')
          .trim()
        return (
          <li key={i} className={cls || undefined}>
            <span className="lineno">{i}</span>
            <span className="label">{line.label ? `${line.label}:` : ''}</span>
            <span className="code">{line.text}</span>
          </li>
        )
      })}
    </ol>
  )
}
