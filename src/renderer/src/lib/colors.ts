import type { ProcState } from '@shared/kernelTypes'

/** Paleta de 15 colores bien diferenciados, uno por proceso. */
const PID_PALETTE = [
  '#ff6b6b',
  '#ffa94d',
  '#ffd43b',
  '#a9e34b',
  '#51cf66',
  '#38d9a9',
  '#3bc9db',
  '#4dabf7',
  '#748ffc',
  '#9775fa',
  '#da77f2',
  '#f783ac',
  '#ff8787',
  '#20c997',
  '#5c7cfa'
]

export function pidColor(pid: number): string {
  return PID_PALETTE[(pid - 1) % PID_PALETTE.length]
}

export const STATE_COLOR: Record<ProcState, string> = {
  NEW: '#64d2ff',
  READY: '#ffd60a',
  RUNNING: '#30d158',
  BLOCKED: '#ff453a',
  READY_SUSPENDED: '#bf5af2',
  BLOCKED_SUSPENDED: '#bf5af2',
  TERMINATED: '#8e8e93'
}
