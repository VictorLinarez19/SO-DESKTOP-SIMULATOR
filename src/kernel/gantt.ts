import type { GanttSlot } from '../shared/kernelTypes'

/** Historial de uso de la CPU tick a tick (búfer circular). */
export class GanttChart {
  private slots: GanttSlot[] = []

  constructor(private readonly capacity = 2000) {}

  record(slot: GanttSlot): void {
    this.slots.push(slot)
    if (this.slots.length > this.capacity) this.slots.splice(0, this.slots.length - this.capacity)
  }

  tail(n: number): GanttSlot[] {
    return this.slots.slice(-n)
  }

  all(): readonly GanttSlot[] {
    return this.slots
  }
}
