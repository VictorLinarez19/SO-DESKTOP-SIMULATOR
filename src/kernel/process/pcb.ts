import type { MemWaitReason, ProcState, SuspendCause, WaitReason } from '../../shared/kernelTypes'
import { listing, parseProgram, ProgramError, type Instr } from './program'
import type { ProgramSpec } from './programs'

/** Bloque de control de proceso (PCB). */
export interface PCB {
  pid: number
  name: string
  programId: string
  code: Instr[]
  listing: { text: string; label?: string }[]
  state: ProcState

  /** Prioridad efectiva (la que usa el planificador). */
  priority: number
  /** Prioridad asignada; el envejecimiento (aging) modifica solo la efectiva. */
  basePriority: number
  quantum: number
  quantumUsed: number

  /** Contador de programa: índice de la instrucción actual. */
  pc: number
  /** Ticks que le quedan a la ráfaga de CPU en curso (null si no ha empezado). */
  burstRemaining: number | null
  /** Iteraciones realizadas por cada LOOP con repeticiones (clave = índice). */
  loopCounters: Map<number, number>

  memoryKb: number

  arrival: number
  admittedAt: number | null
  firstRun: number | null
  finishedAt: number | null

  cpuTime: number
  waitTime: number
  blockedTime: number
  readyStreak: number
  maxReadyStreak: number
  ioCount: number
  contextSwitches: number

  waitingOn: WaitReason | null
  exitReason: string | null

  /** Fuera de memoria por decisión del usuario o del planificador de mediano plazo. */
  suspendedBy: SuspendCause | null
  /** Tick en que su imagen se cargó en memoria por última vez. */
  loadedAt: number | null
  /** Motivo (ya registrado en la bitácora) por el que espera memoria. */
  memWait: MemWaitReason | null
  /** Tick desde el que espera memoria (para el envejecimiento del intercambio). */
  memWaitSince: number | null
  overlay: OverlayState | null

  /** Registro de propósito general para LOAD/ADDI/STORE. */
  reg: number | null
  /** Variable compartida de la que se cargó el registro y el valor que tenía al leerla. */
  regVar: string | null
  regLoaded: number | null
  /** Veces que ha sido víctima de un retroceso por interbloqueo. */
  rollbacks: number
  /** Siguiente archivo que analizará FSCAN. */
  scanIndex: number
  /** Último archivo que leyó (lo que copia a la USB o manda a imprimir). */
  lastRead: string | null
}

export interface OverlayState {
  rootKb: number
  modules: Record<string, number>
  loaded: string | null
  pending: string | null
}

export function createPcb(pid: number, spec: ProgramSpec, now: number): PCB {
  const code = parseProgram(spec.source)
  validateOverlays(spec, code)
  return {
    pid,
    name: spec.name,
    programId: spec.id,
    code,
    listing: listing(code),
    state: 'NEW',
    priority: spec.priority,
    basePriority: spec.priority,
    quantum: spec.quantum,
    quantumUsed: 0,
    pc: 0,
    burstRemaining: null,
    loopCounters: new Map(),
    memoryKb: spec.memoryKb,
    arrival: now,
    admittedAt: null,
    firstRun: null,
    finishedAt: null,
    cpuTime: 0,
    waitTime: 0,
    blockedTime: 0,
    readyStreak: 0,
    maxReadyStreak: 0,
    ioCount: 0,
    contextSwitches: 0,
    waitingOn: null,
    exitReason: null,
    suspendedBy: null,
    loadedAt: null,
    memWait: null,
    memWaitSince: null,
    reg: null,
    regVar: null,
    regLoaded: null,
    rollbacks: 0,
    scanIndex: 0,
    lastRead: null,
    overlay: spec.overlays ? { ...spec.overlays, loaded: null, pending: null } : null
  }
}

function validateOverlays(spec: ProgramSpec, code: Instr[]): void {
  const modules = spec.overlays?.modules ?? {}
  for (const i of code) {
    if (i.op === 'OVERLAY' && !(i.module in modules)) {
      throw new ProgramError(
        `${spec.id}: el módulo de recubrimiento «${i.module}» no está declarado`
      )
    }
  }
  if (spec.overlays) {
    const need = spec.overlays.rootKb + Math.max(...Object.values(modules))
    if (spec.memoryKb < need) {
      throw new ProgramError(
        `${spec.id}: necesita ${need} KB (raíz + módulo mayor) y declara ${spec.memoryKb}`
      )
    }
  }
}
