import { Kernel, type KernelOptions } from '@kernel/kernel'
import type { ProgramSpec } from '@kernel/process/programs'
import type { GanttSlot } from '@shared/kernelTypes'

export function prog(id: string, source: string, extra: Partial<ProgramSpec> = {}): ProgramSpec {
  return { id, name: id, priority: 5, quantum: 2, memoryKb: 16, arrival: 0, source, ...extra }
}

export function kernelWith(programs: ProgramSpec[], opts: KernelOptions = {}): Kernel {
  return new Kernel({ contextSwitchTicks: 0, diskPolicy: 'FCFS', ...opts, programs })
}

export function run(k: Kernel, ticks: number): void {
  for (let i = 0; i < ticks; i++) k.tick()
}

/** Gantt compacto: PID por tick, '-' = ocio, '*' = cambio de contexto. */
export function ganttString(slots: readonly GanttSlot[]): string {
  return slots
    .map((s) => (s.kind === 'idle' ? '-' : s.kind === 'cs' ? '*' : String(s.pid)))
    .join('')
}
