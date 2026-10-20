import type { KernelEvent } from '../shared/kernelTypes'

/** Bitácora del kernel (búfer circular). */
export class EventLog {
  private events: KernelEvent[] = []
  private nextId = 1

  constructor(private readonly capacity = 5000) {}

  push(e: Omit<KernelEvent, 'id'>): KernelEvent {
    const event = { id: this.nextId++, ...e }
    this.events.push(event)
    if (this.events.length > this.capacity)
      this.events.splice(0, this.events.length - this.capacity)
    return event
  }

  tail(n: number): KernelEvent[] {
    return this.events.slice(-n)
  }

  all(): readonly KernelEvent[] {
    return this.events
  }
}
