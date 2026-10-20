import type { FitPolicy } from '../../shared/kernelTypes'

/** Partición asignada a un proceso (direcciones y tamaños en KB). */
export interface Partition {
  pid: number
  /** Registro base: dirección donde empieza la partición. */
  base: number
  /** Tamaño asignado (múltiplo de la unidad de asignación). */
  size: number
  /** Tamaño que pidió el proceso; la diferencia es fragmentación interna. */
  requested: number
}

export interface Hole {
  base: number
  size: number
}

export interface Relocation {
  pid: number
  from: number
  to: number
  size: number
}

export interface MemoryStats {
  usedKb: number
  freeKb: number
  largestHoleKb: number
  holeCount: number
  /** 1 − hueco mayor / memoria libre: 0 = toda la memoria libre es contigua. */
  externalFragmentation: number
  internalFragmentationKb: number
}

export interface MemoryConfig {
  totalKb: number
  /** Memoria reservada para el sistema operativo, en las direcciones bajas. */
  osKb: number
  /** Unidad de asignación: los tamaños se redondean hacia arriba a múltiplos de ella. */
  unitKb: number
  policy: FitPolicy
}

/**
 * Administrador de memoria con particiones dinámicas (de tamaño variable).
 * Lleva la lista de particiones ordenada por dirección; los huecos se derivan de ella.
 */
export class MemoryManager {
  readonly totalKb: number
  readonly osKb: number
  readonly unitKb: number
  policy: FitPolicy
  private parts: Partition[] = []
  /** Para el siguiente ajuste: dónde terminó la última asignación. */
  private cursor: number

  constructor(cfg: MemoryConfig) {
    if (cfg.osKb >= cfg.totalKb) throw new Error('La memoria del SO no puede ocupar toda la RAM')
    this.totalKb = cfg.totalKb
    this.osKb = cfg.osKb
    this.unitKb = cfg.unitKb
    this.policy = cfg.policy
    this.cursor = cfg.osKb
  }

  get userKb(): number {
    return this.totalKb - this.osKb
  }

  roundUp(kb: number): number {
    return Math.ceil(kb / this.unitKb) * this.unitKb
  }

  partitions(): readonly Partition[] {
    return this.parts
  }

  partitionOf(pid: number): Partition | undefined {
    return this.parts.find((p) => p.pid === pid)
  }

  holes(): Hole[] {
    const holes: Hole[] = []
    let addr = this.osKb
    for (const p of this.parts) {
      if (p.base > addr) holes.push({ base: addr, size: p.base - addr })
      addr = p.base + p.size
    }
    if (addr < this.totalKb) holes.push({ base: addr, size: this.totalKb - addr })
    return holes
  }

  /** Elige un hueco según la política. Devuelve null si ningún hueco basta. */
  findHole(size: number): Hole | null {
    const fitting = this.holes().filter((h) => h.size >= size)
    if (fitting.length === 0) return null
    switch (this.policy) {
      case 'FIRST':
        return fitting[0]
      case 'BEST':
        return fitting.reduce((a, b) => (b.size < a.size ? b : a))
      case 'WORST':
        return fitting.reduce((a, b) => (b.size > a.size ? b : a))
      case 'NEXT': {
        // Primer hueco a partir del cursor, dando la vuelta al final de la memoria.
        const after = fitting.find((h) => h.base + h.size > this.cursor)
        return after ?? fitting[0]
      }
    }
  }

  allocate(pid: number, requestedKb: number): Partition | null {
    if (this.partitionOf(pid)) throw new Error(`PID ${pid} ya tiene memoria asignada`)
    const size = this.roundUp(requestedKb)
    const hole = this.findHole(size)
    if (!hole) return null
    // En el siguiente ajuste, si el cursor cae dentro del hueco elegido se asigna desde ahí.
    const base =
      this.policy === 'NEXT' &&
      this.cursor > hole.base &&
      this.cursor + size <= hole.base + hole.size
        ? this.cursor
        : hole.base
    const part: Partition = { pid, base, size, requested: requestedKb }
    this.parts.push(part)
    this.parts.sort((a, b) => a.base - b.base)
    this.cursor = base + size
    return part
  }

  free(pid: number): Partition | undefined {
    const part = this.partitionOf(pid)
    if (part) this.parts = this.parts.filter((p) => p !== part)
    return part
  }

  /** ¿Cabe un proceso de este tamaño si se compacta la memoria? */
  fitsAfterCompaction(requestedKb: number): boolean {
    return this.stats().freeKb >= this.roundUp(requestedKb)
  }

  /**
   * Compactación: desplaza todas las particiones hacia las direcciones bajas,
   * conservando su orden, para que la memoria libre quede en un único hueco.
   * Devuelve las reubicaciones (el kernel actualiza los registros base).
   */
  compact(): Relocation[] {
    const moves: Relocation[] = []
    let addr = this.osKb
    for (const p of this.parts) {
      if (p.base !== addr) {
        moves.push({ pid: p.pid, from: p.base, to: addr, size: p.size })
        p.base = addr
      }
      addr += p.size
    }
    this.cursor = addr
    return moves
  }

  stats(): MemoryStats {
    const holes = this.holes()
    const usedKb = this.parts.reduce((n, p) => n + p.size, 0)
    const freeKb = this.userKb - usedKb
    const largestHoleKb = holes.reduce((m, h) => Math.max(m, h.size), 0)
    return {
      usedKb,
      freeKb,
      largestHoleKb,
      holeCount: holes.length,
      externalFragmentation: freeKb === 0 ? 0 : 1 - largestHoleKb / freeKb,
      internalFragmentationKb: this.parts.reduce((n, p) => n + p.size - p.requested, 0)
    }
  }
}
