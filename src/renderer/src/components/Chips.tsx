import { STATE_LABEL, type ProcState } from '@shared/kernelTypes'
import { pidColor, STATE_COLOR } from '../lib/colors'

export function StateChip({ state }: { state: ProcState }): React.JSX.Element {
  return (
    <span className="state-chip" style={{ '--c': STATE_COLOR[state] } as React.CSSProperties}>
      {STATE_LABEL[state]}
    </span>
  )
}

export function PidDot({ pid }: { pid: number }): React.JSX.Element {
  return <span className="pid-dot" style={{ background: pidColor(pid) }} />
}

export function PidBadge({
  pid,
  onClick
}: {
  pid: number
  onClick?: () => void
}): React.JSX.Element {
  return (
    <span
      className={`pid-badge${onClick ? ' clickable' : ''}`}
      style={{ background: pidColor(pid) }}
      onClick={onClick}
    >
      {pid}
    </span>
  )
}
