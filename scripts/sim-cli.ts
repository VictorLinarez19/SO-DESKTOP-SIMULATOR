// Ejecuta el kernel sin interfaz gráfica e imprime su traza.
// Uso: npm run sim -- [--ticks 120] [--policy PRIORITY_RR|RR|FCFS] [--cs 0] [--fit FIRST|BEST|WORST|NEXT]
//                     [--no-compact] [--no-sync] [--sync] [--deadlock DETECT|AVOID|PREVENT|IGNORE]
//                     [--auto-recover] [--aging] [--disk FCFS|SSTF|SCAN|CSCAN|LOOK|CLOOK] [--width 100] [--log] [--mem] [--plain]
import { parseArgs } from 'node:util'
import { Kernel, fmtAddr } from '../src/kernel/kernel'
import {
  DEADLOCK_POLICY_LABEL,
  FIT_LABEL,
  type DeadlockPolicy,
  type DiskPolicy,
  DISK_POLICY_LABEL,
  POLICY_LABEL,
  type FitPolicy,
  STATE_LABEL,
  type ProcState,
  type SchedulerPolicy
} from '../src/shared/kernelTypes'

const { values: args } = parseArgs({
  options: {
    ticks: { type: 'string', default: '120' },
    policy: { type: 'string', default: 'PRIORITY_RR' },
    cs: { type: 'string', default: '0' },
    width: { type: 'string', default: '100' },
    log: { type: 'boolean', default: false },
    mem: { type: 'boolean', default: false },
    fit: { type: 'string', default: 'FIRST' },
    'no-compact': { type: 'boolean', default: false },
    'no-sync': { type: 'boolean', default: false },
    deadlock: { type: 'string', default: 'DETECT' },
    'auto-recover': { type: 'boolean', default: false },
    aging: { type: 'boolean', default: false },
    disk: { type: 'string', default: 'LOOK' },
    sync: { type: 'boolean', default: false },
    plain: { type: 'boolean', default: !process.stdout.isTTY }
  }
})

const policy = args.policy.toUpperCase() as SchedulerPolicy
if (!(policy in POLICY_LABEL)) {
  console.error(
    `Política desconocida: ${args.policy}. Usa: ${Object.keys(POLICY_LABEL).join(', ')}`
  )
  process.exit(1)
}
const ticks = Number(args.ticks)
const width = Number(args.width)
const plain = args.plain

const kernel = new Kernel({
  policy,
  contextSwitchTicks: Number(args.cs),
  memory: { policy: args.fit.toUpperCase() as FitPolicy, autoCompact: !args['no-compact'] },
  deadlockPolicy: args.deadlock.toUpperCase() as DeadlockPolicy,
  autoRecover: args['auto-recover'],
  aging: args.aging,
  diskPolicy: args.disk.toUpperCase() as DiskPolicy,
  logCapacity: 1e6,
  ganttCapacity: 1e6
})

if (args['no-sync']) {
  for (const g of kernel.snapshot().sync.groups) {
    kernel.command({ type: 'setSyncEnabled', group: g.id, enabled: false })
  }
}

// ── simulación: se guarda el estado de cada proceso en cada tick ──
type Cell = ProcState | 'CS' | null
const timeline = new Map<number, Cell[]>()
for (let t = 1; t <= ticks; t++) {
  kernel.tick()
  const snap = kernel.snapshot()
  // Quien usó la CPU en este tick se marca en Ejecución aunque al final del tick
  // se haya bloqueado o terminado (su llamada al sistema ocurrió en ese mismo tick).
  const slot = snap.gantt.at(-1)
  for (const p of snap.processes) {
    if (!timeline.has(p.pid)) timeline.set(p.pid, Array<Cell>(ticks).fill(null))
    const usedCpu = slot?.pid === p.pid
    timeline.get(p.pid)![t - 1] = usedCpu ? (slot.kind === 'cs' ? 'CS' : 'RUNNING') : p.state
  }
}

// ── presentación ──
const color = (code: number, s: string): string => (plain ? s : `\x1b[${code}m${s}\x1b[0m`)
const bold = (s: string): string => color(1, s)
const dim = (s: string): string => color(2, s)
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - [...s].length))

const CELL: Record<Exclude<Cell, null>, [fancy: string, plain: string, color: number]> = {
  RUNNING: ['█', 'E', 32],
  CS: ['*', '*', 36],
  READY: ['▒', 'L', 33],
  BLOCKED: ['░', 'B', 31],
  NEW: ['n', 'N', 36],
  READY_SUSPENDED: ['s', 's', 35],
  BLOCKED_SUSPENDED: ['S', 'S', 35],
  TERMINATED: ['×', 'X', 90]
}

function cell(c: Cell, prev: Cell): string {
  if (c === null || (c === 'TERMINATED' && prev === 'TERMINATED')) return ' '
  const [fancy, p, code] = CELL[c]
  return plain ? p : color(code, fancy)
}

const procs = kernel.processes()
const nameW = Math.max(...procs.map((p) => p.name.length)) + 4

console.log(
  bold(
    `\nguiñanOS · simulación: ${ticks} ticks · ${POLICY_LABEL[policy]} · cambio de contexto = ${args.cs} tick(s)\n`
  )
)
const legendStates = [
  'RUNNING',
  'CS',
  'READY',
  'BLOCKED',
  'NEW',
  'READY_SUSPENDED',
  'BLOCKED_SUSPENDED',
  'TERMINATED'
] as const
console.log(
  dim('Leyenda: ') +
    legendStates
      .map((s) => `${cell(s, null)} ${s === 'CS' ? 'Cambio de contexto' : STATE_LABEL[s]}`)
      .join('  ')
)
console.log(
  dim(
    'Fila CPU: PID en base 36 (a=10 … f=15), * = cambio de contexto, K = kernel compactando, - = ociosa\n'
  )
)

const gantt = kernel.gantt.all()
for (let start = 0; start < ticks; start += width) {
  const end = Math.min(ticks, start + width)
  let ruler = ''
  while (ruler.length < end - start) {
    const t = start + ruler.length + 1
    ruler += t % 10 === 0 || t === start + 1 ? String(t) : ' '
  }
  console.log(pad('', nameW) + dim(ruler.slice(0, end - start)))
  for (const p of procs) {
    const row = timeline.get(p.pid)!
    let line = ''
    for (let i = start; i < end; i++) line += cell(row[i], i > 0 ? row[i - 1] : null)
    console.log(pad(`${String(p.pid).padStart(2)} ${p.name}`, nameW) + line)
  }
  const cpu = gantt
    .slice(start, end)
    .map((g) =>
      g.kind === 'idle' ? '-' : g.kind === 'cs' ? '*' : g.kind === 'os' ? 'K' : g.pid!.toString(36)
    )
    .join('')
  console.log(bold(pad('   CPU', nameW)) + cpu + '\n')
}

// ── bitácora ──
const events = kernel.log.all()
const shown = args.log ? events : events.filter((e) => e.kind === 'transition').slice(0, 40)
const nameOf = (pid: number): string => procs.find((p) => p.pid === pid)?.name ?? ''
console.log(
  bold(
    args.log
      ? 'Bitácora completa'
      : 'Primeras 40 transiciones de estado (usa --log para ver toda la bitácora)'
  )
)
for (const e of shown) {
  const who = e.pid
    ? `PID ${String(e.pid).padStart(2)} ${pad(nameOf(e.pid), nameW - 3)}`
    : pad('', nameW + 4)
  console.log(`${dim(`[t=${String(e.tick).padStart(4)}]`)} ${pad(e.kind, 10)} ${who} ${e.message}`)
}
const totalTransitions = events.filter((e) => e.kind === 'transition').length
console.log(dim(`… ${totalTransitions} transiciones en total\n`))

// ── PCB final ──
console.log(bold('Bloques de control de proceso al final'))
const header = [
  'PID',
  'Proceso',
  'Prio',
  'Q',
  'Estado',
  'CPU',
  'Espera',
  'Bloq.',
  'Resp.',
  'MaxEsp',
  'CtxSw',
  'E/S'
]
const rows = kernel
  .processes()
  .map((p) => [
    String(p.pid),
    p.name,
    String(p.priority),
    String(p.quantum),
    STATE_LABEL[p.state],
    String(p.cpuTime),
    String(p.waitTime),
    String(p.blockedTime),
    p.firstRun === null ? '—' : String(p.firstRun - p.arrival),
    String(p.maxReadyStreak),
    String(p.contextSwitches),
    String(p.ioCount)
  ])
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => [...r[i]].length)))
const fmt = (r: string[]): string =>
  r.map((c, i) => (i === 1 || i === 4 ? pad(c, widths[i]) : c.padStart(widths[i]))).join('  ')
console.log(dim(fmt(header)))
for (const r of rows) console.log(fmt(r))
console.log(
  dim('Espera = ticks en Listo · Resp. = llegada → primera CPU · MaxEsp = racha más larga en Listo')
)

const st = kernel.stats()
console.log(bold('\nMétricas globales'))
console.log(
  `  Uso de CPU:           ${(st.cpuUtilization * 100).toFixed(1)} %  ` +
    `(${st.busyTicks} útiles, ${st.csTicks} de cambio de contexto, ${st.osTicks} del kernel, ${st.idleTicks} ociosos)`
)
console.log(`  Cambios de contexto:  ${st.contextSwitches}`)
console.log(
  `  Procesos terminados:  ${st.finished}  (${(st.throughput * 100).toFixed(2)} por cada 100 ticks)`
)
console.log(`  Espera promedio:      ${st.avgWait.toFixed(1)} ticks`)
console.log(`  Respuesta promedio:   ${st.avgResponse.toFixed(1)} ticks`)
console.log(`  Retorno promedio:     ${st.finished ? st.avgTurnaround.toFixed(1) + ' ticks' : '—'}`)

// ── memoria ──
const mem = kernel.memoryInfo()
console.log(
  bold(
    `\nMemoria: ${mem.totalKb} KB (${mem.osKb} KB del SO) · ${FIT_LABEL[mem.policy]} · ` +
      `compactación ${mem.autoCompact ? 'automática' : 'manual'}`
  )
)
const scale = mem.totalKb / Math.min(width, 100)
let bar = ''
for (const b of mem.blocks) {
  const n = Math.max(1, Math.round(b.size / scale))
  const ch = b.kind === 'os' ? '#' : b.kind === 'hole' ? '.' : b.pid!.toString(36)
  bar += (b.kind === 'process' && !plain ? color(31 + (b.pid! % 6), ch) : ch).repeat(n)
}
console.log(`  [${bar}]`)
console.log(dim('  # = sistema operativo, . = hueco libre, 1…f = partición del PID'))
for (const b of mem.blocks) {
  const who =
    b.kind === 'os'
      ? 'Sistema operativo'
      : b.kind === 'hole'
        ? 'HUECO'
        : `PID ${b.pid} ${nameOf(b.pid!)}${b.requested !== b.size ? ` (pidió ${b.requested} KB)` : ''}`
  console.log(`  ${pad(fmtAddr(b.base), 22)} ${String(b.size).padStart(5)} KB  ${who}`)
}
const ms = mem.stats
console.log(
  `  Libre ${ms.freeKb} KB en ${ms.holeCount} huecos (mayor ${ms.largestHoleKb} KB) · ` +
    `fragmentación externa ${(ms.externalFragmentation * 100).toFixed(0)} % · interna ${ms.internalFragmentationKb} KB`
)
console.log(
  `  Compactaciones ${ms.compactions} (${ms.kbMoved} KB copiados) · swap in ${ms.swapIns} · swap out ${ms.swapOuts}`
)
if (mem.swapped.length) {
  console.log(
    `  En el área de intercambio: ${mem.swapped.map((s) => `PID ${s.pid} (${s.sizeKb} KB)`).join(', ')}`
  )
}
if (args.mem) {
  console.log(bold('\nBitácora de memoria'))
  for (const e of events.filter((e) => e.kind === 'memory')) {
    console.log(
      `${dim(`[t=${String(e.tick).padStart(4)}]`)} ${e.pid ? `PID ${String(e.pid).padStart(2)} ` : '       '}${e.message}`
    )
  }
}

// ── sincronización ──
const sync = kernel.snapshot().sync
console.log(bold(`\nSincronización${args['no-sync'] ? ' (DESACTIVADA)' : ''}`))
for (const sem of sync.semaphores) {
  console.log(
    `  semáforo ${pad(sem.name, 10)} valor ${sem.value}` +
      (sem.queue.length ? ` · en espera: ${sem.queue.map((p) => `PID ${p}`).join(', ')}` : '')
  )
}
for (const m of sync.mutexes) {
  console.log(
    `  mutex    ${pad(m.name, 10)} ${m.owner === null ? 'libre' : `dueño PID ${m.owner}`}` +
      (m.queue.length ? ` · en espera: ${m.queue.map((p) => `PID ${p}`).join(', ')}` : '')
  )
}
for (const b of sync.buffers) {
  console.log(
    `  búfer    ${pad(b.name, 10)} ${b.items.length}/${b.capacity} · producidos ${b.produced} · ` +
      `consumidos ${b.consumed} · desbordamientos ${b.overflows} · lecturas vacías ${b.underflows}`
  )
}
for (const v of sync.variables) {
  console.log(
    `  variable ${pad(v.name, 10)} valor ${v.value} · esperado ${v.expected} · ` +
      `actualizaciones perdidas ${v.expected - v.value}`
  )
}
if (args.sync) {
  console.log(bold('\nBitácora de sincronización'))
  for (const e of events.filter((e) => e.kind === 'sync')) {
    console.log(
      `${dim(`[t=${String(e.tick).padStart(4)}]`)} ${e.pid ? `PID ${String(e.pid).padStart(2)} ` : '       '}${e.message}`
    )
  }
}

// ── recursos e interbloqueo ──
const res = kernel.snapshot().resources
console.log(
  bold(
    `\nRecursos · ${DEADLOCK_POLICY_LABEL[res.policy]}` +
      (res.policy === 'DETECT'
        ? ` · recuperación ${res.autoRecover ? 'automática' : 'manual'}`
        : '')
  )
)
for (const r of res.resources) {
  const holders = res.allocation.filter((a) => a.resource === r.id).map((a) => `PID ${a.pid}`)
  const waiters = res.requests.filter((a) => a.resource === r.id).map((a) => `PID ${a.pid}`)
  if (r.kind === 'mutex' && holders.length + waiters.length === 0) continue
  console.log(
    `  ${pad(r.name, 12)} ${r.available}/${r.total} libres` +
      (holders.length ? ` · asignado a ${holders.join(', ')}` : '') +
      (waiters.length ? ` · lo esperan ${waiters.join(', ')}` : '')
  )
}
const ds = res.stats
console.log(
  `  Interbloqueos ${ds.deadlocks} · recuperaciones ${ds.recoveries} · retenidas por el banquero ${ds.unsafeDenials} · ` +
    `liberaciones preventivas ${ds.preventiveReleases} · estado ${res.safety.safe ? 'seguro' : 'INSEGURO'}`
)
if (res.deadlock)
  console.log(
    `  ⛔ INTERBLOQUEO ACTIVO desde t=${res.deadlock.since}: ${res.deadlock.cycle.join(' → ')}`
  )
for (const e of events.filter((e) => e.level)) {
  console.log(
    `${dim(`[t=${String(e.tick).padStart(4)}]`)} ${e.level === 'critical' ? '⛔' : '⚠ '} ${e.message}`
  )
}

// ── disco ──
const disk = kernel.snapshot().disk
const arm = disk.arm
console.log(
  bold(
    `\nDisco · guiñanFS · ${disk.blockCount} bloques de ${disk.blockSize / 1024} KB · brazo ${DISK_POLICY_LABEL[arm.policy]}`
  )
)
console.log(
  `  Lecturas ${disk.io.reads} (${disk.io.kbRead} KB) · escrituras ${disk.io.writes} (${disk.io.kbWritten} KB) · ` +
    `bloques libres ${disk.usage.freeBlocks} · swap ${disk.usage.swapUsed}/${disk.usage.swapBlocks}`
)
console.log(
  `  Brazo: ${arm.stats.served} solicitudes · movimiento total ${arm.stats.totalMovement} cilindros · ` +
    `búsqueda promedio ${arm.stats.avgSeek.toFixed(1)} · espera promedio ${arm.stats.avgWait.toFixed(1)} (máx. ${arm.stats.maxWait}) ticks`
)
console.log(
  '  Últimos movimientos: ' +
    arm.history
      .slice(-10)
      .map((m) => `${m.from}→${m.path.join('→')}`)
      .join('  ')
)
