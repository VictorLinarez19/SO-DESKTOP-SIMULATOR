// Tipos del kernel que también consume la interfaz gráfica.

/** Modelo de 7 estados (Stallings): incluye los dos estados suspendidos. */
export type ProcState =
  'NEW' | 'READY' | 'RUNNING' | 'BLOCKED' | 'READY_SUSPENDED' | 'BLOCKED_SUSPENDED' | 'TERMINATED'

export const STATE_LABEL: Record<ProcState, string> = {
  NEW: 'Nuevo',
  READY: 'Listo',
  RUNNING: 'Ejecución',
  BLOCKED: 'Bloqueado',
  READY_SUSPENDED: 'Listo/Suspendido',
  BLOCKED_SUSPENDED: 'Bloqueado/Suspendido',
  TERMINATED: 'Terminado'
}

/**
 * FCFS: sin expropiación ni quantum.
 * RR: cola única, cada proceso con su propio quantum.
 * PRIORITY_RR: expropiativo por prioridad; Round Robin entre procesos de igual prioridad.
 */
export type SchedulerPolicy = 'FCFS' | 'RR' | 'PRIORITY_RR'

/**
 * Estrategias frente al interbloqueo:
 *  IGNORE  algoritmo del avestruz: no se hace nada
 *  DETECT  se detecta (y se recupera, manual o automáticamente)
 *  AVOID   evitación con el algoritmo del banquero
 *  PREVENT prevención: si una solicitud no puede atenderse, el proceso suelta todo lo
 *          que retiene y espera a obtenerlo todo junto (rompe la retención y espera)
 */
export type DeadlockPolicy = 'IGNORE' | 'DETECT' | 'AVOID' | 'PREVENT'

export const DEADLOCK_POLICY_LABEL: Record<DeadlockPolicy, string> = {
  IGNORE: 'Ignorar (avestruz)',
  DETECT: 'Detectar y recuperar',
  AVOID: 'Evitar (banquero)',
  PREVENT: 'Prevenir (sin retención y espera)'
}

/** Algoritmos de planificación del brazo del disco. */
export type DiskPolicy = 'FCFS' | 'SSTF' | 'SCAN' | 'CSCAN' | 'LOOK' | 'CLOOK'

export const DISK_POLICY_LABEL: Record<DiskPolicy, string> = {
  FCFS: 'FCFS',
  SSTF: 'SSTF (menor búsqueda)',
  SCAN: 'SCAN (elevador)',
  CSCAN: 'C-SCAN',
  LOOK: 'LOOK',
  CLOOK: 'C-LOOK'
}

/** Recuperación: abortar a la víctima o quitarle sus recursos y reiniciarla (rollback). */
export type RecoveryMethod = 'kill' | 'rollback'

export const POLICY_LABEL: Record<SchedulerPolicy, string> = {
  FCFS: 'FCFS (primero en llegar)',
  RR: 'Round Robin',
  PRIORITY_RR: 'Prioridades + Round Robin'
}

/** Políticas de colocación para particiones dinámicas. */
export type FitPolicy = 'FIRST' | 'BEST' | 'WORST' | 'NEXT'

export const FIT_LABEL: Record<FitPolicy, string> = {
  FIRST: 'Primer ajuste',
  BEST: 'Mejor ajuste',
  WORST: 'Peor ajuste',
  NEXT: 'Siguiente ajuste'
}

/** Prioridad 0 = la más alta, 9 = la más baja (convención de Silberschatz). */
export const PRIORITY_MAX = 0
export const PRIORITY_MIN = 9

export const DEVICE_IDS = [
  'pantalla',
  'teclado',
  'raton',
  'disco',
  'red',
  'audio',
  'camara',
  'impresora',
  'usb'
] as const
export type DeviceId = (typeof DEVICE_IDS)[number]

export const DEVICE_LABEL: Record<DeviceId, string> = {
  pantalla: 'Pantalla',
  teclado: 'Teclado',
  raton: 'Ratón',
  disco: 'Disco duro',
  red: 'Red',
  audio: 'Audio',
  camara: 'Cámara',
  impresora: 'Impresora',
  usb: 'Puerto USB'
}

/** Qué espera un proceso que no puede ejecutarse. */
export type WaitReason =
  | { kind: 'io'; device: DeviceId }
  | { kind: 'timer'; until: number }
  /** Suspendido esperando que haya memoria para volver a cargarlo. */
  | { kind: 'memory' }
  /** Su imagen se está copiando del área de intercambio a memoria. */
  | { kind: 'swap' }
  /** Carga de un módulo de recubrimiento desde disco. */
  | { kind: 'overlay'; module: string }
  /** Esperando un semáforo (WAIT) o un mutex (LOCK). */
  | { kind: 'sync'; object: string; op: 'WAIT' | 'LOCK' }
  /** Lectura o escritura de un archivo en el disco. */
  | { kind: 'file'; op: 'read' | 'write'; path: string }
  /** Solicitud de recursos (REQ) que aún no se concede. */
  | { kind: 'resource'; want: Record<string, number>; unsafe: boolean }

/** Tipo de trabajo que un controlador de dispositivo realiza para un proceso. */
export type IoTag = 'io' | 'swap' | 'swapout' | 'overlay' | 'file'

/** Por qué un proceso suspendido está fuera de memoria. */
export type SuspendCause = 'user' | 'memory'

export interface OverlayInfo {
  rootKb: number
  modules: { name: string; sizeKb: number }[]
  loaded: string | null
  /** Módulo que se está cargando desde disco. */
  pending: string | null
}

/** Bloque de control de proceso tal como lo ve la UI. */
export interface ProcessInfo {
  pid: number
  name: string
  programId: string
  state: ProcState
  priority: number
  basePriority: number
  quantum: number
  quantumUsed: number
  pc: number
  /** Texto de la instrucción actual del programa. */
  instruction: string
  /** Código del programa, con la etiqueta que precede a cada instrucción (si la hay). */
  program: { text: string; label?: string }[]
  burstRemaining: number | null
  memoryKb: number
  arrival: number
  admittedAt: number | null
  firstRun: number | null
  finishedAt: number | null
  cpuTime: number
  waitTime: number
  blockedTime: number
  /** Ticks consecutivos en Listo sin obtener CPU (base para detectar inanición). */
  readyStreak: number
  maxReadyStreak: number
  ioCount: number
  contextSwitches: number
  waitingOn: WaitReason | null
  exitReason: string | null
  /** Registro base y tamaño de su partición (null si no está en memoria). */
  memBase: number | null
  memSize: number
  suspendedBy: SuspendCause | null
  /** Si espera memoria: por fragmentación externa o porque no alcanza la memoria libre. */
  memWait: MemWaitReason | null
  overlay: OverlayInfo | null
  /** Registro del proceso para LOAD/ADDI/STORE y la variable que cargó. */
  reg: number | null
  regVar: string | null
  /** Mutex que posee (está dentro de su sección crítica). */
  holds: string[]
  /** Recursos asignados (id → instancias). */
  resources: Record<string, number>
  /** Necesidad máxima declarada (para el banquero). */
  maxClaim: Record<string, number>
  /** Veces que fue víctima de un retroceso (rollback) por interbloqueo. */
  rollbacks: number
}

export type MemWaitReason = 'fragmentation' | 'no-memory'

/**
 * Cómo avanza un controlador:
 *  timed  la E/S dura un número fijo de ticks (dispositivo simulado)
 *  event  la E/S termina cuando llega una interrupción del hardware real (teclado, ratón)
 *  media  temporizada, pero solo avanza si hay un medio conectado (memoria USB real)
 */
export type DeviceMode = 'timed' | 'event' | 'media'

export interface DeviceInfo {
  id: DeviceId
  name: string
  busyPid: number | null
  busyTag: IoTag | null
  remaining: number
  queue: number[]
  served: number
  busyTicks: number
  mode: DeviceMode
  /** Solo en modo media: si hay un medio conectado. */
  medium: boolean | null
  /** Interrupciones de hardware real recibidas. */
  irqs: number
  /** Pulsaciones guardadas en el búfer del teclado sin proceso que las espere. */
  buffered: number
}

/** Qué hizo la CPU en un tick: ejecutar un proceso, cambiar de contexto o nada. */
export interface GanttSlot {
  tick: number
  pid: number | null
  /** os = el kernel ocupa la CPU (p. ej. compactando la memoria). */
  kind: 'run' | 'cs' | 'idle' | 'os'
}

export type KernelEventKind =
  | 'create'
  | 'transition'
  | 'dispatch'
  | 'interrupt'
  | 'syscall'
  | 'command'
  | 'scheduler'
  | 'memory'
  | 'sync'
  | 'resource'
  | 'deadlock'
  | 'starvation'
  | 'file'

export interface KernelEvent {
  id: number
  tick: number
  kind: KernelEventKind
  pid?: number
  from?: ProcState
  to?: ProcState
  message: string
  /** Eventos importantes que la interfaz muestra como notificación. */
  level?: 'info' | 'warning' | 'critical'
}

export interface KernelStats {
  busyTicks: number
  idleTicks: number
  csTicks: number
  /** Ticks de CPU usados por el propio kernel (compactación). */
  osTicks: number
  /** Porcentaje (0–1) de ticks en que la CPU ejecutó procesos de usuario. */
  cpuUtilization: number
  contextSwitches: number
  finished: number
  throughput: number
  avgWait: number
  avgResponse: number
  avgTurnaround: number
}

/** Clave de una arista del diagrama de estados, p. ej. "READY>RUNNING". */
export type TransitionKey = `${ProcState}>${ProcState}`

export interface KernelConfig {
  policy: SchedulerPolicy
  contextSwitchTicks: number
  /** Envejecimiento: la prioridad efectiva mejora mientras el proceso espera en Listo. */
  aging: boolean
  agingInterval: number
  starvationTicks: number
}

export interface CpuInfo {
  pid: number | null
  /** Ticks que faltan para terminar el cambio de contexto en curso. */
  switchRemaining: number
}

// ── Memoria ──

export interface MemoryBlock {
  base: number
  size: number
  kind: 'os' | 'process' | 'hole'
  pid: number | null
  /** KB que pidió el proceso (la diferencia con size es fragmentación interna). */
  requested?: number
  /** La imagen del proceso se está copiando desde el área de intercambio. */
  loading?: boolean
}

export interface Relocation {
  pid: number
  from: number
  to: number
  size: number
}

export interface MemoryInfo {
  totalKb: number
  osKb: number
  unitKb: number
  policy: FitPolicy
  autoCompact: boolean
  blocks: MemoryBlock[]
  stats: {
    usedKb: number
    freeKb: number
    largestHoleKb: number
    holeCount: number
    externalFragmentation: number
    internalFragmentationKb: number
    compactions: number
    kbMoved: number
    swapIns: number
    swapOuts: number
  }
  /** Procesos cuya imagen está en el área de intercambio (disco). */
  swapped: { pid: number; sizeKb: number }[]
  /** Procesos esperando memoria, en el orden en que se cargarán. */
  waiting: { pid: number; sizeKb: number; reason: MemWaitReason }[]
  lastCompaction: { tick: number; moves: Relocation[]; cost: number } | null
}

// ── Sincronización ──

export interface SemaphoreInfo {
  name: string
  value: number
  initial: number
  /** Procesos bloqueados en WAIT, en orden FIFO. */
  queue: number[]
  group: string
}

export interface MutexInfo {
  name: string
  owner: number | null
  queue: number[]
  group: string
}

export interface BufferItem {
  seq: number
  producer: number
  tick: number
}

export interface BufferInfo {
  name: string
  capacity: number
  items: BufferItem[]
  produced: number
  consumed: number
  /** PUT con el búfer lleno: el dato se pierde (solo pasa sin sincronización). */
  overflows: number
  /** GET con el búfer vacío: se consume basura (solo pasa sin sincronización). */
  underflows: number
  group: string
}

export interface VariableInfo {
  name: string
  value: number
  /** Valor que tendría si ninguna actualización se hubiera perdido. */
  expected: number
  group: string
}

export interface SyncGroupInfo {
  id: string
  name: string
  /** Si es false, WAIT/SIGNAL/LOCK/UNLOCK de sus objetos se ignoran (demo sin sincronización). */
  enabled: boolean
}

export interface SyncInfo {
  groups: SyncGroupInfo[]
  semaphores: SemaphoreInfo[]
  mutexes: MutexInfo[]
  buffers: BufferInfo[]
  variables: VariableInfo[]
}

// ── Recursos e interbloqueo ──

export interface ResourceInfo {
  id: string
  name: string
  total: number
  available: number
  /** 'mutex' = mutex de sincronización (una instancia), incluido en la detección. */
  kind: 'resource' | 'mutex'
}

export interface ResourcesInfo {
  policy: DeadlockPolicy
  autoRecover: boolean
  recovery: RecoveryMethod
  resources: ResourceInfo[]
  /** Aristas de asignación (recurso → proceso). */
  allocation: { pid: number; resource: string; count: number }[]
  /** Aristas de solicitud (proceso → recurso). */
  requests: { pid: number; resource: string; count: number; unsafe: boolean }[]
  claims: { pid: number; resource: string; count: number }[]
  deadlock: {
    pids: number[]
    resources: string[]
    since: number
    /** Ciclo del grafo de asignación: P11 → usb → P12 → impresora → P11. */
    cycle: string[]
  } | null
  /** Resultado del algoritmo de seguridad del banquero sobre el estado actual. */
  safety: { safe: boolean; sequence: number[] }
  stats: {
    deadlocks: number
    recoveries: number
    unsafeDenials: number
    preventiveReleases: number
  }
}

// ── Disco ──

export interface FsEntryInfo {
  path: string
  name: string
  type: 'file' | 'dir'
  size: number
  inode: number
  parent: number
  indexBlock: number
  blockCount: number
  firstBlock: number | null
  /** Tramos contiguos (1 = contiguo). */
  fragments: number
  /** Fecha de modificación (segundos Unix). */
  mtime: number
}

export interface DiskRequestInfo {
  pid: number
  tag: IoTag
  label: string
  cylinder: number
  kb: number
  since: number
}

export interface DiskInfo {
  /** Ruta real del archivo de imagen (null = disco en memoria). */
  path: string | null
  blockSize: number
  blockCount: number
  cylinders: number
  dataStart: number
  swapStart: number
  formattedAt: number
  mountCount: number
  usage: {
    dataBlocks: number
    usedBlocks: number
    freeBlocks: number
    swapBlocks: number
    swapUsed: number
  }
  /** Mapa de bits de bloques ocupados, en hexadecimal (bit menos significativo primero). */
  bitmap: string
  files: FsEntryInfo[]
  arm: {
    policy: DiskPolicy
    head: number
    direction: 1 | -1
    current: (DiskRequestInfo & { remaining: number; path: number[]; from: number }) | null
    queue: DiskRequestInfo[]
    stats: {
      totalMovement: number
      served: number
      avgSeek: number
      avgWait: number
      maxWait: number
    }
    history: {
      tick: number
      pid: number
      label: string
      from: number
      path: number[]
      distance: number
    }[]
  }
  io: { reads: number; writes: number; kbRead: number; kbWritten: number }
}

export interface FileDetails {
  entry: FsEntryInfo
  indexBlock: number
  blocks: number[]
  /** Contenido real leído del disco (solo texto, primeros KB). */
  preview: string | null
  /** Imágenes: contenido real como data URL. */
  image: string | null
}

// ── Hardware real ──

export interface HwStorage {
  id: string
  label: string
  mount: string
  sizeBytes: number
  model: string
  fstype: string
}

/** Eventos del hardware real que el HAL entrega al kernel como interrupciones. */
export type HwEvent =
  | { kind: 'key'; key: string; target?: string }
  | { kind: 'mouse'; action: 'click' | 'move' }
  | { kind: 'usbAttach'; id: string; name: string; type: string }
  | { kind: 'usbDetach'; id: string; name: string; type: string }
  | { kind: 'storageAttach'; storage: HwStorage }
  | { kind: 'storageDetach'; id: string; label: string }
  | { kind: 'power'; ac: boolean | null; battery: number | null }
  | { kind: 'netChange'; device: 'wifi' | 'bluetooth'; text: string }
  | { kind: 'usbWritten'; path: string; bytes: number; error?: string }
  | { kind: 'printed'; path: string; error?: string }

/** Acciones fuera de la simulación que el kernel pide al host (worker / proceso main). */
export type KernelEffect =
  | { type: 'usbWrite'; pid: number; mount: string; fileName: string; content: string }
  | { type: 'print'; pid: number; jobId: number; title: string; owner: string; content: string }

export interface HardwareInfo {
  /** Teclado, ratón y USB conectados al hardware real. */
  real: boolean
  storage: HwStorage | null
  ac: boolean | null
  battery: number | null
  lowPower: boolean
  /** Copiar los respaldos a la memoria USB real. */
  usbBackup: boolean
  /** Exigir una memoria USB real: sin ella las transferencias USB esperan (si no, se simulan). */
  usbStrict: boolean
  realModes: { teclado: boolean; raton: boolean; usb: boolean }
  /** Documentos abiertos en el Editor (la escritura del proceso usa su texto). */
  openDocs: string[]
  lastBackup: string | null
  lastPrint: string | null
}

/** Estado del hardware real que el proceso main publica a la interfaz (~1 Hz). */
export interface HwUsbDevice {
  id: string
  vendorId: string
  productId: string
  manufacturer: string
  product: string
  speedMbps: number
  type: string
}

export interface WifiNetwork {
  ssid: string
  /** Intensidad de la señal, 0–100. */
  signal: number
  security: string
  inUse: boolean
  /** Hay un perfil guardado: se conecta sin pedir contraseña. */
  known: boolean
}

export interface BluetoothDevice {
  mac: string
  name: string
  paired: boolean
  connected: boolean
}

export interface NetState {
  wifi: {
    available: boolean
    enabled: boolean
    device: string
    ssid: string | null
    networks: WifiNetwork[]
  }
  bluetooth: {
    available: boolean
    powered: boolean
    adapter: string
    devices: BluetoothDevice[]
  }
}

/** Resultado de una acción de red o Bluetooth pedida por el usuario. */
export interface NetResult {
  ok: boolean
  message: string
}

export interface HwState {
  net: NetState
  timestamp: number
  usb: HwUsbDevice[]
  storage: HwStorage[]
  battery: {
    capacity: number
    status: string
    powerW: number | null
    energyWh: number | null
    fullWh: number | null
    minutesLeft: number | null
    model: string
  } | null
  ac: boolean | null
  host: {
    hostname: string
    kernel: string
    cpuModel: string
    cores: number[]
    cpu: number
    memTotal: number
    memAvailable: number
    load: number[]
    uptime: number
  }
  cameras: string[]
  audio: string[]
  inputs: string[]
  printers: string[]
  serial: { path: string; accessible: boolean }[]
  log: { time: number; text: string }[]
  printDir: string
  diskPath: string
}
