// Contrato de comunicación entre el kernel (worker), el proceso main de Electron y la UI.
import type {
  CpuInfo,
  DeviceInfo,
  GanttSlot,
  KernelConfig,
  KernelEvent,
  KernelStats,
  FitPolicy,
  MemoryInfo,
  DeadlockPolicy,
  DiskInfo,
  DiskPolicy,
  FileDetails,
  HardwareInfo,
  HwEvent,
  HwState,
  KernelEffect,
  ProcessInfo,
  RecoveryMethod,
  ResourcesInfo,
  SchedulerPolicy,
  SyncInfo,
  TransitionKey
} from './kernelTypes'

/** Estado del kernel que se publica a la UI. */
export interface KernelSnapshot {
  tick: number
  running: boolean
  /** Milisegundos reales que dura un tick simulado. */
  tickMs: number
  /** Marca de tiempo real (ms) en la que arrancó el kernel. */
  bootedAt: number
  config: KernelConfig
  cpu: CpuInfo
  processes: ProcessInfo[]
  /** PIDs listos en el orden en que el planificador los elegiría. */
  readyQueue: number[]
  devices: DeviceInfo[]
  memory: MemoryInfo
  sync: SyncInfo
  resources: ResourcesInfo
  disk: DiskInfo
  hardware: HardwareInfo
  gantt: GanttSlot[]
  events: KernelEvent[]
  stats: KernelStats
  /** Veces que ha ocurrido cada transición de estado desde el arranque. */
  transitionCounts: Partial<Record<TransitionKey, number>>
}

/** Órdenes que la UI (o el HAL) envía al kernel. */
export type KernelCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'reset' }
  | { type: 'setSpeed'; tickMs: number }
  | { type: 'setPolicy'; policy: SchedulerPolicy }
  | { type: 'setContextSwitch'; ticks: number }
  | { type: 'kill'; pid: number }
  | { type: 'setPriority'; pid: number; priority: number }
  | { type: 'setQuantum'; pid: number; quantum: number }
  | { type: 'suspend'; pid: number }
  | { type: 'activate'; pid: number }
  | { type: 'spawn'; programId: string }
  | { type: 'setFitPolicy'; policy: FitPolicy }
  | { type: 'setAutoCompact'; enabled: boolean }
  | { type: 'compact' }
  | { type: 'setSyncEnabled'; group: string; enabled: boolean }
  | { type: 'setDeadlockPolicy'; policy: DeadlockPolicy }
  | { type: 'setAutoRecover'; enabled: boolean }
  | { type: 'setRecoveryMethod'; method: RecoveryMethod }
  | { type: 'recoverDeadlock' }
  | { type: 'detectDeadlock' }
  | { type: 'setAging'; enabled: boolean }
  | { type: 'setDiskPolicy'; policy: DiskPolicy }
  | { type: 'fsMkdir'; path: string }
  | { type: 'fsWriteText'; path: string; text: string }
  | { type: 'fsDelete'; path: string }
  | { type: 'fsWriteBinary'; path: string; base64: string }
  | { type: 'hwEvent'; event: HwEvent }
  | { type: 'setRealDevice'; device: 'teclado' | 'raton' | 'usb'; real: boolean }
  | { type: 'setUsbBackup'; enabled: boolean }
  | { type: 'setUsbStrict'; enabled: boolean }
  | { type: 'docUpdate'; path: string; text: string | null }

/** Consultas que esperan respuesta (por ejemplo, leer un archivo del disco). */
export type KernelQuery = { type: 'fileInfo'; path: string } | { type: 'eventLog' }

export type { HwState }

/** Acciones reales de red y Bluetooth que pide la interfaz. */
export type NetAction =
  | { type: 'refresh' }
  | { type: 'wifiPower'; on: boolean }
  | { type: 'wifiScan' }
  | { type: 'wifiConnect'; ssid: string; password?: string }
  | { type: 'wifiDisconnect' }
  | { type: 'btPower'; on: boolean }
  | { type: 'btScan' }
  | { type: 'btConnect'; mac: string; connect: boolean }

export interface QueryResults {
  fileInfo: FileDetails | null
  /** Toda la bitácora del kernel (hasta 5000 eventos). */
  eventLog: KernelEvent[]
}

/** Mensajes que el worker del kernel envía al proceso main. */
export type WorkerMessage =
  | { type: 'snapshot'; snapshot: KernelSnapshot }
  | { type: 'queryResult'; id: number; result: unknown }
  | { type: 'effect'; effect: KernelEffect }

/** Mensajes que el proceso main envía al worker del kernel. */
export type WorkerRequest =
  { type: 'command'; command: KernelCommand } | { type: 'query'; id: number; query: KernelQuery }

export const IPC = {
  snapshot: 'kernel:snapshot',
  command: 'kernel:command',
  query: 'kernel:query',
  hardware: 'hw:state',
  openPath: 'system:open-path',
  saveExport: 'system:save-export',
  net: 'net:action',
  quit: 'system:quit',
  toggleFullscreen: 'system:toggle-fullscreen'
} as const

export const MIN_TICK_MS = 20
export const MAX_TICK_MS = 2000
