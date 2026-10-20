import { DEVICE_LABEL, type ProcessInfo } from '@shared/kernelTypes'

export function waitingText(p: ProcessInfo): string {
  const w = p.waitingOn
  if (w === null) return p.suspendedBy === 'user' ? 'Suspendido por el usuario' : '—'
  switch (w.kind) {
    case 'io':
      return `E/S · ${DEVICE_LABEL[w.device]}`
    case 'timer':
      return `Temporizador (t=${w.until})`
    case 'memory':
      return p.memWait === 'fragmentation' ? 'Memoria (fragmentación)' : 'Memoria insuficiente'
    case 'swap':
      return 'Cargando desde swap'
    case 'overlay':
      return `Recubrimiento «${w.module}»`
    case 'sync':
      return w.op === 'WAIT' ? `Semáforo «${w.object}»` : `Mutex «${w.object}»`
    case 'resource':
      return `${w.unsafe ? 'Banquero: ' : 'Recurso: '}${Object.keys(w.want).join(' + ')}`
    case 'file':
      return `Disco · ${w.op === 'read' ? 'lee' : 'escribe'} ${w.path.split('/').pop()}`
  }
}

/** Dirección en KB con su equivalente hexadecimal en bytes. */
export function addr(kb: number): string {
  return `0x${(kb * 1024).toString(16).toUpperCase().padStart(6, '0')}`
}

export function memText(p: ProcessInfo): string {
  if (p.memBase !== null) return `${p.memSize} KB`
  if (p.state === 'TERMINATED' || p.state === 'NEW') return '—'
  return 'swap'
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)} %`
}

/** Ticks consecutivos en Listo a partir de los cuales se resalta un proceso como en inanición. */
export const STARVATION_TICKS = 100
