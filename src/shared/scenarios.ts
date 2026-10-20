// Escenarios de demostración: configuran el kernel para provocar un fenómeno concreto.
import type { KernelCommand } from './ipc'

export interface Scenario {
  id: string
  title: string
  concept: string
  /** Qué se va a ver y dónde. */
  expect: string
  commands: KernelCommand[]
  /** App que conviene abrir (id de AppId). */
  app: string
  /** Ticks aproximados hasta que el fenómeno es visible. */
  ticks: number
}

const reset: KernelCommand = { type: 'reset' }
const fast: KernelCommand = { type: 'setSpeed', tickMs: 40 }
const base: KernelCommand[] = [
  reset,
  { type: 'setPolicy', policy: 'PRIORITY_RR' },
  { type: 'setAging', enabled: false },
  { type: 'setDeadlockPolicy', policy: 'DETECT' },
  { type: 'setAutoRecover', enabled: false },
  { type: 'setAutoCompact', enabled: true },
  { type: 'setSyncEnabled', group: 'pc', enabled: true },
  { type: 'setSyncEnabled', group: 'cs', enabled: true },
  { type: 'setFitPolicy', policy: 'FIRST' },
  { type: 'setDiskPolicy', policy: 'LOOK' }
]

export const SCENARIOS: Scenario[] = [
  {
    id: 'deadlock',
    title: 'Provocar un interbloqueo',
    concept: 'Espera circular',
    expect:
      'Spooler (impresora → USB) y Respaldo USB (USB → impresora) se bloquean mutuamente. Aparece el ciclo rojo y la notificación.',
    commands: [...base, fast],
    app: 'deadlock',
    ticks: 260
  },
  {
    id: 'deadlock-avoid',
    title: 'Evitar el interbloqueo (banquero)',
    concept: 'Estado seguro',
    expect:
      'Los mismos procesos, pero el banquero retiene la solicitud peligrosa: nunca hay ciclo.',
    commands: [...base, { type: 'setDeadlockPolicy', policy: 'AVOID' }, fast],
    app: 'deadlock',
    ticks: 160
  },
  {
    id: 'starvation',
    title: 'Provocar inanición',
    concept: 'Prioridades estrictas',
    expect:
      'El Antivirus (prioridad 9) pasa más de 100 ticks en Listo sin CPU: aviso en el Monitor de actividad.',
    commands: [...base, fast],
    app: 'activity',
    ticks: 280
  },
  {
    id: 'aging',
    title: 'Corregir la inanición (aging)',
    concept: 'Envejecimiento',
    expect:
      'Con aging activado, la prioridad efectiva del Antivirus sube mientras espera y logra ejecutarse.',
    commands: [...base, { type: 'setAging', enabled: true }, fast],
    app: 'activity',
    ticks: 200
  },
  {
    id: 'fragmentation',
    title: 'Fragmentación externa',
    concept: 'Memoria no contigua',
    expect:
      'Con la compactación automática apagada, un proceso espera aunque hay memoria libre suficiente. Pulsa «Compactar».',
    commands: [...base, { type: 'setAutoCompact', enabled: false }, fast],
    app: 'memory',
    ticks: 120
  },
  {
    id: 'race',
    title: 'Condición de carrera',
    concept: 'Exclusión mutua',
    expect: 'Sin el mutex, Navegador y Descargas pierden actualizaciones del contador compartido.',
    commands: [...base, { type: 'setSyncEnabled', group: 'cs', enabled: false }, fast],
    app: 'sync',
    ticks: 200
  },
  {
    id: 'overflow',
    title: 'Sin sincronización: desbordamiento',
    concept: 'Productor–consumidor sin semáforos',
    expect:
      'Se apagan todos los semáforos y mutex: el productor escribe con el búfer lleno y se pierden datos, además de las carreras.',
    commands: [
      ...base,
      { type: 'setSyncEnabled', group: 'pc', enabled: false },
      { type: 'setSyncEnabled', group: 'cs', enabled: false },
      fast
    ],
    app: 'sync',
    ticks: 700
  },
  {
    id: 'disk',
    title: 'Comparar planificación del disco',
    concept: 'FCFS vs SCAN vs LOOK',
    expect:
      'Arranca con FCFS: cambia el algoritmo en la Utilidad de Discos y compara el recorrido del brazo.',
    commands: [...base, { type: 'setDiskPolicy', policy: 'FCFS' }, fast],
    app: 'disk',
    ticks: 300
  },
  {
    id: 'normal',
    title: 'Restaurar el sistema',
    concept: 'Configuración normal',
    expect:
      'Reinicia el kernel con la configuración por defecto y la recuperación automática de interbloqueos.',
    commands: [
      ...base,
      { type: 'setAutoRecover', enabled: true },
      { type: 'setSpeed', tickMs: 250 }
    ],
    app: 'activity',
    ticks: 0
  }
]
