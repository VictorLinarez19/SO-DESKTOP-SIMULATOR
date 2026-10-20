import type { ProcessInfo } from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'

/** Proceso vivo (o el último que existió) de un programa del sistema. */
export function processOf(
  snapshot: KernelSnapshot | null,
  programId: string
): ProcessInfo | undefined {
  const all = snapshot?.processes.filter((p) => p.programId === programId) ?? []
  return all.find((p) => p.state !== 'TERMINATED') ?? all.at(-1)
}

export function isSuspended(p: ProcessInfo): boolean {
  return p.state === 'READY_SUSPENDED' || p.state === 'BLOCKED_SUSPENDED'
}
