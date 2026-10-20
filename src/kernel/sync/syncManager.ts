import type { BufferItem, SyncInfo } from '../../shared/kernelTypes'
import type { Instr } from '../process/program'

/** Declaración de los objetos de sincronización y memoria compartida del sistema. */
export interface SyncConfig {
  groups: {
    id: string
    name: string
    semaphores?: { name: string; initial: number }[]
    mutexes?: string[]
    buffers?: { name: string; capacity: number }[]
    variables?: { name: string; initial: number }[]
    /** Para reinicializar semáforos contadores al reactivar: [vacíos, llenos, búfer]. */
    counting?: { empty: string; full: string; buffer: string }
  }[]
}

export const DEFAULT_SYNC: SyncConfig = {
  groups: [
    {
      id: 'pc',
      name: 'Productor–consumidor',
      semaphores: [
        { name: 'vacios', initial: 5 },
        { name: 'llenos', initial: 0 }
      ],
      mutexes: ['m_buffer'],
      buffers: [{ name: 'buffer', capacity: 5 }],
      counting: { empty: 'vacios', full: 'llenos', buffer: 'buffer' }
    },
    {
      id: 'cs',
      name: 'Sección crítica',
      mutexes: ['m_red'],
      variables: [{ name: 'red_bytes', initial: 0 }]
    }
  ]
}

interface Semaphore {
  name: string
  value: number
  initial: number
  queue: number[]
  group: string
}

interface Mutex {
  name: string
  owner: number | null
  queue: number[]
  group: string
}

interface Buffer {
  name: string
  capacity: number
  items: BufferItem[]
  produced: number
  consumed: number
  overflows: number
  underflows: number
  seq: number
  group: string
}

interface Variable {
  name: string
  value: number
  expected: number
  group: string
}

export type AcquireResult = 'acquired' | 'blocked' | 'ignored'
export type LockResult = AcquireResult | 'already-owner'
export type ReleaseResult = { woke: number | null } | 'ignored' | 'not-owner'

/**
 * Semáforos contadores (con cola FIFO de procesos bloqueados), mutex con dueño,
 * búferes acotados y variables compartidas. No cambia estados de procesos:
 * devuelve a quién bloquear o despertar y el kernel hace las transiciones.
 */
export class SyncManager {
  private readonly sems = new Map<string, Semaphore>()
  private readonly mutexes = new Map<string, Mutex>()
  private readonly buffers = new Map<string, Buffer>()
  private readonly vars = new Map<string, Variable>()
  private readonly enabled = new Map<string, boolean>()

  constructor(private readonly cfg: SyncConfig) {
    for (const g of cfg.groups) {
      this.enabled.set(g.id, true)
      for (const s of g.semaphores ?? []) {
        this.sems.set(s.name, {
          name: s.name,
          value: s.initial,
          initial: s.initial,
          queue: [],
          group: g.id
        })
      }
      for (const m of g.mutexes ?? [])
        this.mutexes.set(m, { name: m, owner: null, queue: [], group: g.id })
      for (const b of g.buffers ?? []) {
        this.buffers.set(b.name, {
          name: b.name,
          capacity: b.capacity,
          items: [],
          produced: 0,
          consumed: 0,
          overflows: 0,
          underflows: 0,
          seq: 0,
          group: g.id
        })
      }
      for (const v of g.variables ?? []) {
        this.vars.set(v.name, { name: v.name, value: v.initial, expected: v.initial, group: g.id })
      }
    }
  }

  /** Comprueba que el programa solo use objetos declarados. */
  validate(code: Instr[]): string | null {
    for (const i of code) {
      const known =
        i.op === 'WAIT' || i.op === 'SIGNAL'
          ? this.sems.has(i.name)
          : i.op === 'LOCK' || i.op === 'UNLOCK'
            ? this.mutexes.has(i.name)
            : i.op === 'PUT' || i.op === 'GET'
              ? this.buffers.has(i.name)
              : i.op === 'LOAD' || i.op === 'STORE'
                ? this.vars.has(i.name)
                : true
      if (!known) return `${i.op} usa «${(i as { name: string }).name}», que no está declarado`
    }
    return null
  }

  isEnabled(name: string): boolean {
    const obj = this.sems.get(name) ?? this.mutexes.get(name)
    return obj ? this.enabled.get(obj.group)! : true
  }

  // ── semáforos ──

  wait(name: string, pid: number): AcquireResult {
    const s = this.sems.get(name)!
    if (!this.isEnabled(name)) return 'ignored'
    if (s.value > 0) {
      s.value--
      return 'acquired'
    }
    s.queue.push(pid)
    return 'blocked'
  }

  /** V: si hay procesos esperando se le entrega al primero (el valor no cambia); si no, value++. */
  signal(name: string): ReleaseResult {
    const s = this.sems.get(name)!
    if (!this.isEnabled(name)) return 'ignored'
    const woke = s.queue.shift() ?? null
    if (woke === null) s.value++
    return { woke }
  }

  semValue(name: string): number {
    return this.sems.get(name)!.value
  }

  // ── mutex ──

  lock(name: string, pid: number): LockResult {
    const m = this.mutexes.get(name)!
    if (!this.isEnabled(name)) return 'ignored'
    if (m.owner === null) {
      m.owner = pid
      return 'acquired'
    }
    if (m.owner === pid) return 'already-owner'
    m.queue.push(pid)
    return 'blocked'
  }

  /** El mutex pasa directamente al primero de la cola (si lo hay). */
  unlock(name: string, pid: number): ReleaseResult {
    const m = this.mutexes.get(name)!
    if (!this.isEnabled(name)) return 'ignored'
    if (m.owner === null) return { woke: null } // liberar un mutex libre no tiene efecto
    if (m.owner !== pid) return 'not-owner'
    const woke = m.queue.shift() ?? null
    m.owner = woke
    return { woke }
  }

  ownerOf(name: string): number | null {
    return this.mutexes.get(name)!.owner
  }

  heldBy(pid: number): string[] {
    return [...this.mutexes.values()].filter((m) => m.owner === pid).map((m) => m.name)
  }

  // ── memoria compartida ──

  load(name: string): number {
    return this.vars.get(name)!.value
  }

  store(name: string, value: number): void {
    this.vars.get(name)!.value = value
  }

  /** Registra la intención de sumar: lo que valdría la variable sin actualizaciones perdidas. */
  addExpected(name: string, delta: number): void {
    const v = this.vars.get(name)
    if (v) v.expected += delta
  }

  put(
    name: string,
    producer: number,
    tick: number
  ): { ok: true; item: BufferItem } | { ok: false } {
    const b = this.buffers.get(name)!
    const item = { seq: ++b.seq, producer, tick }
    b.produced++
    if (b.items.length >= b.capacity) {
      b.overflows++
      return { ok: false }
    }
    b.items.push(item)
    return { ok: true, item }
  }

  get(name: string): BufferItem | null {
    const b = this.buffers.get(name)!
    const item = b.items.shift() ?? null
    if (item) b.consumed++
    else b.underflows++
    return item
  }

  // ── control ──

  /**
   * Retira a un proceso que termina: sale de todas las colas y suelta sus mutex
   * (cada uno pasa al siguiente en espera). Devuelve a quién despertar.
   */
  removeProcess(pid: number): { released: string[]; woke: { name: string; pid: number }[] } {
    for (const s of this.sems.values()) s.queue = s.queue.filter((p) => p !== pid)
    const released: string[] = []
    const woke: { name: string; pid: number }[] = []
    for (const m of this.mutexes.values()) {
      m.queue = m.queue.filter((p) => p !== pid)
      if (m.owner === pid) {
        released.push(m.name)
        m.owner = m.queue.shift() ?? null
        if (m.owner !== null) woke.push({ name: m.name, pid: m.owner })
      }
    }
    return { released, woke }
  }

  /**
   * Activa o desactiva la sincronización de un grupo. Al desactivarla se despierta a
   * todos los que esperaban; al reactivarla se reinicializan mutex y semáforos
   * contadores según el contenido real del búfer.
   */
  setGroupEnabled(id: string, enabled: boolean): number[] {
    const group = this.cfg.groups.find((g) => g.id === id)
    if (!group || this.enabled.get(id) === enabled) return []
    this.enabled.set(id, enabled)
    const woke: number[] = []
    for (const s of this.sems.values()) {
      if (s.group !== id) continue
      woke.push(...s.queue)
      s.queue = []
    }
    for (const m of this.mutexes.values()) {
      if (m.group !== id) continue
      woke.push(...m.queue)
      m.queue = []
      m.owner = null
    }
    if (enabled && group.counting) {
      const b = this.buffers.get(group.counting.buffer)!
      this.sems.get(group.counting.full)!.value = b.items.length
      this.sems.get(group.counting.empty)!.value = b.capacity - b.items.length
    }
    return woke
  }

  groupName(id: string): string {
    return this.cfg.groups.find((g) => g.id === id)?.name ?? id
  }

  info(): SyncInfo {
    return {
      groups: this.cfg.groups.map((g) => ({
        id: g.id,
        name: g.name,
        enabled: this.enabled.get(g.id)!
      })),
      semaphores: [...this.sems.values()].map((s) => ({ ...s, queue: [...s.queue] })),
      mutexes: [...this.mutexes.values()].map((m) => ({ ...m, queue: [...m.queue] })),
      buffers: [...this.buffers.values()].map((b) => ({
        name: b.name,
        capacity: b.capacity,
        items: [...b.items],
        produced: b.produced,
        consumed: b.consumed,
        overflows: b.overflows,
        underflows: b.underflows,
        group: b.group
      })),
      variables: [...this.vars.values()].map((v) => ({ ...v }))
    }
  }
}
