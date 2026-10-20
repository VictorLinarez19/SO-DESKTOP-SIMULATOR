import type { DeadlockPolicy } from '../../shared/kernelTypes'
import type { Instr } from '../process/program'
import { safetyCheck, type Vec } from './deadlock'

export interface ResourceDef {
  id: string
  name: string
  instances: number
}

/** Recursos reutilizables de uso exclusivo que los procesos piden con REQ y devuelven con REL. */
export const DEFAULT_RESOURCES: ResourceDef[] = [
  { id: 'impresora', name: 'Impresora', instances: 1 },
  { id: 'usb', name: 'Unidad USB', instances: 1 },
  { id: 'camara', name: 'Cámara', instances: 1 },
  { id: 'audio', name: 'Bocinas', instances: 1 }
]

export interface PendingRequest {
  pid: number
  want: Vec
  since: number
  /** El banquero la retuvo aunque había instancias: concederla dejaría un estado inseguro. */
  unsafe: boolean
}

export type Verdict = 'grant' | 'unavailable' | 'unsafe' | 'exceeds-claim'

/** Necesidad máxima de un programa: la mayor cantidad que llega a retener de cada recurso. */
export function claimFromCode(code: Instr[]): Vec {
  const held: Vec = {}
  const max: Vec = {}
  for (const i of code) {
    if (i.op === 'REQ') {
      held[i.resource] = (held[i.resource] ?? 0) + i.count
      max[i.resource] = Math.max(max[i.resource] ?? 0, held[i.resource])
    } else if (i.op === 'REL') {
      held[i.resource] = Math.max(0, (held[i.resource] ?? 0) - i.count)
    }
  }
  return max
}

export class ResourceManager {
  readonly ids: string[]
  private readonly total: Vec
  private readonly available: Vec
  private readonly alloc = new Map<number, Vec>()
  private readonly claims = new Map<number, Vec>()
  pending: PendingRequest[] = []

  constructor(readonly defs: ResourceDef[]) {
    this.ids = defs.map((d) => d.id)
    this.total = Object.fromEntries(defs.map((d) => [d.id, d.instances]))
    this.available = { ...this.total }
  }

  has(id: string): boolean {
    return id in this.total
  }

  name(id: string): string {
    return this.defs.find((d) => d.id === id)?.name ?? id
  }

  declareClaim(pid: number, claim: Vec): void {
    if (Object.keys(claim).length > 0) this.claims.set(pid, claim)
  }

  held(pid: number): Vec {
    return { ...(this.alloc.get(pid) ?? {}) }
  }

  holdsAny(pid: number): boolean {
    return Object.values(this.alloc.get(pid) ?? {}).some((n) => n > 0)
  }

  /** ¿Se puede conceder `want` a `pid` ahora mismo, según la estrategia? */
  evaluate(pid: number, want: Vec, policy: DeadlockPolicy): Verdict {
    if (policy === 'AVOID') {
      const claim = this.claims.get(pid) ?? {}
      const held = this.alloc.get(pid) ?? {}
      if (Object.entries(want).some(([r, n]) => (held[r] ?? 0) + n > (claim[r] ?? 0))) {
        return 'exceeds-claim'
      }
    }
    if (Object.entries(want).some(([r, n]) => this.available[r] < n)) return 'unavailable'
    if (policy === 'AVOID') {
      // Se simula la asignación y se pregunta si el estado resultante sigue siendo seguro.
      this.apply(pid, want, +1)
      const safe = this.safety().safe
      this.apply(pid, want, -1)
      if (!safe) return 'unsafe'
    }
    return 'grant'
  }

  grant(pid: number, want: Vec): void {
    this.apply(pid, want, +1)
  }

  /** Devuelve instancias. Falla si el proceso no las tiene. */
  release(pid: number, resource: string, count: number): boolean {
    if ((this.alloc.get(pid)?.[resource] ?? 0) < count) return false
    this.apply(pid, { [resource]: count }, -1)
    return true
  }

  releaseAll(pid: number): Vec {
    const held = this.held(pid)
    this.apply(pid, held, -1)
    this.alloc.delete(pid)
    return held
  }

  forget(pid: number): void {
    this.releaseAll(pid)
    this.claims.delete(pid)
    this.pending = this.pending.filter((p) => p.pid !== pid)
  }

  /** Banquero: ¿existe una secuencia en la que todos alcancen su máximo y terminen? */
  safety(): { safe: boolean; sequence: number[] } {
    const need = new Map<number, Vec>()
    for (const [pid, claim] of this.claims) {
      const held = this.alloc.get(pid) ?? {}
      need.set(
        pid,
        Object.fromEntries(this.ids.map((r) => [r, Math.max(0, (claim[r] ?? 0) - (held[r] ?? 0))]))
      )
    }
    return safetyCheck(this.ids, this.available, this.alloc, need)
  }

  snapshotState(): {
    total: Vec
    available: Vec
    allocation: Map<number, Vec>
    claims: Map<number, Vec>
  } {
    return {
      total: { ...this.total },
      available: { ...this.available },
      allocation: new Map([...this.alloc].map(([p, v]) => [p, { ...v }])),
      claims: new Map([...this.claims].map(([p, v]) => [p, { ...v }]))
    }
  }

  private apply(pid: number, v: Vec, sign: 1 | -1): void {
    const held = this.alloc.get(pid) ?? {}
    for (const [r, n] of Object.entries(v)) {
      if (n === 0) continue
      this.available[r] -= sign * n
      held[r] = (held[r] ?? 0) + sign * n
      if (held[r] === 0) delete held[r]
    }
    if (Object.keys(held).length > 0) this.alloc.set(pid, held)
    else this.alloc.delete(pid)
  }
}
