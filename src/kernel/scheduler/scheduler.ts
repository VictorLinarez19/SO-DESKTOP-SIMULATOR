import type { SchedulerPolicy } from '../../shared/kernelTypes'
import type { PCB } from '../process/pcb'

/**
 * Planificador de corto plazo. Guarda la cola de listos en orden de llegada (FIFO)
 * y aplica la política para decidir a quién despachar.
 */
export class Scheduler {
  private queue: number[] = []

  constructor(
    public policy: SchedulerPolicy,
    private readonly lookup: (pid: number) => PCB
  ) {}

  enqueue(pid: number): void {
    if (!this.queue.includes(pid)) this.queue.push(pid)
  }

  remove(pid: number): void {
    this.queue = this.queue.filter((p) => p !== pid)
  }

  get size(): number {
    return this.queue.length
  }

  /** PIDs en el orden en que serían elegidos. */
  order(): number[] {
    if (this.policy !== 'PRIORITY_RR') return [...this.queue]
    // Orden estable: a igual prioridad se respeta el orden de llegada → Round Robin.
    return this.queue
      .map((pid, i) => ({ pid, i, prio: this.lookup(pid).priority }))
      .sort((a, b) => a.prio - b.prio || a.i - b.i)
      .map((e) => e.pid)
  }

  /** Saca de la cola al siguiente proceso a ejecutar. */
  pickNext(): number | undefined {
    const next = this.order()[0]
    if (next !== undefined) this.remove(next)
    return next
  }

  quantumFor(pcb: PCB): number {
    return this.policy === 'FCFS' ? Infinity : pcb.quantum
  }

  /** Proceso listo que debe expropiar al que está en ejecución, si existe. */
  preemptorOf(running: PCB): PCB | undefined {
    if (this.policy !== 'PRIORITY_RR') return undefined
    const best = this.order()[0]
    if (best === undefined) return undefined
    const pcb = this.lookup(best)
    return pcb.priority < running.priority ? pcb : undefined
  }
}
