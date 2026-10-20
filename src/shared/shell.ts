// Intérprete de la Terminal de guiñanOS: traduce comandos a órdenes del kernel y
// da formato a su estado. No usa el DOM, así que se prueba con un kernel real.
import { canWrite } from './accounts'
import type { KernelCommand, KernelQuery, KernelSnapshot, QueryResults } from './ipc'
import {
  DEADLOCK_POLICY_LABEL,
  DISK_POLICY_LABEL,
  FIT_LABEL,
  POLICY_LABEL,
  STATE_LABEL,
  type DeadlockPolicy,
  type DiskPolicy,
  type FitPolicy,
  type SchedulerPolicy
} from './kernelTypes'

export interface ShellContext {
  /** Usuario con la sesión abierta (null = sin controlar permisos). */
  user?: { name: string; admin: boolean } | null
  snapshot: KernelSnapshot
  send(cmd: KernelCommand): void
  query<Q extends KernelQuery>(q: Q): Promise<QueryResults[Q['type']]>
  cwd: string
}

export interface ShellResult {
  lines: string[]
  /** Nuevo directorio actual (cd). */
  cwd?: string
  clear?: boolean
  error?: boolean
  /** Acción del sistema que debe ejecutar la interfaz (cerrar la Terminal, apagar…). */
  action?: 'exit' | 'logout' | 'lock' | 'sleep' | 'reboot' | 'shutdown'
}

const pad = (s: string | number, n: number): string => String(s).padEnd(n)
const rpad = (s: string | number, n: number): string => String(s).padStart(n)

export function resolvePath(cwd: string, p: string): string {
  const parts = (p.startsWith('/') ? p : `${cwd}/${p}`).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

const POLICIES: Record<string, SchedulerPolicy> = { fcfs: 'FCFS', rr: 'RR', prio: 'PRIORITY_RR' }
const FITS: Record<string, FitPolicy> = {
  first: 'FIRST',
  best: 'BEST',
  worst: 'WORST',
  next: 'NEXT'
}
const DEADLOCKS: Record<string, DeadlockPolicy> = {
  ignore: 'IGNORE',
  detect: 'DETECT',
  avoid: 'AVOID',
  prevent: 'PREVENT'
}
const DISKS: Record<string, DiskPolicy> = {
  fcfs: 'FCFS',
  sstf: 'SSTF',
  scan: 'SCAN',
  cscan: 'CSCAN',
  look: 'LOOK',
  clook: 'CLOOK'
}

export const COMMANDS: Record<string, string> = {
  help: 'muestra esta ayuda',
  ps: 'lista los procesos (PCB resumido)',
  top: 'procesos que más CPU han usado y uso de la CPU',
  info: 'info <pid>: bloque de control completo de un proceso',
  kill: 'kill <pid>: termina un proceso',
  nice: 'nice <pid> <0-9>: cambia la prioridad (0 = máxima)',
  quantum: 'quantum <pid> <n>: cambia el quantum de un proceso',
  suspend: 'suspend <pid>: suspende un proceso (swap a disco)',
  resume: 'resume <pid>: reactiva un proceso suspendido',
  spawn: 'spawn <programa>: lanza un proceso (finder, editor, antivirus…)',
  sched: 'sched [fcfs|rr|prio]: ve o cambia el planificador',
  aging: 'aging [on|off]: envejecimiento contra la inanición',
  mem: 'mem: mapa y métricas de la memoria',
  fit: 'fit [first|best|worst|next]: política de colocación de memoria',
  compact: 'compact: compacta la memoria',
  sync: 'sync: semáforos, mutex, búfer y variables compartidas',
  deadlock: 'deadlock [detect|avoid|prevent|ignore|recover]: estrategia y estado',
  res: 'res: recursos asignados y solicitudes pendientes',
  disk: 'disk [fcfs|sstf|scan|cscan|look|clook]: brazo del disco',
  df: 'df: uso del disco',
  ls: 'ls [ruta]: lista una carpeta de disk.img',
  cd: 'cd <ruta>: cambia de carpeta',
  pwd: 'pwd: carpeta actual',
  cat: 'cat <archivo>: muestra el contenido leído del disco',
  mkdir: 'mkdir <ruta>: crea una carpeta',
  rm: 'rm <ruta>: elimina un archivo o carpeta vacía',
  rmdir: 'rmdir <ruta>: elimina una carpeta vacía',
  whoami: 'whoami: usuario con la sesión abierta',
  exit: 'exit: cierra esta Terminal',
  logout: 'logout: cierra la sesión',
  lock: 'lock: bloquea la pantalla',
  sleep: 'sleep: suspende el equipo',
  reboot: 'reboot: reinicia guiñanOS',
  shutdown: 'shutdown: apaga guiñanOS',
  lsdev: 'lsdev: controladores de dispositivo',
  uptime: 'uptime: tiempo de funcionamiento del kernel',
  pause: 'pause: pausa el reloj del kernel',
  run: 'run: reanuda el reloj del kernel',
  speed: 'speed <ms>: milisegundos reales por tick',
  reset: 'reset: reinicia el kernel',
  clear: 'clear: limpia la pantalla'
}

export async function runCommand(line: string, ctx: ShellContext): Promise<ShellResult> {
  const [cmd, ...args] = line.trim().split(/\s+/)
  if (!cmd) return { lines: [] }
  const s = ctx.snapshot
  const err = (msg: string): ShellResult => ({ lines: [msg], error: true })
  const pidArg = (): number | string => {
    const pid = Number(args[0])
    if (!Number.isInteger(pid)) return `uso: ${cmd} <pid>`
    if (!s.processes.some((p) => p.pid === pid)) return `${cmd}: no existe el proceso ${pid}`
    return pid
  }
  const ok = (...lines: string[]): ShellResult => ({ lines })

  switch (cmd) {
    case 'help':
      return ok(
        'Comandos de la Terminal de guiñanOS:',
        ...Object.entries(COMMANDS).map(([k, v]) => `  ${pad(k, 9)} ${v}`)
      )
    case 'clear':
      return { lines: [], clear: true }
    case 'ps':
      return ok(
        'PID  PRIO  Q    ESTADO                  CPU  ESPERA  MEM     PROCESO',
        ...s.processes.map(
          (p) =>
            `${pad(p.pid, 4)} ${pad(p.priority, 5)} ${pad(p.quantum, 4)} ${pad(STATE_LABEL[p.state], 22)} ${rpad(p.cpuTime, 4)} ${rpad(p.waitTime, 7)}  ${pad(p.memBase === null ? 'swap' : p.memSize + 'K', 7)} ${p.name}`
        )
      )
    case 'top': {
      const st = s.stats
      const top = [...s.processes].sort((a, b) => b.cpuTime - a.cpuTime).slice(0, 8)
      return ok(
        `guiñanOS t=${s.tick} · ${POLICY_LABEL[s.config.policy]} · CPU ${(st.cpuUtilization * 100).toFixed(1)} % · ` +
          `${st.contextSwitches} cambios de contexto`,
        `Procesos: ${s.processes.filter((p) => p.state !== 'TERMINATED').length} activos · en CPU: ${s.cpu.pid ?? 'ninguno'} · listos: [${s.readyQueue.join(' ')}]`,
        '',
        'PID  PROCESO               ESTADO        CPU',
        ...top.map(
          (p) => `${pad(p.pid, 4)} ${pad(p.name, 21)} ${pad(STATE_LABEL[p.state], 13)} ${p.cpuTime}`
        )
      )
    }
    case 'info': {
      const pid = pidArg()
      if (typeof pid === 'string') return err(pid)
      const p = s.processes.find((x) => x.pid === pid)!
      return ok(
        `PID ${p.pid} · ${p.name} (${p.programId})`,
        `  estado       ${STATE_LABEL[p.state]}`,
        `  prioridad    ${p.priority} (base ${p.basePriority}) · quantum ${p.quantum}`,
        `  PC           ${p.pc}: ${p.instruction}`,
        `  tiempos      CPU ${p.cpuTime} · listo ${p.waitTime} · bloqueado ${p.blockedTime} · racha ${p.readyStreak}`,
        `  memoria      ${p.memBase === null ? 'en swap' : `base ${p.memBase} KB, límite ${p.memSize} KB`}`,
        `  recursos     ${
          Object.entries(p.resources)
            .map(([r, n]) => `${r}×${n}`)
            .join(', ') || '—'
        }`,
        `  mutex        ${p.holds.join(', ') || '—'}`,
        `  E/S          ${p.ioCount} operaciones · ${p.contextSwitches} cambios de contexto`
      )
    }
    case 'kill':
    case 'suspend':
    case 'resume': {
      const pid = pidArg()
      if (typeof pid === 'string') return err(pid)
      ctx.send({ type: cmd === 'kill' ? 'kill' : cmd === 'suspend' ? 'suspend' : 'activate', pid })
      return ok(`${cmd}: orden enviada al kernel para PID ${pid}`)
    }
    case 'nice': {
      const pid = pidArg()
      const n = Number(args[1])
      if (typeof pid === 'string') return err(pid)
      if (!Number.isInteger(n) || n < 0 || n > 9) return err('uso: nice <pid> <0-9>')
      ctx.send({ type: 'setPriority', pid, priority: n })
      return ok(`PID ${pid}: prioridad ${n}`)
    }
    case 'quantum': {
      const pid = pidArg()
      const n = Number(args[1])
      if (typeof pid === 'string') return err(pid)
      if (!Number.isInteger(n) || n < 1) return err('uso: quantum <pid> <n>')
      ctx.send({ type: 'setQuantum', pid, quantum: n })
      return ok(`PID ${pid}: quantum ${n}`)
    }
    case 'spawn': {
      if (!args[0]) return err('uso: spawn <programa>')
      const known = new Set(s.processes.map((p) => p.programId))
      if (!known.has(args[0])) return err(`spawn: programa desconocido (${[...known].join(', ')})`)
      ctx.send({ type: 'spawn', programId: args[0] })
      return ok(`spawn: ${args[0]} lanzado`)
    }
    case 'sched': {
      if (!args[0])
        return ok(
          `Planificador: ${POLICY_LABEL[s.config.policy]} · cambio de contexto ${s.config.contextSwitchTicks} ticks`
        )
      const policy = POLICIES[args[0]]
      if (!policy) return err('uso: sched [fcfs|rr|prio]')
      ctx.send({ type: 'setPolicy', policy })
      return ok(`Planificador: ${POLICY_LABEL[policy]}`)
    }
    case 'aging': {
      if (!args[0]) return ok(`Aging ${s.config.aging ? 'activado' : 'desactivado'}`)
      if (args[0] !== 'on' && args[0] !== 'off') return err('uso: aging [on|off]')
      ctx.send({ type: 'setAging', enabled: args[0] === 'on' })
      return ok(`Aging ${args[0] === 'on' ? 'activado' : 'desactivado'}`)
    }
    case 'mem':
    case 'free': {
      const m = s.memory
      const st = m.stats
      const scale = m.totalKb / 64
      const bar = m.blocks
        .map((b) => {
          const n = Math.max(1, Math.round(b.size / scale))
          return (
            b.kind === 'os' ? '#' : b.kind === 'hole' ? '.' : (b.pid! % 36).toString(36)
          ).repeat(n)
        })
        .join('')
      return ok(
        `Memoria ${m.totalKb} KB (SO ${m.osKb} KB) · ${FIT_LABEL[m.policy]} · compactación ${m.autoCompact ? 'automática' : 'manual'}`,
        `[${bar}]  # SO · . hueco · 1…z partición del PID`,
        `usada ${st.usedKb} KB · libre ${st.freeKb} KB en ${st.holeCount} huecos (mayor ${st.largestHoleKb} KB)`,
        `fragmentación externa ${(st.externalFragmentation * 100).toFixed(0)} % · interna ${st.internalFragmentationKb} KB`,
        `compactaciones ${st.compactions} · swap in ${st.swapIns} / out ${st.swapOuts}` +
          (m.waiting.length
            ? ` · esperando memoria: ${m.waiting.map((w) => `PID ${w.pid}`).join(', ')}`
            : '')
      )
    }
    case 'fit': {
      if (!args[0]) return ok(`Colocación: ${FIT_LABEL[s.memory.policy]}`)
      const policy = FITS[args[0]]
      if (!policy) return err('uso: fit [first|best|worst|next]')
      ctx.send({ type: 'setFitPolicy', policy })
      return ok(`Colocación: ${FIT_LABEL[policy]}`)
    }
    case 'compact':
      ctx.send({ type: 'compact' })
      return ok('compact: compactación solicitada')
    case 'sync': {
      const y = s.sync
      return ok(
        ...y.semaphores.map(
          (x) =>
            `semáforo ${pad(x.name, 9)} = ${x.value}${x.queue.length ? ` · en espera: ${x.queue.join(', ')}` : ''}`
        ),
        ...y.mutexes.map(
          (x) =>
            `mutex    ${pad(x.name, 9)} ${x.owner === null ? 'libre' : `dueño PID ${x.owner}`}${x.queue.length ? ` · en espera: ${x.queue.join(', ')}` : ''}`
        ),
        ...y.buffers.map(
          (x) =>
            `búfer    ${pad(x.name, 9)} ${x.items.length}/${x.capacity} · producidos ${x.produced} · consumidos ${x.consumed} · desbordamientos ${x.overflows}`
        ),
        ...y.variables.map(
          (x) =>
            `variable ${pad(x.name, 9)} = ${x.value} (esperado ${x.expected}, perdidas ${x.expected - x.value})`
        ),
        ...y.groups.map(
          (g) => `sincronización de «${g.name}»: ${g.enabled ? 'activada' : 'DESACTIVADA'}`
        )
      )
    }
    case 'deadlock': {
      const r = s.resources
      if (args[0] === 'recover') {
        ctx.send({ type: 'recoverDeadlock' })
        return ok('deadlock: recuperación solicitada')
      }
      if (args[0]) {
        const policy = DEADLOCKS[args[0]]
        if (!policy) return err('uso: deadlock [detect|avoid|prevent|ignore|recover]')
        ctx.send({ type: 'setDeadlockPolicy', policy })
        return ok(`Estrategia: ${DEADLOCK_POLICY_LABEL[policy]}`)
      }
      return ok(
        `Estrategia: ${DEADLOCK_POLICY_LABEL[r.policy]}`,
        r.deadlock
          ? `⛔ INTERBLOQUEO desde t=${r.deadlock.since}: PIDs ${r.deadlock.pids.join(', ')} · ciclo ${r.deadlock.cycle.join(' → ')}`
          : 'sin interbloqueo',
        `estado ${r.safety.safe ? 'seguro' : 'INSEGURO'} · detectados ${r.stats.deadlocks} · recuperados ${r.stats.recoveries}`
      )
    }
    case 'res':
      return ok(
        ...s.resources.resources
          .filter((x) => x.kind === 'resource')
          .map((x) => {
            const holders = s.resources.allocation
              .filter((a) => a.resource === x.id)
              .map((a) => `PID ${a.pid}`)
            const waiters = s.resources.requests
              .filter((a) => a.resource === x.id)
              .map((a) => `PID ${a.pid}`)
            return `${pad(x.name, 12)} ${x.available}/${x.total} libres${holders.length ? ` · asignado a ${holders.join(', ')}` : ''}${waiters.length ? ` · espera ${waiters.join(', ')}` : ''}`
          })
      )
    case 'disk': {
      if (args[0]) {
        const policy = DISKS[args[0]]
        if (!policy) return err('uso: disk [fcfs|sstf|scan|cscan|look|clook]')
        ctx.send({ type: 'setDiskPolicy', policy })
        return ok(`Brazo del disco: ${DISK_POLICY_LABEL[policy]}`)
      }
      const a = s.disk.arm
      return ok(
        `Brazo: ${DISK_POLICY_LABEL[a.policy]} · cilindro ${a.head} · cola ${a.queue.length}`,
        `${a.stats.served} solicitudes · movimiento total ${a.stats.totalMovement} cil. · búsqueda promedio ${a.stats.avgSeek.toFixed(1)} · espera promedio ${a.stats.avgWait.toFixed(1)} ticks`
      )
    }
    case 'df': {
      const u = s.disk.usage
      const kb = (b: number): number => (b * s.disk.blockSize) / 1024
      return ok(
        `guiñanFS en ${s.disk.path ?? 'memoria'}`,
        `datos ${kb(u.usedBlocks)} KB usados de ${kb(u.dataBlocks)} KB · libres ${kb(u.freeBlocks)} KB`,
        `swap ${kb(u.swapUsed)} KB de ${kb(u.swapBlocks)} KB · ${s.disk.io.reads} lecturas · ${s.disk.io.writes} escrituras`
      )
    }
    case 'pwd':
      return ok(ctx.cwd)
    case 'cd': {
      const target = resolvePath(ctx.cwd, args[0] ?? '/')
      const f = s.disk.files.find((x) => x.path === target)
      if (!f || f.type !== 'dir') return err(`cd: ${target}: no es una carpeta`)
      return { lines: [], cwd: target }
    }
    case 'ls': {
      const target = resolvePath(ctx.cwd, args[0] ?? '.')
      const dir = s.disk.files.find((x) => x.path === target)
      if (!dir || dir.type !== 'dir') return err(`ls: ${target}: no es una carpeta`)
      const items = s.disk.files
        .filter(
          (f) =>
            f.path !== '/' &&
            f.path.slice(0, f.path.lastIndexOf('/')) === (target === '/' ? '' : target)
        )
        .sort((a, b) => a.name.localeCompare(b.name))
      return ok(
        ...items.map(
          (f) =>
            `${f.type === 'dir' ? 'd' : '-'} ${rpad(f.type === 'dir' ? '-' : Math.ceil(f.size / 1024) + 'K', 6)} bloques ${rpad(f.blockCount, 4)} frag ${f.fragments}  ${f.name}${f.type === 'dir' ? '/' : ''}`
        ),
        ...(items.length === 0 ? ['(vacía)'] : [])
      )
    }
    case 'cat': {
      if (!args[0]) return err('uso: cat <archivo>')
      const path = resolvePath(ctx.cwd, args[0])
      const d = await ctx.query({ type: 'fileInfo', path })
      if (!d) return err(`cat: ${path}: no existe`)
      if (d.entry.type === 'dir') return err(`cat: ${path}: es una carpeta`)
      if (d.preview === null)
        return err(
          `cat: ${path}: archivo binario (${d.entry.size} bytes, bloques ${d.blocks.slice(0, 6).join(', ')})`
        )
      return ok(...d.preview.split('\n').slice(0, 30))
    }
    case 'mkdir':
    case 'rm':
    case 'rmdir': {
      if (!args[0]) return err(`uso: ${cmd} <ruta>`)
      const path = resolvePath(ctx.cwd, args[0])
      if (ctx.user !== undefined && !canWrite(ctx.user, path)) {
        return err(`${cmd}: ${path}: permiso denegado (solo puedes modificar tu carpeta personal)`)
      }
      if (cmd !== 'mkdir') {
        const f = s.disk.files.find((x) => x.path === path)
        if (!f) return err(`${cmd}: ${path}: no existe`)
        if (cmd === 'rmdir' && f.type !== 'dir') return err(`rmdir: ${path}: no es una carpeta`)
        if (cmd === 'rmdir' && s.disk.files.some((x) => x.path.startsWith(path + '/'))) {
          return err(`rmdir: ${path}: la carpeta no está vacía`)
        }
        if (cmd === 'rm' && f.type === 'dir') return err(`rm: ${path}: es una carpeta (usa rmdir)`)
      }
      ctx.send({ type: cmd === 'mkdir' ? 'fsMkdir' : 'fsDelete', path })
      return ok(`${cmd}: ${path}`)
    }
    case 'whoami':
      return ok(
        ctx.user ? `${ctx.user.name}${ctx.user.admin ? ' (administrador)' : ''}` : 'sin sesión'
      )
    case 'exit':
      return { lines: [], action: 'exit' }
    case 'logout':
    case 'lock':
    case 'sleep':
    case 'reboot':
    case 'shutdown':
      return { lines: [], action: cmd }
    case 'lsdev':
      return ok(
        'DISPOSITIVO   MODO         ATIENDE  COLA',
        ...s.devices.map(
          (d) =>
            `${pad(d.name, 13)} ${pad({ timed: 'simulado', event: 'real (IRQ)', media: 'real (medio)' }[d.mode], 12)} ${pad(d.busyPid ?? '-', 8)} [${d.queue.join(' ')}]`
        )
      )
    case 'uptime':
      return ok(
        `t=${s.tick} ticks · ${((s.tick * s.tickMs) / 1000).toFixed(0)} s de tiempo real · ${s.tickMs} ms/tick · ${s.running ? 'en marcha' : 'en pausa'}`
      )
    case 'pause':
    case 'run':
      ctx.send({ type: cmd === 'pause' ? 'pause' : 'resume' })
      return ok(cmd === 'pause' ? 'kernel en pausa' : 'kernel en marcha')
    case 'speed': {
      const ms = Number(args[0])
      if (!Number.isFinite(ms)) return err('uso: speed <ms por tick>')
      ctx.send({ type: 'setSpeed', tickMs: ms })
      return ok(`reloj: ${ms} ms por tick`)
    }
    case 'reset':
      ctx.send({ type: 'reset' })
      return ok('kernel reiniciado')
    default:
      return err(`${cmd}: comando no encontrado. Escribe «help».`)
  }
}
