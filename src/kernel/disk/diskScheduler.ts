import type { DiskPolicy, IoTag } from '../../shared/kernelTypes'

/** Cilindros del disco simulado (0–199, como en los ejemplos de Silberschatz). */
export const CYLINDERS = 200
/** Velocidad del brazo: cilindros que recorre por tick. */
export const SEEK_CYL_PER_TICK = 40
/** Velocidad de transferencia una vez situado el brazo. */
export const DISK_KB_PER_TICK = 64

export interface DiskRequest {
  id: number
  pid: number
  tag: IoTag
  cylinder: number
  /** Ticks de transferencia de datos (además del tiempo de búsqueda). */
  transferTicks: number
  /** E/S genérica (`IO disco n`): dura exactamente n ticks, incluida la búsqueda. */
  fixedTicks?: number
  kb: number
  label: string
  since: number
}

export interface ArmMove {
  tick: number
  pid: number
  label: string
  from: number
  /** Puntos por los que pasa el brazo (incluye extremos en SCAN/C-SCAN) y el destino al final. */
  path: number[]
  distance: number
}

export interface Pick {
  index: number
  path: number[]
  dir: 1 | -1
}

/**
 * Elige la siguiente solicitud según el algoritmo y devuelve el recorrido del brazo.
 * `dir` es el sentido actual (+1 hacia los cilindros altos).
 */
export function pickNext(
  policy: DiskPolicy,
  head: number,
  dir: 1 | -1,
  queue: { cylinder: number }[],
  maxCyl = CYLINDERS - 1
): Pick {
  const nearestIn = (d: 1 | -1): number => {
    let best = -1
    queue.forEach((r, i) => {
      const ok = d === 1 ? r.cylinder >= head : r.cylinder <= head
      if (ok && (best < 0 || Math.abs(r.cylinder - head) < Math.abs(queue[best].cylinder - head)))
        best = i
    })
    return best
  }
  const extreme = (lowest: boolean): number =>
    queue.reduce(
      (b, r, i) =>
        b < 0 || (lowest ? r.cylinder < queue[b].cylinder : r.cylinder > queue[b].cylinder) ? i : b,
      -1
    )

  switch (policy) {
    case 'FCFS':
      return { index: 0, path: [queue[0].cylinder], dir: queue[0].cylinder >= head ? 1 : -1 }
    case 'SSTF': {
      const i = queue.reduce(
        (b, r, j) => (Math.abs(r.cylinder - head) < Math.abs(queue[b].cylinder - head) ? j : b),
        0
      )
      return { index: i, path: [queue[i].cylinder], dir: queue[i].cylinder >= head ? 1 : -1 }
    }
    case 'LOOK':
    case 'SCAN': {
      let i = nearestIn(dir)
      if (i >= 0) return { index: i, path: [queue[i].cylinder], dir }
      // No hay más en este sentido: SCAN llega hasta el extremo; LOOK se da vuelta ahí mismo.
      const back = -dir as 1 | -1
      i = nearestIn(back)
      const end = dir === 1 ? maxCyl : 0
      const path =
        policy === 'SCAN' && head !== end ? [end, queue[i].cylinder] : [queue[i].cylinder]
      return { index: i, path, dir: back }
    }
    case 'CLOOK':
    case 'CSCAN': {
      let i = nearestIn(1)
      if (i >= 0) return { index: i, path: [queue[i].cylinder], dir: 1 }
      // Solo se atiende de subida: se vuelve al principio y se sigue subiendo.
      i = extreme(true)
      const path = policy === 'CSCAN' ? [maxCyl, 0, queue[i].cylinder] : [queue[i].cylinder]
      return { index: i, path, dir: 1 }
    }
  }
}

export function pathLength(from: number, path: number[]): number {
  let d = 0
  let at = from
  for (const p of path) {
    d += Math.abs(p - at)
    at = p
  }
  return d
}

/** Atiende de una vez una cola fija (para comparar algoritmos como en los libros). */
export function simulateQueue(
  policy: DiskPolicy,
  head: number,
  dir: 1 | -1,
  cylinders: number[]
): { order: number[]; total: number } {
  const queue = cylinders.map((cylinder) => ({ cylinder }))
  const order: number[] = []
  let total = 0
  while (queue.length > 0) {
    const pick = pickNext(policy, head, dir, queue)
    total += pathLength(head, pick.path)
    head = queue[pick.index].cylinder
    dir = pick.dir
    order.push(head)
    queue.splice(pick.index, 1)
  }
  return { order, total }
}

interface Current {
  req: DiskRequest
  from: number
  path: number[]
  distance: number
  seekTicks: number
  elapsed: number
  remaining: number
}

/** Brazo del disco con su cola de solicitudes. */
export class DiskArm {
  head = 0
  dir: 1 | -1 = 1
  queue: DiskRequest[] = []
  current: Current | null = null
  history: ArmMove[] = []
  stats = { totalMovement: 0, served: 0, totalWait: 0, maxWait: 0, busyTicks: 0 }
  private nextId = 1

  constructor(public policy: DiskPolicy) {}

  enqueue(req: Omit<DiskRequest, 'id'>): void {
    this.queue.push({ ...req, id: this.nextId++ })
  }

  /** Trabajo de un tick: devuelve las solicitudes completadas. */
  tick(now: number): DiskRequest[] {
    if (!this.current) this.start(now)
    if (!this.current) return []
    const c = this.current
    this.stats.busyTicks++
    c.elapsed++
    c.remaining--
    if (c.remaining > 0) return []
    this.head = c.req.cylinder
    this.current = null
    // El controlador toma enseguida la siguiente solicitud (se atiende desde el tick siguiente).
    this.start(now)
    return [c.req]
  }

  /** Posición del brazo, interpolada a lo largo del recorrido durante la búsqueda. */
  headPosition(): number {
    const c = this.current
    if (!c || c.distance === 0) return this.head
    const travelled = Math.min(c.distance, (c.elapsed / Math.max(1, c.seekTicks)) * c.distance)
    let at = c.from
    let left = travelled
    for (const p of c.path) {
      const seg = Math.abs(p - at)
      if (left <= seg) return at + Math.sign(p - at) * left
      left -= seg
      at = p
    }
    return at
  }

  cancel(pid: number): void {
    this.queue = this.queue.filter((r) => r.pid !== pid)
    if (this.current?.req.pid === pid) {
      this.head = Math.round(this.headPosition())
      this.current = null
    }
  }

  private start(now: number): void {
    if (this.current || this.queue.length === 0) return
    const pick = pickNext(this.policy, this.head, this.dir, this.queue)
    const req = this.queue.splice(pick.index, 1)[0]
    const distance = pathLength(this.head, pick.path)
    const seekTicks = Math.ceil(distance / SEEK_CYL_PER_TICK)
    const service = req.fixedTicks ?? Math.max(1, seekTicks + req.transferTicks)
    const wait = now - req.since
    this.stats.totalMovement += distance
    this.stats.served++
    this.stats.totalWait += wait
    this.stats.maxWait = Math.max(this.stats.maxWait, wait)
    this.history.push({
      tick: now,
      pid: req.pid,
      label: req.label,
      from: this.head,
      path: pick.path,
      distance
    })
    if (this.history.length > 40) this.history.shift()
    this.dir = pick.dir
    this.current = {
      req,
      from: this.head,
      path: pick.path,
      distance,
      seekTicks: Math.min(seekTicks, service),
      elapsed: 0,
      remaining: service
    }
  }
}
