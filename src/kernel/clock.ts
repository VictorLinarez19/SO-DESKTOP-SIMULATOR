/** Reloj lógico del sistema: cuenta ticks; el tiempo real lo marca quien lo conduce. */
export class Clock {
  private ticks = 0

  get now(): number {
    return this.ticks
  }

  advance(): number {
    return ++this.ticks
  }
}
