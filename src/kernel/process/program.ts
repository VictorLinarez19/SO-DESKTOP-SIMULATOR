import { DEVICE_IDS, type DeviceId } from '../../shared/kernelTypes'

/**
 * Juego de instrucciones de los procesos simulados.
 *  CPU n            ráfaga de n ticks de CPU
 *  IO disp n        llamada al sistema: E/S de n ticks en el dispositivo `disp` (bloquea)
 *  SLEEP n          llamada al sistema: dormir n ticks (bloquea por temporizador)
 *  LOOP etiq [n]    salto a `etiq`; con n, el bloque se ejecuta n veces en total
 *  OVERLAY mod      llamada al sistema: carga el módulo de recubrimiento `mod` (si no está ya)
 *  WAIT sem         llamada al sistema: P (down) sobre un semáforo; bloquea si vale 0
 *  SIGNAL sem       llamada al sistema: V (up) sobre un semáforo; despierta al primero en espera
 *  LOCK m           llamada al sistema: adquiere el mutex `m`; bloquea si tiene dueño
 *  UNLOCK m         llamada al sistema: libera el mutex (solo su dueño)
 *  LOAD var         copia la variable compartida `var` al registro del proceso (1 tick)
 *  ADDI n           suma n al registro (1 tick)
 *  STORE var        escribe el registro en la variable compartida (1 tick)
 *  PUT buf          deposita un elemento en el búfer compartido `buf` (1 tick)
 *  GET buf          retira un elemento del búfer compartido `buf` (1 tick)
 *  FREAD ruta [kb]  llamada al sistema: lee el archivo (o sus primeros kb) del disco
 *  FWRITE ruta kb   llamada al sistema: escribe (sobrescribe) el archivo con kb KB
 *  FSCAN            llamada al sistema: lee el siguiente archivo del disco (antivirus)
 *  REQ rec [n]      llamada al sistema: pide n instancias (1 por omisión) del recurso `rec`
 *  REL rec [n]      llamada al sistema: devuelve n instancias del recurso `rec`
 *  EXIT             llamada al sistema: terminar
 * Las etiquetas se declaran como `nombre:` (solas o antes de una instrucción).
 * `#` inicia un comentario.
 */
export type Instr =
  | { op: 'CPU'; ticks: number }
  | { op: 'IO'; device: DeviceId; ticks: number }
  | { op: 'SLEEP'; ticks: number }
  | { op: 'LOOP'; label: string; target: number; times: number | null }
  | { op: 'OVERLAY'; module: string }
  | { op: 'WAIT' | 'SIGNAL' | 'LOCK' | 'UNLOCK'; name: string }
  | { op: 'LOAD' | 'STORE' | 'PUT' | 'GET'; name: string }
  | { op: 'ADDI'; value: number }
  | { op: 'REQ' | 'REL'; resource: string; count: number }
  | { op: 'FREAD'; path: string; kb: number | null }
  | { op: 'FWRITE'; path: string; kb: number }
  | { op: 'FSCAN' }
  | { op: 'EXIT' }

/** Instrucciones de usuario que consumen exactamente un tick (además de CPU n). */
export type UserOp = Extract<Instr, { op: 'LOAD' | 'STORE' | 'PUT' | 'GET' | 'ADDI' }>
export type SyncOp = Extract<Instr, { op: 'WAIT' | 'SIGNAL' | 'LOCK' | 'UNLOCK' }>

export function isUserOp(i: Instr): i is UserOp {
  return i.op === 'LOAD' || i.op === 'STORE' || i.op === 'PUT' || i.op === 'GET' || i.op === 'ADDI'
}

export class ProgramError extends Error {}

export function parseProgram(source: string): Instr[] {
  const lines = source
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l.length > 0)

  // Primera pasada: resolver etiquetas a índices de instrucción.
  const labels = new Map<string, number>()
  const bodies: { text: string; line: string }[] = []
  for (const line of lines) {
    const m = /^([\p{L}_][\p{L}\d_]*):\s*(.*)$/u.exec(line)
    let text = line
    if (m) {
      if (labels.has(m[1])) throw new ProgramError(`Etiqueta duplicada: ${m[1]}`)
      labels.set(m[1], bodies.length)
      text = m[2]
    }
    if (text) bodies.push({ text, line })
  }

  // Segunda pasada: decodificar instrucciones.
  const code = bodies.map(({ text, line }) => decode(text, line, labels))
  if (code.length === 0) throw new ProgramError('El programa está vacío')
  for (const [name, idx] of labels) {
    if (idx >= code.length)
      throw new ProgramError(`La etiqueta ${name} no precede a ninguna instrucción`)
  }
  return code
}

function decode(text: string, line: string, labels: Map<string, number>): Instr {
  const [rawOp, ...args] = text.split(/\s+/)
  const op = rawOp.toUpperCase()
  const num = (s: string | undefined, what: string): number => {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1) throw new ProgramError(`${what} inválido en "${line}"`)
    return n
  }
  switch (op) {
    case 'CPU':
      return { op, ticks: num(args[0], 'Número de ticks') }
    case 'SLEEP':
      return { op, ticks: num(args[0], 'Número de ticks') }
    case 'IO': {
      const device = args[0]?.toLowerCase() as DeviceId
      if (!DEVICE_IDS.includes(device))
        throw new ProgramError(`Dispositivo desconocido en "${line}"`)
      return { op, device, ticks: num(args[1], 'Número de ticks') }
    }
    case 'LOOP': {
      const label = args[0]
      const target = labels.get(label)
      if (target === undefined) throw new ProgramError(`Etiqueta no definida en "${line}"`)
      return {
        op,
        label,
        target,
        times: args[1] === undefined ? null : num(args[1], 'Repeticiones')
      }
    }
    case 'OVERLAY':
      if (!args[0]) throw new ProgramError(`Falta el módulo en "${line}"`)
      return { op, module: args[0] }
    case 'WAIT':
    case 'SIGNAL':
    case 'LOCK':
    case 'UNLOCK':
    case 'LOAD':
    case 'STORE':
    case 'PUT':
    case 'GET':
      if (!args[0]) throw new ProgramError(`Falta el nombre del objeto en "${line}"`)
      return { op, name: args[0] }
    case 'FREAD':
      if (!args[0]?.startsWith('/')) throw new ProgramError(`Ruta absoluta requerida en "${line}"`)
      return { op, path: args[0], kb: args[1] === undefined ? null : num(args[1], 'Tamaño') }
    case 'FWRITE':
      if (!args[0]?.startsWith('/')) throw new ProgramError(`Ruta absoluta requerida en "${line}"`)
      return { op, path: args[0], kb: num(args[1], 'Tamaño') }
    case 'FSCAN':
      return { op }
    case 'REQ':
    case 'REL':
      if (!args[0]) throw new ProgramError(`Falta el recurso en "${line}"`)
      return { op, resource: args[0], count: args[1] === undefined ? 1 : num(args[1], 'Cantidad') }
    case 'ADDI': {
      const n = Number(args[0])
      if (!Number.isInteger(n)) throw new ProgramError(`Valor inválido en "${line}"`)
      return { op, value: n }
    }
    case 'EXIT':
      return { op }
    default:
      throw new ProgramError(`Instrucción desconocida: "${line}"`)
  }
}

export function formatInstr(i: Instr | undefined): string {
  if (!i) return '—'
  switch (i.op) {
    case 'CPU':
      return `CPU ${i.ticks}`
    case 'SLEEP':
      return `SLEEP ${i.ticks}`
    case 'IO':
      return `IO ${i.device} ${i.ticks}`
    case 'LOOP':
      return i.times === null ? `LOOP ${i.label}` : `LOOP ${i.label} ${i.times}`
    case 'OVERLAY':
      return `OVERLAY ${i.module}`
    case 'WAIT':
    case 'SIGNAL':
    case 'LOCK':
    case 'UNLOCK':
    case 'LOAD':
    case 'STORE':
    case 'PUT':
    case 'GET':
      return `${i.op} ${i.name}`
    case 'ADDI':
      return `ADDI ${i.value}`
    case 'FREAD':
      return i.kb === null ? `FREAD ${i.path}` : `FREAD ${i.path} ${i.kb}`
    case 'FWRITE':
      return `FWRITE ${i.path} ${i.kb}`
    case 'FSCAN':
      return 'FSCAN'
    case 'REQ':
    case 'REL':
      return i.count === 1 ? `${i.op} ${i.resource}` : `${i.op} ${i.resource} ${i.count}`
    case 'EXIT':
      return 'EXIT'
  }
}

/** Listado legible del programa: cada instrucción con la etiqueta que la precede. */
export function listing(code: Instr[]): { text: string; label?: string }[] {
  const labels = new Map<number, string>()
  for (const i of code) if (i.op === 'LOOP') labels.set(i.target, i.label)
  return code.map((i, idx) => ({ text: formatInstr(i), label: labels.get(idx) }))
}
