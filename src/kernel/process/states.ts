import type { ProcState } from '../../shared/kernelTypes'

/**
 * Transiciones válidas del modelo de 7 estados.
 * Cualquier estado vivo puede pasar a Terminado (fin normal o el sistema lo aborta).
 */
export const TRANSITIONS: Record<ProcState, readonly ProcState[]> = {
  NEW: ['READY', 'READY_SUSPENDED', 'TERMINATED'],
  READY: ['RUNNING', 'READY_SUSPENDED', 'TERMINATED'],
  RUNNING: ['READY', 'BLOCKED', 'READY_SUSPENDED', 'TERMINATED'],
  BLOCKED: ['READY', 'BLOCKED_SUSPENDED', 'TERMINATED'],
  BLOCKED_SUSPENDED: ['READY_SUSPENDED', 'BLOCKED', 'TERMINATED'],
  READY_SUSPENDED: ['READY', 'TERMINATED'],
  TERMINATED: []
}

export function canTransition(from: ProcState, to: ProcState): boolean {
  return TRANSITIONS[from].includes(to)
}

export class IllegalTransitionError extends Error {
  constructor(pid: number, from: ProcState, to: ProcState) {
    super(`Transición ilegal para PID ${pid}: ${from} → ${to}`)
  }
}
