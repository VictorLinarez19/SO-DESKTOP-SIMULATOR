import { Clock } from './clock'
import { EventLog } from './log'
import { GanttChart } from './gantt'
import { Scheduler } from './scheduler/scheduler'
import { DeviceManager, type IoCompletion } from './devices/deviceManager'
import { TimerQueue } from './devices/timers'
import { MemoryManager, type MemoryConfig } from './memory/memoryManager'
import { DEFAULT_SYNC, SyncManager, type SyncConfig } from './sync/syncManager'
import {
  claimFromCode,
  DEFAULT_RESOURCES,
  ResourceManager,
  type ResourceDef
} from './resources/resourceManager'
import { detectDeadlock, findCycle, type AllocationState, type Vec } from './resources/deadlock'
import { MemoryBlockDevice, type BlockDevice } from './disk/blockDevice'
import { basename, FsError, GuinanFS } from './disk/fs'
import { seedFileSystem, textContent } from './disk/seed'
import { CYLINDERS, DISK_KB_PER_TICK, DiskArm } from './disk/diskScheduler'
import { createPcb, type PCB } from './process/pcb'
import { formatInstr, isUserOp, ProgramError, type Instr, type UserOp } from './process/program'
import { BOOT_PROGRAMS, type ProgramSpec } from './process/programs'
import { canTransition, IllegalTransitionError } from './process/states'
import {
  DEADLOCK_POLICY_LABEL,
  DEVICE_LABEL,
  DISK_POLICY_LABEL,
  FIT_LABEL,
  POLICY_LABEL,
  PRIORITY_MAX,
  PRIORITY_MIN,
  STATE_LABEL,
  type DeadlockPolicy,
  type DiskInfo,
  type DiskPolicy,
  type FileDetails,
  type HardwareInfo,
  type HwEvent,
  type KernelEffect,
  type FitPolicy,
  type KernelEvent,
  type KernelStats,
  type MemoryBlock,
  type MemoryInfo,
  type ProcessInfo,
  type ProcState,
  type RecoveryMethod,
  type Relocation,
  type ResourcesInfo,
  type SchedulerPolicy,
  type TransitionKey
} from '../shared/kernelTypes'
import type { KernelCommand, KernelQuery, KernelSnapshot } from '../shared/ipc'
import { MAX_TICK_MS, MIN_TICK_MS } from '../shared/ipc'

export interface KernelOptions {
  tickMs?: number
  now?: () => number
  /** Programas que arrancan con el sistema (por defecto, los 15 de `programs.ts`). */
  programs?: ProgramSpec[]
  policy?: SchedulerPolicy
  /** Ticks que tarda el despachador en cargar el contexto de otro proceso. */
  contextSwitchTicks?: number
  memory?: Partial<MemoryConfig> & { autoCompact?: boolean }
  /** Semáforos, mutex, búferes y variables compartidas (por defecto, los del sistema). */
  sync?: SyncConfig
  /** Recursos de uso exclusivo (REQ/REL). */
  resources?: ResourceDef[]
  deadlockPolicy?: DeadlockPolicy
  autoRecover?: boolean
  recovery?: RecoveryMethod
  aging?: boolean
  /** Conectar teclado, ratón y USB al hardware real (los controla el HAL). */
  realDevices?: boolean
  /** Dispositivo de bloques del disco (por defecto, uno en memoria recién formateado). */
  disk?: BlockDevice
  diskPolicy?: DiskPolicy
  logCapacity?: number
  ganttCapacity?: number
}

export const MAX_CONTEXT_SWITCH_TICKS = 5
export const MAX_QUANTUM = 50
export const DEFAULT_MEMORY: MemoryConfig = {
  totalKb: 1600,
  osKb: 256,
  unitKb: 16,
  policy: 'FIRST'
}
/** Por debajo de esta carga (sin cargador) el kernel entra en modo de bajo consumo. */
export const LOW_BATTERY = 20
/** Carpeta de la memoria USB real donde se copian los respaldos. */
export const USB_BACKUP_DIR = 'guiñanOS-respaldos'
/** FSCAN analiza como máximo esta cantidad de cada archivo (la cabecera). */
export const SCAN_KB = 64
/** KB que el kernel puede copiar por tick al compactar. */
export const COMPACT_KB_PER_TICK = 128
/** Ticks mínimos que un proceso permanece en memoria antes de poder ser intercambiado. */
export const MIN_RESIDENCY = 20
/**
 * Envejecimiento del intercambio: tras esperar memoria este número de ticks, un proceso
 * puede desplazar a procesos bloqueados de cualquier prioridad (evita que se quede fuera para siempre).
 */
export const MEM_WAIT_AGING = 60
/** Envejecimiento: cada cuántos ticks seguidos en Listo mejora un nivel la prioridad efectiva. */
export const AGING_INTERVAL = 10
/** Ticks seguidos en Listo a partir de los cuales se reporta inanición. */
export const STARVATION_TICKS = 100
/** Con recuperación automática, ticks que se deja visible el interbloqueo antes de romperlo. */
export const AUTO_RECOVERY_DELAY = 15

const SNAPSHOT_GANTT = 240
const SNAPSHOT_EVENTS = 200
/** Protección contra programas con bucles que no consumen CPU. */
const MAX_JUMPS_PER_TICK = 64
/** Máximo de instrucciones instantáneas encadenadas en un tick. */
const MAX_INSTANT_PER_TICK = 16
/** Al salir del final del código, el proceso ejecuta un exit implícito. */
const IMPLICIT_EXIT: Instr = { op: 'EXIT' }

/** Dirección en KB con su equivalente hexadecimal en bytes. */
export function fmtAddr(kb: number): string {
  return `${kb} KB (0x${(kb * 1024).toString(16).toUpperCase().padStart(6, '0')})`
}

/**
 * Núcleo del sistema operativo simulado.
 * Es TypeScript puro (sin Electron): quien lo aloja decide cuándo llamar a `tick()`.
 *
 * Orden de cada tick:
 *  1. Planificador de largo plazo: admite procesos Nuevos (a memoria o, si no caben,
 *     al área de intercambio) y crea los que llegan.
 *  2. Interrupciones: E/S, swap y recubrimientos terminados en el tick anterior y
 *     temporizadores vencidos. Después los dispositivos trabajan este tick.
 *  3. Planificador de mediano plazo: carga procesos suspendidos, intercambia
 *     procesos bloqueados y compacta la memoria si hace falta.
 *  4. Expropiación y despacho (planificador de corto plazo), salvo que el kernel
 *     esté ocupando la CPU (compactación).
 *  5. Contabilidad de espera.
 *  6. Ejecución de un tick: kernel, cambio de contexto, instrucción del proceso u ocio.
 */
export class Kernel {
  clock!: Clock
  log!: EventLog
  gantt!: GanttChart
  scheduler!: Scheduler
  devices!: DeviceManager
  timers!: TimerQueue
  memory!: MemoryManager
  sync!: SyncManager

  private readonly procs = new Map<number, PCB>()
  private pending: ProgramSpec[] = []
  private nextPid = 1
  private runningPid: number | null = null
  private switchRemaining = 0
  private lastRunPid: number | null = null
  private counters = { busy: 0, idle: 0, cs: 0, os: 0, contextSwitches: 0 }
  private memCounters = { compactions: 0, kbMoved: 0, swapIns: 0, swapOuts: 0 }
  private lastCompaction: MemoryInfo['lastCompaction'] = null
  private transitionCounts: Partial<Record<TransitionKey, number>> = {}
  /** E/S completadas cuya interrupción aún no se atiende. */
  private pendingIrqs: IoCompletion[] = []
  /** Ticks que el kernel tiene ocupada la CPU (compactación en curso). */
  private osBusy = 0

  private running = true
  private tickMs: number
  private bootedAt = 0
  private contextSwitchTicks: number
  private autoCompact: boolean
  private deadlockPolicy: DeadlockPolicy
  private autoRecover: boolean
  private recovery: RecoveryMethod
  private aging: boolean
  private deadlock: ResourcesInfo['deadlock'] = null
  private dlStats = { deadlocks: 0, recoveries: 0, unsafeDenials: 0, preventiveReleases: 0 }
  resources!: ResourceManager
  fs!: GuinanFS
  private readonly disk: BlockDevice
  private diskPolicy: DiskPolicy
  private io = { reads: 0, writes: 0, kbRead: 0, kbWritten: 0 }
  /** Estado del hardware real: sobrevive a los reinicios del kernel. */
  private hw: HardwareInfo
  private realModes: Record<'teclado' | 'raton' | 'usb', boolean>
  private normalTickMs: number | null = null
  private readonly openDocs = new Map<string, string>()
  private effects: KernelEffect[] = []
  private printSeq = 0
  private backupSeq = 0
  private readonly programs: ProgramSpec[]

  constructor(private readonly opts: KernelOptions = {}) {
    this.tickMs = clampTickMs(opts.tickMs ?? 250)
    this.programs = opts.programs ?? BOOT_PROGRAMS
    this.contextSwitchTicks = clampInt(opts.contextSwitchTicks ?? 0, 0, MAX_CONTEXT_SWITCH_TICKS)
    this.autoCompact = opts.memory?.autoCompact ?? true
    this.deadlockPolicy = opts.deadlockPolicy ?? 'DETECT'
    this.autoRecover = opts.autoRecover ?? false
    this.recovery = opts.recovery ?? 'rollback'
    this.aging = opts.aging ?? false
    this.disk = opts.disk ?? new MemoryBlockDevice()
    this.diskPolicy = opts.diskPolicy ?? 'LOOK'
    const real = opts.realDevices ?? false
    this.realModes = { teclado: real, raton: real, usb: real }
    this.hw = {
      real,
      storage: null,
      ac: null,
      battery: null,
      lowPower: false,
      usbBackup: true,
      usbStrict: false,
      realModes: { ...this.realModes },
      openDocs: [],
      lastBackup: null,
      lastPrint: null
    }
    this.boot(opts.policy ?? 'PRIORITY_RR', opts.memory?.policy ?? DEFAULT_MEMORY.policy)
  }

  get isRunning(): boolean {
    return this.running
  }

  get tickInterval(): number {
    return this.tickMs
  }

  get now(): number {
    return this.clock.now
  }

  // ───────────────────────────── arranque ─────────────────────────────

  private boot(policy: SchedulerPolicy, fit: FitPolicy): void {
    this.bootedAt = (this.opts.now ?? Date.now)()
    this.clock = new Clock()
    this.log = new EventLog(this.opts.logCapacity)
    this.gantt = new GanttChart(this.opts.ganttCapacity)
    this.scheduler = new Scheduler(policy, (pid) => this.pcb(pid))
    this.devices = new DeviceManager(new DiskArm(this.diskPolicy))
    this.io = { reads: 0, writes: 0, kbRead: 0, kbWritten: 0 }
    this.mountDisk()
    this.applyDeviceModes()
    this.timers = new TimerQueue()
    this.memory = new MemoryManager({ ...DEFAULT_MEMORY, ...this.opts.memory, policy: fit })
    this.sync = new SyncManager(this.opts.sync ?? DEFAULT_SYNC)
    this.resources = new ResourceManager(this.opts.resources ?? DEFAULT_RESOURCES)
    this.deadlock = null
    this.dlStats = { deadlocks: 0, recoveries: 0, unsafeDenials: 0, preventiveReleases: 0 }
    this.procs.clear()
    this.nextPid = 1
    this.runningPid = null
    this.switchRemaining = 0
    this.lastRunPid = null
    this.osBusy = 0
    this.counters = { busy: 0, idle: 0, cs: 0, os: 0, contextSwitches: 0 }
    this.memCounters = { compactions: 0, kbMoved: 0, swapIns: 0, swapOuts: 0 }
    this.lastCompaction = null
    this.pendingIrqs = []
    this.transitionCounts = {}
    this.pending = [...this.programs].sort((a, b) => a.arrival - b.arrival)
    this.emit(
      'scheduler',
      `guiñanOS iniciado · planificador: ${POLICY_LABEL[policy]} · memoria: ` +
        `${this.memory.totalKb} KB (${this.memory.osKb} KB del SO), ${FIT_LABEL[fit].toLowerCase()}`
    )
    this.spawnArrivals()
  }

  // ───────────────────────────── ciclo de reloj ─────────────────────────────

  /** Avanza un ciclo de reloj del sistema. */
  tick(): void {
    const now = this.clock.advance()
    this.admitNew(now)
    this.spawnArrivals()
    this.handleInterrupts(now)
    this.mediumTermSchedule()
    this.grantPending()
    this.checkDeadlock()
    if (this.osBusy === 0) {
      this.checkPreemption()
      if (this.runningPid === null) this.dispatch()
    }
    this.accountWaiting()
    this.execute(now)
  }

  /** Planificador de largo plazo: Nuevo → Listo (con memoria) o Listo/Suspendido (sin ella). */
  private admitNew(now: number): void {
    for (const pcb of this.procs.values()) {
      if (pcb.state !== 'NEW' || pcb.arrival >= now) continue
      pcb.admittedAt = now
      const part = this.memory.allocate(pcb.pid, pcb.memoryKb)
      if (part) {
        pcb.loadedAt = now
        this.transition(
          pcb,
          'READY',
          `admitido: partición de ${part.size} KB en ${fmtAddr(part.base)}`
        )
        this.scheduler.enqueue(pcb.pid)
      } else {
        pcb.suspendedBy = 'memory'
        this.transition(
          pcb,
          'READY_SUSPENDED',
          `admitido en el área de intercambio: no hay un hueco de ${this.memory.roundUp(pcb.memoryKb)} KB`
        )
        this.writeSwapImage(pcb)
        this.setMemWait(pcb)
      }
    }
  }

  private spawnArrivals(): void {
    while (this.pending.length > 0 && this.pending[0].arrival <= this.now) {
      this.spawn(this.pending.shift()!)
    }
  }

  spawn(spec: ProgramSpec): PCB {
    const pcb = createPcb(this.nextPid, spec, this.now)
    const problem =
      this.sync.validate(pcb.code) ??
      pcb.code
        .filter((i) => (i.op === 'REQ' || i.op === 'REL') && !this.resources.has(i.resource))
        .map((i) => `usa el recurso «${(i as { resource: string }).resource}», que no existe`)[0]
    if (problem) throw new ProgramError(`${spec.id}: ${problem}`)
    this.nextPid++
    this.resources.declareClaim(pcb.pid, claimFromCode(pcb.code))
    this.procs.set(pcb.pid, pcb)
    this.emit(
      'create',
      `Proceso creado: ${pcb.name} · prioridad ${pcb.priority} · quantum ${pcb.quantum} · ${pcb.memoryKb} KB`,
      pcb.pid
    )
    return pcb
  }

  private handleInterrupts(now: number): void {
    // E/S terminadas en el tick anterior + interrupciones del hardware real llegadas entre ticks.
    for (const { device, pid, tag } of [...this.pendingIrqs, ...this.devices.takeSignaled()]) {
      const pcb = this.pcb(pid)
      if (tag === 'swap') {
        this.emit(
          'interrupt',
          `IRQ ${DEVICE_LABEL[device]}: imagen cargada desde el área de intercambio`,
          pid
        )
        this.finishSwapIn(pcb)
      } else if (tag === 'overlay') {
        const ov = pcb.overlay!
        ov.loaded = ov.pending
        ov.pending = null
        this.emit('interrupt', `IRQ ${DEVICE_LABEL[device]}: módulo de recubrimiento cargado`, pid)
        this.emit('memory', `Recubrimiento: «${ov.loaded}» ocupa ahora el área de overlay`, pid)
        this.wake(pcb, `módulo «${ov.loaded}» cargado`)
      } else if (tag === 'swapout') {
        // Escritura de la imagen al área de intercambio: el proceso ya estaba suspendido.
      } else if (tag === 'file') {
        const w = pcb.waitingOn
        const what =
          w?.kind === 'file'
            ? `${w.op === 'read' ? 'lectura de' : 'escritura de'} ${w.path}`
            : 'E/S'
        this.emit('interrupt', `IRQ ${DEVICE_LABEL[device]}: terminó la ${what}`, pid)
        this.wake(pcb, `fin de la ${what}`)
      } else {
        this.emit('interrupt', `IRQ ${DEVICE_LABEL[device]}: E/S terminada`, pid)
        if (device === 'usb') this.backupToUsb(pcb)
        if (device === 'impresora') this.printJob(pcb)
        this.wake(pcb, `fin de E/S en ${DEVICE_LABEL[device]}`)
      }
    }
    for (const pid of this.timers.expire(now)) {
      this.emit('interrupt', 'IRQ temporizador: plazo vencido', pid)
      this.wake(this.pcb(pid), 'temporizador vencido')
    }
    this.pendingIrqs = this.devices.tick(now)
  }

  private wake(pcb: PCB, cause: string): void {
    if (pcb.state === 'BLOCKED') {
      pcb.waitingOn = null
      this.transition(pcb, 'READY', cause)
      this.scheduler.enqueue(pcb.pid)
    } else if (pcb.state === 'BLOCKED_SUSPENDED') {
      pcb.waitingOn = pcb.suspendedBy === 'memory' ? { kind: 'memory' } : null
      this.transition(pcb, 'READY_SUSPENDED', cause)
    }
  }

  // ───────────────────────────── memoria ─────────────────────────────

  /**
   * Planificador de mediano plazo. Trae a memoria procesos Listos/Suspendidos;
   * si no caben, intercambia procesos bloqueados de igual o menor prioridad y,
   * si la memoria libre alcanza pero está fragmentada, compacta.
   */
  private mediumTermSchedule(): void {
    if (this.osBusy > 0) return
    const candidates = [...this.procs.values()]
      .filter(
        (p) =>
          p.state === 'READY_SUSPENDED' &&
          p.suspendedBy === 'memory' &&
          !this.memory.partitionOf(p.pid)
      )
      .sort((a, b) => a.priority - b.priority || a.pid - b.pid)
    let handled = false
    for (const c of candidates) {
      if (this.tryLoad(c)) continue
      // Solo el primero que no cabe puede provocar intercambios o compactación;
      // los demás se cargan si encuentran hueco (relleno) o esperan.
      if (handled) this.setMemWait(c)
      else this.makeRoom(c)
      handled = true
    }
  }

  private makeRoom(c: PCB): void {
    const need = this.memory.roundUp(c.memoryKb)
    let free = this.memory.stats().freeKb
    if (free < need) {
      const aged = c.memWaitSince !== null && this.now - c.memWaitSince >= MEM_WAIT_AGING
      const victims = [...this.procs.values()]
        .filter(
          (v) =>
            v.state === 'BLOCKED' &&
            (aged || v.priority >= c.priority) &&
            v.waitingOn?.kind !== 'overlay' &&
            v.loadedAt !== null &&
            this.now - v.loadedAt >= MIN_RESIDENCY &&
            this.memory.partitionOf(v.pid)
        )
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            this.memory.partitionOf(b.pid)!.size - this.memory.partitionOf(a.pid)!.size
        )
      const chosen: PCB[] = []
      for (const v of victims) {
        if (free >= need) break
        chosen.push(v)
        free += this.memory.partitionOf(v.pid)!.size
      }
      if (free < need) {
        this.setMemWait(c)
        return
      }
      if (aged && chosen.some((v) => v.priority < c.priority)) {
        this.emit(
          'memory',
          `PID ${c.pid} lleva ${this.now - c.memWaitSince!} ticks esperando memoria: ` +
            'por envejecimiento puede desplazar procesos de mayor prioridad',
          c.pid
        )
      }
      for (const v of chosen) this.swapOut(v, `libera memoria para PID ${c.pid}`)
      if (this.tryLoad(c)) return
    }
    // La memoria libre alcanza pero no es contigua: fragmentación externa.
    if (this.autoCompact) {
      this.setMemWait(c)
      this.compact(`para cargar PID ${c.pid}`)
      this.tryLoad(c)
    } else {
      this.setMemWait(c)
    }
  }

  /** Reserva una partición y pide al disco la copia de la imagen desde el área de intercambio. */
  private tryLoad(c: PCB): boolean {
    const part = this.memory.allocate(c.pid, c.memoryKb)
    if (!part) return false
    const ticks = this.swapInTransfer(c, part.size)
    c.waitingOn = { kind: 'swap' }
    c.memWait = null
    c.memWaitSince = null
    this.emit(
      'memory',
      `Swap in: carga PID ${c.pid} (${part.size} KB) en ${fmtAddr(part.base)} · ${ticks} ticks de transferencia`,
      c.pid
    )
    return true
  }

  private finishSwapIn(pcb: PCB): void {
    if (pcb.state !== 'READY_SUSPENDED' || pcb.waitingOn?.kind !== 'swap') return
    pcb.waitingOn = null
    pcb.suspendedBy = null
    pcb.loadedAt = this.now
    this.memCounters.swapIns++
    this.transition(pcb, 'READY', 'cargado desde el área de intercambio (swap in)')
    this.scheduler.enqueue(pcb.pid)
  }

  private swapOut(v: PCB, cause: string): void {
    const part = this.memory.free(v.pid)!
    v.suspendedBy = 'memory'
    this.memCounters.swapOuts++
    this.writeSwapImage(v)
    this.emit(
      'memory',
      `Swap out: PID ${v.pid} (${part.size} KB) deja ${fmtAddr(part.base)} → área de intercambio`,
      v.pid
    )
    this.transition(v, 'BLOCKED_SUSPENDED', `intercambiado a disco: ${cause}`)
  }

  private setMemWait(pcb: PCB): void {
    const need = this.memory.roundUp(pcb.memoryKb)
    const reason = this.memory.fitsAfterCompaction(pcb.memoryKb) ? 'fragmentation' : 'no-memory'
    pcb.waitingOn = { kind: 'memory' }
    pcb.memWaitSince ??= this.now
    if (pcb.memWait === reason) return
    pcb.memWait = reason
    const st = this.memory.stats()
    this.emit(
      'memory',
      reason === 'fragmentation'
        ? `Fragmentación externa: PID ${pcb.pid} necesita ${need} KB; hay ${st.freeKb} KB libres ` +
            `pero el hueco mayor es de ${st.largestHoleKb} KB`
        : `Memoria insuficiente: PID ${pcb.pid} necesita ${need} KB y solo hay ${st.freeKb} KB libres`,
      pcb.pid
    )
  }

  /** Compactación: el kernel ocupa la CPU mientras reubica particiones. */
  private compact(reason: string): void {
    const moves: Relocation[] = this.memory.compact()
    if (moves.length === 0) {
      this.emit('memory', 'Compactación innecesaria: la memoria libre ya es contigua')
      return
    }
    const moved = moves.reduce((n, m) => n + m.size, 0)
    const cost = Math.max(1, Math.ceil(moved / COMPACT_KB_PER_TICK))
    if (this.runningPid !== null) {
      this.preempt(this.pcb(this.runningPid), 'interrumpido: el kernel compacta la memoria')
    }
    this.osBusy += cost
    this.memCounters.compactions++
    this.memCounters.kbMoved += moved
    this.lastCompaction = { tick: this.now, moves, cost }
    this.emit(
      'memory',
      `Compactación ${reason}: ${moves.length} particiones reubicadas, ${moved} KB copiados, ` +
        `${cost} ticks de CPU del kernel`
    )
    for (const m of moves) {
      this.emit('memory', `Reubicación: registro base ${fmtAddr(m.from)} → ${fmtAddr(m.to)}`, m.pid)
    }
  }

  // ───────────────────────────── CPU ─────────────────────────────

  private checkPreemption(): void {
    // El despachador no se interrumpe: la expropiación se evalúa al terminar el cambio de contexto.
    if (this.runningPid === null || this.switchRemaining > 0) return
    const running = this.pcb(this.runningPid)
    const better = this.scheduler.preemptorOf(running)
    if (better) {
      this.preempt(
        running,
        `expropiado: PID ${better.pid} (prioridad ${better.priority}) tiene mayor prioridad`
      )
    }
  }

  /** Planificador de corto plazo + despachador: Listo → Ejecución. */
  private dispatch(): void {
    const pid = this.scheduler.pickNext()
    if (pid === undefined) return
    const pcb = this.pcb(pid)
    this.transition(pcb, 'RUNNING', 'despachado por el planificador')
    pcb.quantumUsed = 0
    pcb.readyStreak = 0
    pcb.firstRun ??= this.now
    this.runningPid = pid
    if (this.lastRunPid !== pid) {
      this.counters.contextSwitches++
      pcb.contextSwitches++
      this.switchRemaining = this.contextSwitchTicks
      this.emit(
        'dispatch',
        this.lastRunPid === null
          ? `Cambio de contexto: carga PID ${pid}`
          : `Cambio de contexto: guarda PID ${this.lastRunPid}, carga PID ${pid}`,
        pid
      )
    }
    this.lastRunPid = pid
  }

  private accountWaiting(): void {
    for (const pcb of this.procs.values()) {
      if (pcb.state === 'READY') {
        pcb.waitTime++
        pcb.readyStreak++
        pcb.maxReadyStreak = Math.max(pcb.maxReadyStreak, pcb.readyStreak)
        if (this.aging && pcb.readyStreak % AGING_INTERVAL === 0 && pcb.priority > PRIORITY_MAX) {
          pcb.priority--
          this.emit(
            'starvation',
            `Envejecimiento: tras ${pcb.readyStreak} ticks en Listo su prioridad efectiva sube a ${pcb.priority}`,
            pcb.pid
          )
        }
        if (pcb.readyStreak === STARVATION_TICKS) {
          this.emit(
            'starvation',
            `Inanición: ${pcb.name} lleva ${STARVATION_TICKS} ticks en Listo sin recibir CPU ` +
              `(prioridad ${pcb.priority})`,
            pcb.pid,
            'warning'
          )
        }
      } else if (pcb.state === 'BLOCKED' || pcb.state === 'BLOCKED_SUSPENDED') {
        pcb.blockedTime++
      }
    }
  }

  private execute(now: number): void {
    if (this.osBusy > 0) {
      this.osBusy--
      this.counters.os++
      this.gantt.record({ tick: now, pid: null, kind: 'os' })
      return
    }
    if (this.runningPid === null) {
      this.counters.idle++
      this.gantt.record({ tick: now, pid: null, kind: 'idle' })
      return
    }
    const pcb = this.pcb(this.runningPid)

    if (this.switchRemaining > 0) {
      this.switchRemaining--
      this.counters.cs++
      this.gantt.record({ tick: now, pid: pcb.pid, kind: 'cs' })
      return
    }

    if (!this.resolveJumps(pcb)) return
    const instr = pcb.code[pcb.pc] ?? IMPLICIT_EXIT
    this.counters.busy++
    this.gantt.record({ tick: now, pid: pcb.pid, kind: 'run' })
    pcb.cpuTime++
    pcb.quantumUsed++

    if (instr.op === 'CPU') {
      pcb.burstRemaining ??= instr.ticks
      if (--pcb.burstRemaining > 0) {
        if (pcb.quantumUsed >= this.scheduler.quantumFor(pcb)) {
          this.preempt(pcb, `fin de quantum (q = ${pcb.quantum})`)
        }
        return
      }
      pcb.burstRemaining = null
      pcb.pc++
    }
    // Si la instrucción actual no era CPU, este tick es la trampa al kernel.
    // En ambos casos se ejecutan en cadena las instrucciones instantáneas que siguen.
    if (!this.runInstant(pcb, now)) return
    if (pcb.quantumUsed >= this.scheduler.quantumFor(pcb)) {
      this.preempt(pcb, `fin de quantum (q = ${pcb.quantum})`)
    }
  }

  /**
   * Ejecuta en cadena las instrucciones que no consumen tiempo de CPU apreciable:
   * llamadas al sistema que no bloquean, accesos a memoria compartida y saltos.
   * Se detiene ante una ráfaga de CPU o cuando el proceso deja de ejecutarse.
   * Devuelve true si el proceso sigue en ejecución.
   */
  private runInstant(pcb: PCB, now: number): boolean {
    for (let n = 0; n < MAX_INSTANT_PER_TICK; n++) {
      if (!this.resolveJumps(pcb)) return false
      const instr = pcb.code[pcb.pc] ?? IMPLICIT_EXIT
      if (instr.op === 'CPU') return true
      if (isUserOp(instr)) {
        this.userOp(pcb, instr, now)
        pcb.pc++
        continue
      }
      this.syscall(pcb, instr, now)
      if (pcb.state !== 'RUNNING') return false
    }
    return true
  }

  /** Atiende una llamada al sistema del proceso en ejecución. */
  private syscall(pcb: PCB, instr: Instr, now: number): void {
    switch (instr.op) {
      case 'IO':
        pcb.pc++
        pcb.ioCount++
        pcb.waitingOn = { kind: 'io', device: instr.device }
        this.devices.request(instr.device, pcb.pid, instr.ticks, 'io', this.now)
        this.emit(
          'syscall',
          `Llamada al sistema: E/S en ${DEVICE_LABEL[instr.device]} (${instr.ticks} ticks)`,
          pcb.pid
        )
        this.block(pcb, `espera E/S en ${DEVICE_LABEL[instr.device]}`)
        return
      case 'SLEEP': {
        // Duerme los ticks now+1 … now+n y despierta al inicio del tick now+n+1.
        const wakeAt = now + instr.ticks + 1
        pcb.pc++
        pcb.waitingOn = { kind: 'timer', until: wakeAt }
        this.timers.add(pcb.pid, wakeAt)
        this.emit('syscall', `Llamada al sistema: dormir ${instr.ticks} ticks`, pcb.pid)
        this.block(pcb, 'espera al temporizador')
        return
      }
      case 'OVERLAY': {
        const ov = pcb.overlay!
        pcb.pc++
        if (ov.loaded === instr.module) {
          this.emit('memory', `Recubrimiento: «${instr.module}» ya está en memoria`, pcb.pid)
          return
        }
        const size = ov.modules[instr.module]
        const ticks = Math.max(1, Math.ceil(size / DISK_KB_PER_TICK))
        const file = this.fs.blocksOf(`/Sistema/${pcb.programId}/${instr.module}.ovl`)
        ov.pending = instr.module
        pcb.waitingOn = { kind: 'overlay', module: instr.module }
        this.devices.diskRequest({
          pid: pcb.pid,
          tag: 'overlay',
          cylinder: file ? this.cylinderOf(file.blocks[0] ?? file.indexBlock) : 0,
          transferTicks: ticks,
          kb: size,
          label: `overlay ${instr.module}`,
          since: this.now
        })
        this.emit(
          'memory',
          `Recubrimiento: carga «${instr.module}» (${size} KB) desde disco` +
            (ov.loaded ? `, reemplaza a «${ov.loaded}»` : '') +
            ` · ${ticks} ticks`,
          pcb.pid
        )
        this.block(pcb, `carga el módulo de recubrimiento «${instr.module}»`)
        return
      }
      case 'WAIT': {
        pcb.pc++
        const r = this.sync.wait(instr.name, pcb.pid)
        if (r === 'ignored') {
          this.emit('sync', `WAIT ${instr.name} ignorado: sincronización desactivada`, pcb.pid)
        } else if (r === 'acquired') {
          this.emit(
            'sync',
            `WAIT ${instr.name}: pasa (queda en ${this.sync.semValue(instr.name)})`,
            pcb.pid
          )
        } else {
          pcb.waitingOn = { kind: 'sync', object: instr.name, op: 'WAIT' }
          this.emit('sync', `WAIT ${instr.name}: vale 0, el proceso se bloquea`, pcb.pid)
          this.block(pcb, `espera el semáforo «${instr.name}»`)
        }
        return
      }
      case 'SIGNAL': {
        pcb.pc++
        const r = this.sync.signal(instr.name)
        if (r === 'ignored' || r === 'not-owner') {
          this.emit('sync', `SIGNAL ${instr.name} ignorado: sincronización desactivada`, pcb.pid)
        } else if (r.woke !== null) {
          this.emit('sync', `SIGNAL ${instr.name}: despierta a PID ${r.woke}`, pcb.pid)
          this.wakeFromSync(r.woke, `SIGNAL ${instr.name} de PID ${pcb.pid}`)
        } else {
          this.emit(
            'sync',
            `SIGNAL ${instr.name}: sube a ${this.sync.semValue(instr.name)}`,
            pcb.pid
          )
        }
        return
      }
      case 'LOCK': {
        pcb.pc++
        const r = this.sync.lock(instr.name, pcb.pid)
        if (r === 'ignored') {
          this.emit('sync', `LOCK ${instr.name} ignorado: entra sin exclusión mutua`, pcb.pid)
        } else if (r === 'acquired') {
          this.emit('sync', `LOCK ${instr.name}: entra a la sección crítica`, pcb.pid)
        } else if (r === 'already-owner') {
          this.emit('sync', `LOCK ${instr.name}: ya es su dueño`, pcb.pid)
        } else {
          pcb.waitingOn = { kind: 'sync', object: instr.name, op: 'LOCK' }
          this.emit(
            'sync',
            `LOCK ${instr.name}: ocupado por PID ${this.sync.ownerOf(instr.name)}, el proceso se bloquea`,
            pcb.pid
          )
          this.block(pcb, `espera el mutex «${instr.name}»`)
        }
        return
      }
      case 'UNLOCK': {
        pcb.pc++
        const r = this.sync.unlock(instr.name, pcb.pid)
        if (r === 'ignored') {
          this.emit('sync', `UNLOCK ${instr.name} ignorado: sincronización desactivada`, pcb.pid)
        } else if (r === 'not-owner') {
          this.emit('sync', `UNLOCK ${instr.name} inválido: el proceso no es su dueño`, pcb.pid)
        } else {
          this.emit(
            'sync',
            `UNLOCK ${instr.name}: sale de la sección crítica` +
              (r.woke !== null ? `; el mutex pasa a PID ${r.woke}` : ''),
            pcb.pid
          )
          if (r.woke !== null) this.wakeFromSync(r.woke, `obtiene el mutex «${instr.name}»`)
        }
        return
      }
      case 'REQ':
        pcb.pc++
        this.requestResources(pcb, { [instr.resource]: instr.count })
        return
      case 'FREAD': {
        pcb.pc++
        try {
          const r = this.fs.readFile(instr.path, instr.kb === null ? Infinity : instr.kb * 1024)
          pcb.lastRead = instr.path
          this.fileIo(pcb, 'read', instr.path, r.blocks, r.bytes.length)
        } catch (e) {
          this.emit('file', `FREAD ${instr.path}: ${(e as Error).message}`, pcb.pid, 'warning')
        }
        return
      }
      case 'FWRITE': {
        pcb.pc++
        try {
          const blocks = this.fs.writeFile(
            instr.path,
            this.fileContent(pcb, instr.path, instr.kb),
            this.secs()
          )
          this.fileIo(pcb, 'write', instr.path, blocks, instr.kb * 1024)
        } catch (e) {
          this.emit('file', `FWRITE ${instr.path}: ${(e as Error).message}`, pcb.pid, 'warning')
        }
        return
      }
      case 'FSCAN': {
        pcb.pc++
        const files = this.fs.files()
        if (files.length === 0) return
        const f = files[pcb.scanIndex++ % files.length]
        const r = this.fs.readFile(f.path, SCAN_KB * 1024)
        pcb.lastRead = f.path
        this.emit('file', `Analiza ${f.path}`, pcb.pid)
        this.fileIo(pcb, 'read', f.path, r.blocks, r.bytes.length)
        return
      }
      case 'REL': {
        pcb.pc++
        const what = this.vecText({ [instr.resource]: instr.count })
        if (!this.resources.release(pcb.pid, instr.resource, instr.count)) {
          this.emit('resource', `REL ${what} inválido: el proceso no lo tiene`, pcb.pid, 'warning')
          return
        }
        this.emit('resource', `REL: devuelve ${what}`, pcb.pid)
        this.grantPending()
        return
      }
      case 'EXIT':
        this.emit('syscall', 'Llamada al sistema: exit', pcb.pid)
        this.terminate(
          pcb,
          instr === IMPLICIT_EXIT
            ? 'terminó normalmente (fin del programa)'
            : 'terminó normalmente (EXIT)'
        )
        return
      case 'CPU':
      case 'LOOP':
      case 'LOAD':
      case 'STORE':
      case 'ADDI':
      case 'PUT':
      case 'GET':
        throw new Error(`${instr.op} no es una llamada al sistema`)
    }
  }

  /** Instrucciones de usuario sobre memoria compartida (consumen un tick, no bloquean). */
  private userOp(pcb: PCB, instr: UserOp, now: number): void {
    switch (instr.op) {
      case 'LOAD':
        pcb.reg = pcb.regLoaded = this.sync.load(instr.name)
        pcb.regVar = instr.name
        this.emit('sync', `LOAD ${instr.name}: registro ← ${pcb.reg}`, pcb.pid)
        return
      case 'ADDI':
        pcb.reg = (pcb.reg ?? 0) + instr.value
        return
      case 'STORE': {
        const current = this.sync.load(instr.name)
        const value = pcb.reg ?? 0
        if (pcb.regVar === instr.name && pcb.regLoaded !== null && current !== pcb.regLoaded) {
          this.emit(
            'sync',
            `Condición de carrera: escribe ${value} en ${instr.name}, pero otro proceso la cambió de ` +
              `${pcb.regLoaded} a ${current} desde su LOAD; esa actualización se pierde`,
            pcb.pid
          )
        } else {
          this.emit('sync', `STORE ${instr.name}: ${instr.name} ← ${value}`, pcb.pid)
        }
        // El valor esperado acumula lo que este proceso quiso sumar desde su LOAD.
        if (pcb.regVar === instr.name && pcb.regLoaded !== null) {
          this.sync.addExpected(instr.name, value - pcb.regLoaded)
        }
        this.sync.store(instr.name, value)
        pcb.regLoaded = null
        return
      }
      case 'PUT': {
        const r = this.sync.put(instr.name, pcb.pid, now)
        this.emit(
          'sync',
          r.ok
            ? `PUT ${instr.name}: deposita el elemento #${r.item.seq}`
            : `Desbordamiento: ${instr.name} está lleno y el elemento se pierde (falta sincronización)`,
          pcb.pid
        )
        return
      }
      case 'GET': {
        const item = this.sync.get(instr.name)
        this.emit(
          'sync',
          item
            ? `GET ${instr.name}: consume el elemento #${item.seq} (de PID ${item.producer})`
            : `Lectura de ${instr.name} vacío: consume basura (falta sincronización)`,
          pcb.pid
        )
        return
      }
    }
  }

  private wakeFromSync(pid: number, cause: string): void {
    const pcb = this.pcb(pid)
    if (pcb.waitingOn?.kind === 'sync') this.wake(pcb, cause)
  }

  /** Ejecuta los saltos pendientes (no consumen CPU). Devuelve false si el proceso fue abortado. */
  private resolveJumps(pcb: PCB): boolean {
    for (let jumps = 0; ; jumps++) {
      const instr = pcb.code[pcb.pc]
      if (instr?.op !== 'LOOP') return true
      if (jumps >= MAX_JUMPS_PER_TICK) {
        this.terminate(pcb, 'abortado: bucle sin instrucciones ejecutables')
        return false
      }
      if (instr.times === null) {
        pcb.pc = instr.target
        continue
      }
      const done = pcb.loopCounters.get(pcb.pc) ?? 1
      if (done < instr.times) {
        pcb.loopCounters.set(pcb.pc, done + 1)
        pcb.pc = instr.target
      } else {
        pcb.loopCounters.delete(pcb.pc)
        pcb.pc++
      }
    }
  }

  // ───────────────────────────── cambios de estado ─────────────────────────────

  private transition(pcb: PCB, to: ProcState, cause: string): void {
    const from = pcb.state
    if (!canTransition(from, to)) throw new IllegalTransitionError(pcb.pid, from, to)
    pcb.state = to
    const key: TransitionKey = `${from}>${to}`
    this.transitionCounts[key] = (this.transitionCounts[key] ?? 0) + 1
    this.log.push({
      tick: this.now,
      kind: 'transition',
      pid: pcb.pid,
      from,
      to,
      message: `${STATE_LABEL[from]} → ${STATE_LABEL[to]}: ${cause}`
    })
  }

  private releaseCpu(pcb: PCB): void {
    if (this.runningPid === pcb.pid) {
      this.runningPid = null
      this.switchRemaining = 0
    }
    // La prioridad ganada por envejecimiento se pierde al dejar la CPU.
    pcb.priority = pcb.basePriority
  }

  private preempt(pcb: PCB, cause: string): void {
    this.releaseCpu(pcb)
    this.transition(pcb, 'READY', cause)
    this.scheduler.enqueue(pcb.pid)
  }

  private block(pcb: PCB, cause: string): void {
    this.releaseCpu(pcb)
    this.transition(pcb, 'BLOCKED', cause)
  }

  private terminate(pcb: PCB, reason: string): void {
    if (pcb.state === 'TERMINATED') return
    this.releaseCpu(pcb)
    this.scheduler.remove(pcb.pid)
    this.devices.cancel(pcb.pid)
    this.timers.cancel(pcb.pid)
    this.fs.swapFree(pcb.pid)
    pcb.waitingOn = null
    pcb.burstRemaining = null
    pcb.memWait = null
    pcb.finishedAt = this.now
    pcb.exitReason = reason
    this.transition(pcb, 'TERMINATED', reason)
    const { released, woke } = this.sync.removeProcess(pcb.pid)
    for (const name of released) {
      this.emit(
        'sync',
        `Terminó dentro de la sección crítica: se libera el mutex «${name}»`,
        pcb.pid
      )
    }
    for (const w of woke) this.wakeFromSync(w.pid, `obtiene el mutex «${w.name}»`)
    const held = this.resources.held(pcb.pid)
    this.resources.forget(pcb.pid)
    if (Object.keys(held).length > 0) {
      this.emit('resource', `Al terminar devuelve ${this.vecText(held)}`, pcb.pid)
      this.grantPending()
    }
    const part = this.memory.free(pcb.pid)
    if (part) {
      this.emit('memory', `Memoria liberada: ${part.size} KB en ${fmtAddr(part.base)}`, pcb.pid)
    }
  }

  /** Suspensión pedida por el usuario: la imagen sale de memoria al área de intercambio. */
  private suspend(pcb: PCB): void {
    const cause = 'suspendido por el usuario: imagen enviada al área de intercambio'
    if (pcb.state === 'READY_SUSPENDED' || pcb.state === 'BLOCKED_SUSPENDED') {
      if (pcb.waitingOn?.kind === 'swap') {
        this.emit('command', 'No se puede suspender: su imagen se está cargando', pcb.pid)
      } else {
        pcb.suspendedBy = 'user'
        this.emit('command', 'Permanecerá suspendido hasta que se reactive', pcb.pid)
      }
      return
    }
    if (pcb.state === 'TERMINATED') {
      this.emit('command', 'No se puede suspender un proceso terminado', pcb.pid)
      return
    }
    if (this.memory.free(pcb.pid)) {
      this.memCounters.swapOuts++
      this.writeSwapImage(pcb)
    }
    pcb.suspendedBy = 'user'
    switch (pcb.state) {
      case 'RUNNING':
        this.releaseCpu(pcb)
        this.transition(pcb, 'READY_SUSPENDED', cause)
        break
      case 'READY':
        this.scheduler.remove(pcb.pid)
        this.transition(pcb, 'READY_SUSPENDED', cause)
        break
      case 'NEW':
        pcb.admittedAt = this.now
        this.transition(pcb, 'READY_SUSPENDED', cause)
        break
      case 'BLOCKED':
        this.transition(pcb, 'BLOCKED_SUSPENDED', cause)
        break
    }
  }

  private activate(pcb: PCB): void {
    if (pcb.state === 'READY_SUSPENDED') {
      if (pcb.suspendedBy === 'user') {
        // El planificador de mediano plazo lo cargará en cuanto haya memoria.
        pcb.suspendedBy = 'memory'
        this.emit('command', 'Reactivado: se cargará en memoria en cuanto haya espacio', pcb.pid)
      } else {
        this.emit('command', 'Ya está esperando memoria para cargarse', pcb.pid)
      }
    } else if (pcb.state === 'BLOCKED_SUSPENDED') {
      const part = this.memory.allocate(pcb.pid, pcb.memoryKb)
      if (part) {
        // Sigue esperando su evento; la copia de la imagen ocupa el disco en segundo plano.
        this.swapInTransfer(pcb, part.size)
        pcb.suspendedBy = null
        pcb.loadedAt = this.now
        this.memCounters.swapIns++
        this.transition(pcb, 'BLOCKED', `reactivado: imagen cargada en ${fmtAddr(part.base)}`)
      } else {
        pcb.suspendedBy = 'memory'
        this.emit(
          'command',
          'Reactivado, pero no hay memoria: se cargará cuando termine su espera',
          pcb.pid
        )
      }
    } else {
      this.emit('command', 'Solo se reactivan procesos suspendidos', pcb.pid)
    }
  }

  // ───────────────────────────── órdenes externas ─────────────────────────────

  command(cmd: KernelCommand): void {
    switch (cmd.type) {
      case 'pause':
        this.running = false
        return
      case 'resume':
        this.running = true
        return
      case 'step':
        if (!this.running) this.tick()
        return
      case 'setSpeed':
        this.tickMs = clampTickMs(cmd.tickMs)
        return
      case 'reset':
        this.boot(this.scheduler.policy, this.memory.policy)
        return
      case 'setPolicy':
        this.scheduler.policy = cmd.policy
        this.emit('scheduler', `Política de planificación: ${POLICY_LABEL[cmd.policy]}`)
        return
      case 'setContextSwitch':
        this.contextSwitchTicks = clampInt(cmd.ticks, 0, MAX_CONTEXT_SWITCH_TICKS)
        this.emit('scheduler', `Costo de cambio de contexto: ${this.contextSwitchTicks} ticks`)
        return
      case 'setFitPolicy':
        this.memory.policy = cmd.policy
        this.emit('memory', `Política de colocación: ${FIT_LABEL[cmd.policy]}`)
        return
      case 'setAutoCompact':
        this.autoCompact = cmd.enabled
        this.emit('memory', `Compactación automática ${cmd.enabled ? 'activada' : 'desactivada'}`)
        return
      case 'compact':
        this.compact('solicitada por el usuario')
        return
      case 'setDeadlockPolicy':
        this.deadlockPolicy = cmd.policy
        this.emit(
          'deadlock',
          `Estrategia frente al interbloqueo: ${DEADLOCK_POLICY_LABEL[cmd.policy]}`
        )
        if (cmd.policy === 'IGNORE') this.deadlock = null
        this.grantPending()
        return
      case 'setAutoRecover':
        this.autoRecover = cmd.enabled
        this.emit('deadlock', `Recuperación automática ${cmd.enabled ? 'activada' : 'desactivada'}`)
        return
      case 'setRecoveryMethod':
        this.recovery = cmd.method
        this.emit(
          'deadlock',
          `Método de recuperación: ${cmd.method === 'kill' ? 'abortar a la víctima' : 'retroceso (rollback)'}`
        )
        return
      case 'detectDeadlock':
        this.checkDeadlock(true)
        return
      case 'recoverDeadlock':
        this.recover()
        return
      case 'setDiskPolicy':
        this.diskPolicy = cmd.policy
        this.devices.arm.policy = cmd.policy
        this.emit('file', `Planificación del disco: ${DISK_POLICY_LABEL[cmd.policy]}`)
        return
      case 'fsMkdir':
      case 'fsWriteText':
      case 'fsDelete':
      case 'fsWriteBinary':
        this.userFileOp(cmd)
        return
      case 'hwEvent':
        this.hardwareEvent(cmd.event)
        return
      case 'setRealDevice':
        this.realModes[cmd.device] = cmd.real
        this.applyDeviceModes()
        this.emit(
          'interrupt',
          `${DEVICE_LABEL[cmd.device]}: ${cmd.real ? 'conectado al hardware real' : 'simulado'}`
        )
        return
      case 'setUsbStrict':
        this.hw.usbStrict = cmd.enabled
        this.applyDeviceModes()
        this.emit(
          'interrupt',
          cmd.enabled
            ? 'Puerto USB: sin memoria USB real las transferencias esperan'
            : 'Puerto USB: sin memoria USB real las transferencias se simulan'
        )
        return
      case 'setUsbBackup':
        this.hw.usbBackup = cmd.enabled
        this.emit(
          'file',
          `Copia de respaldos a la memoria USB real ${cmd.enabled ? 'activada' : 'desactivada'}`
        )
        return
      case 'docUpdate':
        if (cmd.text === null) this.openDocs.delete(cmd.path)
        else this.openDocs.set(cmd.path, cmd.text)
        return
      case 'setAging':
        this.aging = cmd.enabled
        this.emit('scheduler', `Envejecimiento (aging) ${cmd.enabled ? 'activado' : 'desactivado'}`)
        return
      case 'setSyncEnabled': {
        const woke = this.sync.setGroupEnabled(cmd.group, cmd.enabled)
        this.emit(
          'sync',
          `Sincronización de «${this.sync.groupName(cmd.group)}» ${cmd.enabled ? 'activada' : 'desactivada'}`
        )
        for (const pid of woke) this.wakeFromSync(pid, 'sincronización desactivada')
        return
      }
      case 'spawn': {
        const spec = this.programs.find((p) => p.id === cmd.programId)
        if (spec) this.spawn(spec)
        else this.emit('command', `Programa desconocido: ${cmd.programId}`)
        return
      }
    }

    const pcb = this.procs.get(cmd.pid)
    if (!pcb) {
      this.emit('command', `No existe el proceso ${cmd.pid}`)
      return
    }
    switch (cmd.type) {
      case 'kill':
        this.emit('command', 'kill', pcb.pid)
        this.terminate(pcb, 'abortado por el usuario (kill)')
        return
      case 'setPriority':
        pcb.basePriority = pcb.priority = clampInt(cmd.priority, PRIORITY_MAX, PRIORITY_MIN)
        this.emit('command', `Prioridad cambiada a ${pcb.priority}`, pcb.pid)
        return
      case 'setQuantum':
        pcb.quantum = clampInt(cmd.quantum, 1, MAX_QUANTUM)
        this.emit('command', `Quantum cambiado a ${pcb.quantum} ticks`, pcb.pid)
        return
      case 'suspend':
        this.suspend(pcb)
        return
      case 'activate':
        this.activate(pcb)
        return
    }
  }

  // ───────────────────────────── consultas ─────────────────────────────

  process(pid: number): ProcessInfo | undefined {
    const pcb = this.procs.get(pid)
    return pcb && this.toInfo(pcb)
  }

  processes(): ProcessInfo[] {
    return [...this.procs.values()].map((p) => this.toInfo(p))
  }

  stats(): KernelStats {
    const all = [...this.procs.values()]
    const admitted = all.filter((p) => p.admittedAt !== null)
    const started = all.filter((p) => p.firstRun !== null)
    const finished = all.filter((p) => p.state === 'TERMINATED' && p.finishedAt !== null)
    const now = Math.max(1, this.now)
    return {
      busyTicks: this.counters.busy,
      idleTicks: this.counters.idle,
      csTicks: this.counters.cs,
      osTicks: this.counters.os,
      cpuUtilization: this.counters.busy / now,
      contextSwitches: this.counters.contextSwitches,
      finished: finished.length,
      throughput: finished.length / now,
      avgWait: avg(admitted.map((p) => p.waitTime)),
      avgResponse: avg(started.map((p) => p.firstRun! - p.arrival)),
      avgTurnaround: avg(finished.map((p) => p.finishedAt! - p.arrival))
    }
  }

  memoryInfo(): MemoryInfo {
    const m = this.memory
    const blocks: MemoryBlock[] = [{ base: 0, size: m.osKb, kind: 'os', pid: null }]
    for (const p of m.partitions()) {
      const pcb = this.procs.get(p.pid)
      blocks.push({
        base: p.base,
        size: p.size,
        kind: 'process',
        pid: p.pid,
        requested: p.requested,
        loading: pcb?.state === 'READY_SUSPENDED' && pcb.waitingOn?.kind === 'swap'
      })
    }
    for (const h of m.holes()) blocks.push({ base: h.base, size: h.size, kind: 'hole', pid: null })
    blocks.sort((a, b) => a.base - b.base)

    const outOfMemory = [...this.procs.values()].filter(
      (p) =>
        (p.state === 'READY_SUSPENDED' || p.state === 'BLOCKED_SUSPENDED') && !m.partitionOf(p.pid)
    )
    return {
      totalKb: m.totalKb,
      osKb: m.osKb,
      unitKb: m.unitKb,
      policy: m.policy,
      autoCompact: this.autoCompact,
      blocks,
      stats: { ...m.stats(), ...this.memCounters },
      swapped: outOfMemory.map((p) => ({ pid: p.pid, sizeKb: m.roundUp(p.memoryKb) })),
      waiting: outOfMemory
        .filter((p) => p.state === 'READY_SUSPENDED' && p.suspendedBy === 'memory')
        .sort((a, b) => a.priority - b.priority || a.pid - b.pid)
        .map((p) => ({
          pid: p.pid,
          sizeKb: m.roundUp(p.memoryKb),
          reason: p.memWait ?? (m.fitsAfterCompaction(p.memoryKb) ? 'fragmentation' : 'no-memory')
        })),
      lastCompaction: this.lastCompaction
    }
  }

  snapshot(): KernelSnapshot {
    return {
      tick: this.now,
      running: this.running,
      tickMs: this.tickMs,
      bootedAt: this.bootedAt,
      config: {
        policy: this.scheduler.policy,
        contextSwitchTicks: this.contextSwitchTicks,
        aging: this.aging,
        agingInterval: AGING_INTERVAL,
        starvationTicks: STARVATION_TICKS
      },
      cpu: { pid: this.runningPid, switchRemaining: this.switchRemaining },
      processes: this.processes(),
      readyQueue: this.scheduler.order(),
      devices: this.devices.info(),
      memory: this.memoryInfo(),
      resources: this.resourcesInfo(),
      disk: this.diskInfo(),
      hardware: { ...this.hw, openDocs: [...this.openDocs.keys()] },
      sync: this.sync.info(),
      gantt: this.gantt.tail(SNAPSHOT_GANTT),
      events: this.log.tail(SNAPSHOT_EVENTS),
      stats: this.stats(),
      transitionCounts: { ...this.transitionCounts }
    }
  }

  private toInfo(pcb: PCB): ProcessInfo {
    const part = this.memory.partitionOf(pcb.pid)
    const ov = pcb.overlay
    return {
      pid: pcb.pid,
      name: pcb.name,
      programId: pcb.programId,
      state: pcb.state,
      priority: pcb.priority,
      basePriority: pcb.basePriority,
      quantum: pcb.quantum,
      quantumUsed: pcb.quantumUsed,
      pc: pcb.pc,
      instruction: formatInstr(pcb.code[pcb.pc]),
      program: pcb.listing,
      burstRemaining: pcb.burstRemaining,
      memoryKb: pcb.memoryKb,
      arrival: pcb.arrival,
      admittedAt: pcb.admittedAt,
      firstRun: pcb.firstRun,
      finishedAt: pcb.finishedAt,
      cpuTime: pcb.cpuTime,
      waitTime: pcb.waitTime,
      blockedTime: pcb.blockedTime,
      readyStreak: pcb.readyStreak,
      maxReadyStreak: pcb.maxReadyStreak,
      ioCount: pcb.ioCount,
      contextSwitches: pcb.contextSwitches,
      waitingOn: pcb.waitingOn,
      exitReason: pcb.exitReason,
      memBase: part?.base ?? null,
      memSize: part?.size ?? 0,
      suspendedBy: pcb.suspendedBy,
      memWait: pcb.memWait,
      reg: pcb.reg,
      regVar: pcb.regVar,
      holds: this.sync.heldBy(pcb.pid),
      resources: this.resources.held(pcb.pid),
      maxClaim: this.resources.snapshotState().claims.get(pcb.pid) ?? {},
      rollbacks: pcb.rollbacks,
      overlay: ov && {
        rootKb: ov.rootKb,
        modules: Object.entries(ov.modules).map(([name, sizeKb]) => ({ name, sizeKb })),
        loaded: ov.loaded,
        pending: ov.pending
      }
    }
  }

  private pcb(pid: number): PCB {
    const pcb = this.procs.get(pid)
    if (!pcb) throw new Error(`PID ${pid} inexistente`)
    return pcb
  }

  private emit(
    kind: KernelEvent['kind'],
    message: string,
    pid?: number,
    level?: KernelEvent['level']
  ): void {
    this.log.push({ tick: this.now, kind, pid, message, ...(level ? { level } : {}) })
  }

  // ───────────────────────────── recursos e interbloqueo ─────────────────────────────

  vecText(v: Vec): string {
    return Object.entries(v)
      .filter(([, n]) => n > 0)
      .map(([r, n]) => (n === 1 ? this.resources.name(r) : `${n}× ${this.resources.name(r)}`))
      .join(' + ')
  }

  private holderText(want: Vec): string {
    const { allocation } = this.resources.snapshotState()
    const holders = new Set<number>()
    for (const r of Object.keys(want)) {
      for (const [pid, v] of allocation) if ((v[r] ?? 0) > 0) holders.add(pid)
    }
    return holders.size ? ` (lo tiene ${[...holders].map((p) => `PID ${p}`).join(', ')})` : ''
  }

  /** REQ: se concede, se rechaza o el proceso se bloquea, según la estrategia activa. */
  private requestResources(pcb: PCB, want: Vec): void {
    const policy = this.deadlockPolicy
    const verdict = this.resources.evaluate(pcb.pid, want, policy)
    const what = this.vecText(want)
    if (verdict === 'grant') {
      this.resources.grant(pcb.pid, want)
      this.emit('resource', `REQ: obtiene ${what}`, pcb.pid)
      return
    }
    if (verdict === 'exceeds-claim') {
      this.emit(
        'resource',
        `REQ ${what} rechazada: excede la necesidad máxima que declaró`,
        pcb.pid,
        'warning'
      )
      return
    }
    let all = want
    if (policy === 'PREVENT' && this.resources.holdsAny(pcb.pid)) {
      // Se rompe la condición de "retención y espera": suelta lo que tiene y pedirá todo junto.
      const held = this.resources.releaseAll(pcb.pid)
      this.dlStats.preventiveReleases++
      all = { ...held }
      for (const [r, n] of Object.entries(want)) all[r] = (all[r] ?? 0) + n
      this.emit(
        'resource',
        `Prevención: no puede obtener ${what}${this.holderText(want)}; suelta ${this.vecText(held)} ` +
          `y esperará a obtener ${this.vecText(all)} a la vez`,
        pcb.pid
      )
    }
    const unsafe = verdict === 'unsafe'
    if (unsafe) {
      this.dlStats.unsafeDenials++
      this.emit(
        'resource',
        `Banquero: conceder ${what} dejaría el sistema en un estado inseguro; el proceso espera`,
        pcb.pid
      )
    } else if (policy !== 'PREVENT' || all === want) {
      this.emit(
        'resource',
        `REQ ${what}: no disponible${this.holderText(want)}, se bloquea`,
        pcb.pid
      )
    }
    this.resources.pending.push({ pid: pcb.pid, want: all, since: this.now, unsafe })
    pcb.waitingOn = { kind: 'resource', want: all, unsafe }
    this.block(pcb, `espera ${this.vecText(all)}`)
    this.grantPending()
  }

  /** Revisa las solicitudes pendientes (FIFO) y concede las que la estrategia permita. */
  private grantPending(): void {
    let progress = true
    while (progress) {
      progress = false
      for (const req of [...this.resources.pending]) {
        const verdict = this.resources.evaluate(req.pid, req.want, this.deadlockPolicy)
        const pcb = this.pcb(req.pid)
        if (verdict === 'grant') {
          this.resources.grant(req.pid, req.want)
          this.resources.pending = this.resources.pending.filter((p) => p !== req)
          this.emit('resource', `Se le concede ${this.vecText(req.want)}`, req.pid)
          if (pcb.waitingOn?.kind === 'resource')
            this.wake(pcb, `obtiene ${this.vecText(req.want)}`)
          progress = true
        } else {
          req.unsafe = verdict === 'unsafe'
          if (pcb.waitingOn?.kind === 'resource')
            pcb.waitingOn = { ...pcb.waitingOn, unsafe: req.unsafe }
        }
      }
    }
  }

  /** Estado combinado de recursos y mutex para el algoritmo de detección. */
  private allocationState(): AllocationState {
    const st = this.resources.snapshotState()
    const resources = [...this.resources.ids]
    const available: Vec = { ...st.available }
    const allocation = st.allocation
    const request = new Map<number, Vec>()
    for (const p of this.resources.pending) request.set(p.pid, { ...p.want })
    for (const m of this.sync.info().mutexes) {
      const id = `mutex:${m.name}`
      resources.push(id)
      available[id] = m.owner === null ? 1 : 0
      if (m.owner !== null) allocation.set(m.owner, { ...(allocation.get(m.owner) ?? {}), [id]: 1 })
      for (const pid of m.queue) request.set(pid, { ...(request.get(pid) ?? {}), [id]: 1 })
    }
    return { resources, available, allocation, request }
  }

  /** Ejecuta el algoritmo de detección (cada tick, salvo con la estrategia del avestruz). */
  private checkDeadlock(manual = false): void {
    if (this.deadlockPolicy === 'IGNORE' && !manual) return
    const state = this.allocationState()
    const pids = detectDeadlock(state)
    if (pids.length === 0) {
      if (this.deadlock) this.emit('deadlock', 'El interbloqueo se ha resuelto')
      else if (manual) this.emit('deadlock', 'Detección: no hay interbloqueo')
      this.deadlock = null
      return
    }
    if (!this.deadlock || this.deadlock.pids.join() !== pids.join()) {
      const edges: [string, string][] = []
      const resources = new Set<string>()
      for (const pid of pids) {
        for (const [r, n] of Object.entries(state.request.get(pid) ?? {})) {
          if (n > 0) {
            edges.push([`P${pid}`, r])
            resources.add(r)
          }
        }
        for (const [r, n] of Object.entries(state.allocation.get(pid) ?? {})) {
          if (n > 0) {
            edges.push([r, `P${pid}`])
            resources.add(r)
          }
        }
      }
      const cycle = findCycle(edges) ?? []
      this.deadlock = { pids, resources: [...resources], since: this.now, cycle }
      this.dlStats.deadlocks++
      const label = (n: string): string =>
        n.startsWith('P')
          ? `PID ${n.slice(1)}`
          : n.startsWith('mutex:')
            ? n.slice(6)
            : this.resources.name(n)
      this.emit(
        'deadlock',
        `Interbloqueo detectado: ${pids.map((p) => `PID ${p}`).join(', ')} en espera circular` +
          (cycle.length ? ` (${[...cycle, cycle[0]].map(label).join(' → ')})` : ''),
        undefined,
        'critical'
      )
    }
    if (
      this.autoRecover &&
      this.deadlockPolicy === 'DETECT' &&
      this.now - this.deadlock.since >= AUTO_RECOVERY_DELAY
    ) {
      this.recover()
    }
  }

  /** Rompe el interbloqueo eligiendo una víctima: la de menor prioridad y menos trabajo hecho. */
  private recover(): void {
    if (!this.deadlock) {
      this.emit('deadlock', 'No hay un interbloqueo que recuperar')
      return
    }
    const victim = this.deadlock.pids
      .map((p) => this.pcb(p))
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          a.rollbacks - b.rollbacks ||
          a.cpuTime - b.cpuTime ||
          b.pid - a.pid
      )[0]
    this.dlStats.recoveries++
    this.deadlock = null
    if (this.recovery === 'kill') {
      this.emit(
        'deadlock',
        `Recuperación: se aborta a PID ${victim.pid} (${victim.name}), la víctima de menor costo`,
        victim.pid,
        'warning'
      )
      this.terminate(victim, 'abortado para romper un interbloqueo')
    } else {
      this.rollback(victim)
    }
    this.grantPending()
  }

  /** Expropiación con retroceso: la víctima pierde sus recursos y reinicia su programa. */
  private rollback(pcb: PCB): void {
    const held = this.resources.releaseAll(pcb.pid)
    this.resources.pending = this.resources.pending.filter((p) => p.pid !== pcb.pid)
    const { released, woke } = this.sync.removeProcess(pcb.pid)
    pcb.pc = 0
    pcb.burstRemaining = null
    pcb.loopCounters.clear()
    pcb.reg = pcb.regVar = pcb.regLoaded = null
    pcb.rollbacks++
    const lost = [this.vecText(held), ...released.map((m) => `mutex «${m}»`)]
      .filter(Boolean)
      .join(', ')
    this.emit(
      'deadlock',
      `Recuperación: se expropia a PID ${pcb.pid} (${pcb.name}) ${lost ? `(${lost}) ` : ''}y retrocede al inicio de su programa`,
      pcb.pid,
      'warning'
    )
    pcb.waitingOn = null
    if (pcb.state === 'BLOCKED') {
      this.transition(pcb, 'READY', 'retroceso (rollback) tras un interbloqueo')
      this.scheduler.enqueue(pcb.pid)
    } else if (pcb.state === 'BLOCKED_SUSPENDED') {
      if (pcb.suspendedBy === 'memory') pcb.waitingOn = { kind: 'memory' }
      this.transition(pcb, 'READY_SUSPENDED', 'retroceso (rollback) tras un interbloqueo')
    }
    for (const w of woke) this.wakeFromSync(w.pid, `obtiene el mutex «${w.name}»`)
  }

  resourcesInfo(): ResourcesInfo {
    const st = this.resources.snapshotState()
    const mutexes = this.sync.info().mutexes
    const allocation: ResourcesInfo['allocation'] = []
    for (const [pid, v] of st.allocation) {
      for (const [resource, count] of Object.entries(v)) allocation.push({ pid, resource, count })
    }
    const requests: ResourcesInfo['requests'] = []
    for (const p of this.resources.pending) {
      for (const [resource, count] of Object.entries(p.want)) {
        requests.push({ pid: p.pid, resource, count, unsafe: p.unsafe })
      }
    }
    for (const m of mutexes) {
      if (m.owner !== null) allocation.push({ pid: m.owner, resource: `mutex:${m.name}`, count: 1 })
      for (const pid of m.queue) {
        requests.push({ pid, resource: `mutex:${m.name}`, count: 1, unsafe: false })
      }
    }
    const claims: ResourcesInfo['claims'] = []
    for (const [pid, v] of st.claims) {
      for (const [resource, count] of Object.entries(v)) claims.push({ pid, resource, count })
    }
    return {
      policy: this.deadlockPolicy,
      autoRecover: this.autoRecover,
      recovery: this.recovery,
      resources: [
        ...this.resources.defs.map((d) => ({
          id: d.id,
          name: d.name,
          total: st.total[d.id],
          available: st.available[d.id],
          kind: 'resource' as const
        })),
        ...mutexes.map((m) => ({
          id: `mutex:${m.name}`,
          name: m.name,
          total: 1,
          available: m.owner === null ? 1 : 0,
          kind: 'mutex' as const
        }))
      ],
      allocation,
      requests,
      claims,
      deadlock: this.deadlock,
      safety: this.resources.safety(),
      stats: { ...this.dlStats }
    }
  }

  // ───────────────────────────── hardware real ─────────────────────────────

  /** Efectos pendientes para el host (escrituras en la USB real, impresiones). */
  drainEffects(): KernelEffect[] {
    const out = this.effects
    this.effects = []
    return out
  }

  private applyDeviceModes(): void {
    this.devices.setMode('teclado', this.realModes.teclado ? 'event' : 'timed')
    this.devices.setMode('raton', this.realModes.raton ? 'event' : 'timed')
    // USB real: con una memoria conectada (o si se exige) la transferencia depende del medio real.
    const usbReal = this.realModes.usb && (this.hw.storage !== null || this.hw.usbStrict)
    this.devices.setMode('usb', usbReal ? 'media' : 'timed')
    this.devices.setMedium('usb', this.hw.storage !== null)
    this.hw.real = this.realModes.teclado || this.realModes.raton || this.realModes.usb
    this.hw.realModes = { ...this.realModes }
  }

  /** Interrupciones y avisos del hardware real que entrega el HAL. */
  private hardwareEvent(e: HwEvent): void {
    switch (e.kind) {
      case 'key': {
        const prefer = e.target
          ? [...this.procs.values()].find(
              (p) => p.programId === e.target && p.state !== 'TERMINATED'
            )?.pid
          : undefined
        const pid = this.devices.signal('teclado', prefer)
        if (pid !== null) {
          this.emit('interrupt', `IRQ Teclado (real): tecla «${e.key}» para PID ${pid}`, pid)
        }
        return
      }
      case 'mouse': {
        const pid = this.devices.signal('raton')
        if (pid !== null) {
          this.emit(
            'interrupt',
            `IRQ Ratón (real): ${e.action === 'click' ? 'clic' : 'movimiento'} para PID ${pid}`,
            pid
          )
        }
        return
      }
      case 'usbAttach':
      case 'usbDetach':
        this.emit(
          'interrupt',
          `IRQ USB: se ${e.kind === 'usbAttach' ? 'conectó' : 'desconectó'} «${e.name}» (${e.type})`,
          undefined,
          'info'
        )
        return
      case 'storageAttach':
        this.hw.storage = e.storage
        this.applyDeviceModes()
        this.emit(
          'interrupt',
          `Memoria USB «${e.storage.label}» montada en ${e.storage.mount}: el Puerto USB tiene medio`,
          undefined,
          'warning'
        )
        return
      case 'storageDetach':
        this.hw.storage = null
        this.applyDeviceModes()
        this.emit(
          'interrupt',
          `Memoria USB «${e.label}» retirada: las transferencias USB quedan en espera`,
          undefined,
          'warning'
        )
        return
      case 'power':
        this.powerEvent(e.ac, e.battery)
        return
      case 'netChange':
        this.emit(
          'interrupt',
          `IRQ ${e.device === 'wifi' ? 'Red' : 'Bluetooth'}: ${e.text}`,
          undefined,
          'info'
        )
        return
      case 'usbWritten':
        if (e.error) {
          this.emit(
            'file',
            `No se pudo escribir en la memoria USB: ${e.error}`,
            undefined,
            'warning'
          )
        } else {
          this.hw.lastBackup = e.path
          this.emit(
            'file',
            `Respaldo copiado a la memoria USB real: ${e.path} (${e.bytes} B)`,
            undefined,
            'info'
          )
        }
        return
      case 'printed':
        if (e.error) {
          this.emit('file', `Falló la impresión: ${e.error}`, undefined, 'warning')
        } else {
          this.hw.lastPrint = e.path
          this.emit('file', `Trabajo impreso como PDF: ${e.path}`, undefined, 'info')
        }
        return
    }
  }

  /** Política de energía: sin cargador y con poca batería, el reloj del sistema se ralentiza. */
  private powerEvent(ac: boolean | null, battery: number | null): void {
    if (ac !== null && this.hw.ac !== null && ac !== this.hw.ac) {
      this.emit(
        'interrupt',
        ac
          ? 'IRQ Energía: cargador conectado'
          : `IRQ Energía: cargador desconectado (batería ${battery ?? '?'} %)`,
        undefined,
        'info'
      )
    }
    this.hw.ac = ac
    this.hw.battery = battery
    const low = ac === false && battery !== null && battery < LOW_BATTERY
    if (low && !this.hw.lowPower) {
      this.hw.lowPower = true
      this.normalTickMs = this.tickMs
      this.tickMs = clampTickMs(Math.max(this.tickMs * 2, 500))
      this.emit(
        'scheduler',
        `Batería baja (${battery} %): modo de bajo consumo, el reloj pasa a ${this.tickMs} ms por tick`,
        undefined,
        'warning'
      )
    } else if (!low && this.hw.lowPower) {
      this.hw.lowPower = false
      this.tickMs = this.normalTickMs ?? this.tickMs
      this.normalTickMs = null
      this.emit(
        'scheduler',
        `Fin del modo de bajo consumo: el reloj vuelve a ${this.tickMs} ms por tick`
      )
    }
  }

  /** Al terminar su transferencia USB, el proceso copia a la memoria real el último archivo que leyó. */
  private backupToUsb(pcb: PCB): void {
    if (!this.realModes.usb || !this.hw.storage || !this.hw.usbBackup) return
    const src = pcb.lastRead && this.fs.exists(pcb.lastRead) ? pcb.lastRead : null
    const content = src
      ? new TextDecoder().decode(this.fs.readFile(src).bytes)
      : `Respaldo de guiñanOS generado por ${pcb.name} (PID ${pcb.pid}) en el tick ${this.now}.\n`
    const fileName = `respaldo_${String(++this.backupSeq).padStart(3, '0')}_${src ? basename(src) : 'sistema.txt'}`
    this.effects.push({
      type: 'usbWrite',
      pid: pcb.pid,
      mount: this.hw.storage.mount,
      fileName,
      content
    })
    this.emit(
      'file',
      `Copiando ${src ?? 'un respaldo'} a ${this.hw.storage.mount}/${USB_BACKUP_DIR}/${fileName}`,
      pcb.pid
    )
  }

  /** Al terminar la E/S de impresora, el trabajo (el último archivo leído) se imprime de verdad. */
  private printJob(pcb: PCB): void {
    const src = pcb.lastRead && this.fs.exists(pcb.lastRead) ? pcb.lastRead : null
    const content = src
      ? new TextDecoder().decode(this.fs.readFile(src).bytes)
      : `Página de prueba de guiñanOS (PID ${pcb.pid}, tick ${this.now}).`
    const jobId = ++this.printSeq
    this.effects.push({
      type: 'print',
      pid: pcb.pid,
      jobId,
      title: src ? basename(src) : 'Página de prueba',
      owner: pcb.name,
      content
    })
    this.emit('file', `Trabajo de impresión #${jobId}: ${src ?? 'página de prueba'}`, pcb.pid)
  }

  // ───────────────────────────── disco ─────────────────────────────

  private secs(): number {
    return Math.floor((this.opts.now ?? Date.now)() / 1000)
  }

  /** Monta guiñanFS; si el disco no tiene formato, lo formatea con el contenido inicial. */
  private mountDisk(): void {
    const mounted = GuinanFS.mount(this.disk)
    if (mounted) {
      this.fs = mounted
      this.emit('file', `Disco montado (montaje n.º ${mounted.mountCount}) · ${this.diskLabel()}`)
      return
    }
    this.fs = GuinanFS.format(this.disk, this.secs())
    seedFileSystem(this.fs, this.secs())
    this.emit('file', `Disco formateado con guiñanFS (asignación indexada) · ${this.diskLabel()}`)
  }

  private diskLabel(): string {
    const mb = (this.fs.blockCount * this.fs.blockSize) / 2 ** 20
    return `${this.disk.path ?? 'disco en memoria'} (${mb} MB)`
  }

  cylinderOf(block: number): number {
    return Math.min(CYLINDERS - 1, Math.floor((block * CYLINDERS) / this.fs.blockCount))
  }

  /** Bloquea al proceso hasta que el brazo del disco atienda su lectura o escritura. */
  private fileIo(
    pcb: PCB,
    op: 'read' | 'write',
    path: string,
    blocks: number[],
    bytes: number
  ): void {
    const kb = Math.max(1, Math.ceil(bytes / 1024))
    const cylinder = this.cylinderOf(blocks[0] ?? 0)
    this.devices.diskRequest({
      pid: pcb.pid,
      tag: 'file',
      cylinder,
      transferTicks: Math.max(1, Math.ceil(kb / DISK_KB_PER_TICK)),
      kb,
      label: `${op === 'read' ? 'FREAD' : 'FWRITE'} ${basename(path)}`,
      since: this.now
    })
    if (op === 'read') {
      this.io.reads++
      this.io.kbRead += kb
    } else {
      this.io.writes++
      this.io.kbWritten += kb
    }
    pcb.ioCount++
    pcb.waitingOn = { kind: 'file', op, path }
    const shown = blocks.slice(0, 4).join(', ') + (blocks.length > 4 ? '…' : '')
    this.emit(
      'syscall',
      `Llamada al sistema: ${op === 'read' ? 'lee' : 'escribe'} ${path} · ${kb} KB · bloques ${shown} · cilindro ${cylinder}`,
      pcb.pid
    )
    this.block(
      pcb,
      `espera al disco (${op === 'read' ? 'lectura' : 'escritura'} de ${basename(path)})`
    )
  }

  private fileContent(pcb: PCB, path: string, kb: number): Uint8Array {
    // Si el documento está abierto en el Editor, el proceso guarda lo que el usuario escribió.
    const doc = this.openDocs.get(path)
    if (doc !== undefined) return new TextEncoder().encode(doc)
    if (/\.(txt|c|md|log)$/.test(path)) {
      return textContent(
        `${basename(path)} — guardado por ${pcb.name}`,
        kb,
        `Escrito por PID ${pcb.pid} (${pcb.name}) en el tick ${this.now}.`
      )
    }
    return new Uint8Array(kb * 1024).fill(pcb.pid)
  }

  /** Escribe la imagen del proceso en el área de intercambio (datos reales en el disco). */
  private writeSwapImage(pcb: PCB): void {
    const kb = this.memory.roundUp(pcb.memoryKb)
    const blocks = this.fs.swapOut(pcb.pid, new Uint8Array(kb * 1024).fill(pcb.pid & 0xff))
    if (!blocks) {
      this.emit('memory', 'El área de intercambio está llena', pcb.pid, 'warning')
      return
    }
    this.devices.diskRequest({
      pid: pcb.pid,
      tag: 'swapout',
      cylinder: this.cylinderOf(blocks[0]),
      transferTicks: Math.max(1, Math.ceil(kb / DISK_KB_PER_TICK)),
      kb,
      label: `swap out PID ${pcb.pid}`,
      since: this.now
    })
  }

  /** Lee la imagen del área de intercambio; devuelve los ticks de transferencia. */
  private swapInTransfer(pcb: PCB, kb: number): number {
    const { blocks } = this.fs.swapIn(pcb.pid)
    const ticks = Math.max(1, Math.ceil(kb / DISK_KB_PER_TICK))
    this.devices.diskRequest({
      pid: pcb.pid,
      tag: 'swap',
      cylinder: this.cylinderOf(blocks[0] ?? this.fs.swapStart),
      transferTicks: ticks,
      kb,
      label: `swap in PID ${pcb.pid}`,
      since: this.now
    })
    return ticks
  }

  /** Operaciones de archivos pedidas desde el Finder (las hace el kernel de inmediato). */
  private userFileOp(
    cmd: Extract<KernelCommand, { type: 'fsMkdir' | 'fsWriteText' | 'fsDelete' | 'fsWriteBinary' }>
  ): void {
    try {
      if (cmd.type === 'fsMkdir') {
        this.fs.mkdir(cmd.path, this.secs())
        this.emit('file', `Carpeta creada: ${cmd.path}`)
      } else if (cmd.type === 'fsWriteBinary') {
        const bytes = fromBase64(cmd.base64)
        this.fs.writeFile(cmd.path, bytes, this.secs())
        this.emit('file', `Archivo guardado: ${cmd.path} (${Math.ceil(bytes.length / 1024)} KB)`)
      } else if (cmd.type === 'fsWriteText') {
        const blocks = this.fs.writeFile(cmd.path, new TextEncoder().encode(cmd.text), this.secs())
        this.emit('file', `Archivo guardado: ${cmd.path} (bloques ${blocks.join(', ') || '—'})`)
      } else {
        this.fs.remove(cmd.path, this.secs())
        this.emit('file', `Eliminado: ${cmd.path}`)
      }
    } catch (e) {
      if (!(e instanceof FsError)) throw e
      this.emit('file', `No se pudo completar: ${e.message}`, undefined, 'warning')
    }
  }

  query(q: KernelQuery): unknown {
    switch (q.type) {
      case 'eventLog':
        return [...this.log.all()]
      case 'fileInfo': {
        const entry = this.fs.stat(q.path)
        if (!entry) return null
        const loc = this.fs.blocksOf(q.path)!
        let preview: string | null = null
        if (entry.type === 'file' && /\.(txt|c|md|log)$/.test(q.path)) {
          preview = new TextDecoder().decode(this.fs.readFile(q.path, 4096).bytes)
        }
        let image: string | null = null
        if (entry.type === 'file' && /\.png$/i.test(q.path) && entry.size <= 2 * 1024 * 1024) {
          const bytes = this.fs.readFile(q.path).bytes
          if (bytes[0] === 0x89 && bytes[1] === 0x50)
            image = `data:image/png;base64,${toBase64(bytes)}`
        }
        const details: FileDetails = {
          entry,
          indexBlock: loc.indexBlock,
          blocks: loc.blocks,
          preview,
          image
        }
        return details
      }
    }
  }

  diskInfo(): DiskInfo {
    const arm = this.devices.arm
    const st = arm.stats
    const req = (r: (typeof arm.queue)[number]) => ({
      pid: r.pid,
      tag: r.tag,
      label: r.label,
      cylinder: r.cylinder,
      kb: r.kb,
      since: r.since
    })
    return {
      path: this.disk.path,
      blockSize: this.fs.blockSize,
      blockCount: this.fs.blockCount,
      cylinders: CYLINDERS,
      dataStart: this.fs.dataStart,
      swapStart: this.fs.swapStart,
      formattedAt: this.fs.formattedAt,
      mountCount: this.fs.mountCount,
      usage: this.fs.usage(),
      bitmap: this.fs.bitmapHex(),
      files: this.fs.tree(),
      arm: {
        policy: arm.policy,
        head: Math.round(arm.headPosition()),
        direction: arm.dir,
        current: arm.current && {
          ...req(arm.current.req),
          remaining: arm.current.remaining,
          path: arm.current.path,
          from: arm.current.from
        },
        queue: arm.queue.map(req),
        stats: {
          totalMovement: st.totalMovement,
          served: st.served,
          avgSeek: st.served ? st.totalMovement / st.served : 0,
          avgWait: st.served ? st.totalWait / st.served : 0,
          maxWait: st.maxWait
        },
        history: arm.history.slice(-30)
      },
      io: { ...this.io }
    }
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function avg(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)))
}

function clampTickMs(ms: number): number {
  return clampInt(ms, MIN_TICK_MS, MAX_TICK_MS)
}
