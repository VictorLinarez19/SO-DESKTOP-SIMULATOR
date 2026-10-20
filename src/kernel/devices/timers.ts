/** Temporizador del sistema: despierta a los procesos que hicieron SLEEP. */
export class TimerQueue {
  private timers: { pid: number; until: number }[] = []

  add(pid: number, until: number): void {
    this.timers.push({ pid, until })
  }

  /** Devuelve los PIDs cuyo plazo venció en `now`. */
  expire(now: number): number[] {
    const due = this.timers.filter((t) => t.until <= now)
    this.timers = this.timers.filter((t) => t.until > now)
    return due.map((t) => t.pid)
  }

  cancel(pid: number): void {
    this.timers = this.timers.filter((t) => t.pid !== pid)
  }

  has(pid: number): boolean {
    return this.timers.some((t) => t.pid === pid)
  }
}
