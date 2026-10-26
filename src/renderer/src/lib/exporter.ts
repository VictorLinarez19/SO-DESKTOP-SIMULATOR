import type { KernelEvent } from '@shared/kernelTypes'
import type { KernelSnapshot } from '@shared/ipc'
import { STATE_LABEL } from '@shared/kernelTypes'

const csvCell = (v: unknown): string => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Bitácora completa en CSV (se abre directo en una hoja de cálculo). */
export function eventsToCsv(events: KernelEvent[], names: Map<number, string>): string {
  const rows = events.map((e) =>
    [e.tick, e.kind, e.pid ?? '', e.pid ? (names.get(e.pid) ?? '') : '', e.level ?? '', e.message]
      .map(csvCell)
      .join(',')
  )
  return ['tick,tipo,pid,proceso,nivel,mensaje', ...rows].join('\n')
}

/** Reporte en Markdown con el estado final y las métricas: evidencia para el informe. */
export function snapshotToReport(s: KernelSnapshot, events: KernelEvent[]): string {
  const st = s.stats
  const count = (kind: string): number => events.filter((e) => e.kind === kind).length
  const lines: string[] = [
    '# Reporte de LinarezOS',
    '',
    `Generado el ${new Date().toLocaleString('es-MX')} · tick ${s.tick} · planificador ${s.config.policy}`,
    '',
    '## Procesos',
    '',
    '| PID | Proceso | Estado | Prioridad | Quantum | CPU | Espera | Máx. espera | Memoria |',
    '|---|---|---|---|---|---|---|---|---|',
    ...s.processes.map(
      (p) =>
        `| ${p.pid} | ${p.name} | ${STATE_LABEL[p.state]} | ${p.priority} | ${p.quantum} | ${p.cpuTime} | ${p.waitTime} | ${p.maxReadyStreak} | ${p.memBase === null ? 'swap' : `${p.memSize} KB @ ${p.memBase}`} |`
    ),
    '',
    '## Métricas de CPU',
    '',
    `- Uso de CPU: ${(st.cpuUtilization * 100).toFixed(1)} %`,
    `- Cambios de contexto: ${st.contextSwitches}`,
    `- Espera promedio: ${st.avgWait.toFixed(1)} ticks · respuesta: ${st.avgResponse.toFixed(1)} · retorno: ${st.avgTurnaround.toFixed(1)}`,
    '',
    '## Memoria',
    '',
    `- ${s.memory.totalKb} KB (SO ${s.memory.osKb} KB), colocación ${s.memory.policy}`,
    `- Libre ${s.memory.stats.freeKb} KB en ${s.memory.stats.holeCount} huecos (mayor ${s.memory.stats.largestHoleKb} KB); fragmentación externa ${(s.memory.stats.externalFragmentation * 100).toFixed(0)} %`,
    `- Compactaciones ${s.memory.stats.compactions} · swap in ${s.memory.stats.swapIns} / out ${s.memory.stats.swapOuts}`,
    '',
    '## Sincronización',
    '',
    ...s.sync.variables.map(
      (v) =>
        `- Variable ${v.name}: ${v.value} (esperado ${v.expected}, actualizaciones perdidas ${v.expected - v.value})`
    ),
    ...s.sync.buffers.map(
      (b) =>
        `- Búfer ${b.name}: producidos ${b.produced}, consumidos ${b.consumed}, desbordamientos ${b.overflows}`
    ),
    '',
    '## Interbloqueo e inanición',
    '',
    `- Interbloqueos detectados: ${s.resources.stats.deadlocks} · recuperaciones: ${s.resources.stats.recoveries}`,
    `- Avisos de inanición: ${events.filter((e) => e.kind === 'starvation' && e.level === 'warning').length}`,
    `- Estado actual: ${s.resources.deadlock ? 'INTERBLOQUEO ACTIVO' : 'sin interbloqueo'}`,
    '',
    '## Disco',
    '',
    `- Brazo ${s.disk.arm.policy}: ${s.disk.arm.stats.served} solicitudes, movimiento total ${s.disk.arm.stats.totalMovement} cilindros`,
    `- Lecturas ${s.disk.io.reads} · escrituras ${s.disk.io.writes}`,
    '',
    '## Bitácora (resumen por tipo)',
    '',
    ...[
      'transition',
      'dispatch',
      'interrupt',
      'syscall',
      'memory',
      'sync',
      'resource',
      'deadlock',
      'starvation',
      'file'
    ].map((k) => `- ${k}: ${count(k)}`)
  ]
  return lines.join('\n')
}
