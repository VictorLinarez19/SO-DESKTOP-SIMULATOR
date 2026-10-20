// Lectura del hardware real de Linux (sysfs, procfs y utilidades del sistema), sin permisos de root.
import { accessSync, constants, existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import os from 'node:os'
import type { HwState, HwStorage, HwUsbDevice } from '@shared/kernelTypes'

const read = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8').trim()
  } catch {
    return null
  }
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, (err, stdout) => resolve(err ? '' : stdout))
  })

const USB_CLASS: Record<string, string> = {
  '01': 'audio',
  '02': 'comunicaciones',
  '03': 'entrada (HID)',
  '06': 'imagen',
  '07': 'impresora',
  '08': 'almacenamiento',
  '09': 'hub',
  '0e': 'video',
  e0: 'inalámbrico',
  ef: 'compuesto'
}

/** Dispositivos USB conectados (sin los controladores raíz). */
export function readUsb(): HwUsbDevice[] {
  const base = '/sys/bus/usb/devices'
  if (!existsSync(base)) return []
  const out: HwUsbDevice[] = []
  for (const name of readdirSync(base)) {
    const dir = `${base}/${name}`
    const vendorId = read(`${dir}/idVendor`)
    if (!vendorId || vendorId === '1d6b') continue
    const product = read(`${dir}/product`) ?? 'Dispositivo USB'
    const ifaceClass =
      read(`${dir}/${name}:1.0/bInterfaceClass`) ?? read(`${dir}/bDeviceClass`) ?? ''
    let type = USB_CLASS[ifaceClass.toLowerCase()] ?? 'otro'
    if (/camera|cámara|webcam/i.test(product)) type = 'cámara'
    else if (/bluetooth/i.test(product)) type = 'bluetooth'
    else if (/mouse|ratón/i.test(product)) type = 'ratón'
    out.push({
      id: name,
      vendorId,
      productId: read(`${dir}/idProduct`) ?? '',
      manufacturer: read(`${dir}/manufacturer`) ?? '',
      product,
      speedMbps: Number(read(`${dir}/speed`) ?? 0),
      type
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

interface LsblkNode {
  name: string
  size: number
  type: string
  mountpoints?: (string | null)[]
  label: string | null
  tran: string | null
  rm: boolean
  hotplug: boolean
  model: string | null
  fstype: string | null
  children?: LsblkNode[]
}

/** Memorias USB y discos extraíbles montados (los monta el escritorio, p. ej. en /media/usuario). */
export async function readStorage(): Promise<HwStorage[]> {
  const json = await run('lsblk', [
    '-J',
    '-b',
    '-o',
    'NAME,SIZE,TYPE,MOUNTPOINTS,LABEL,TRAN,RM,HOTPLUG,MODEL,FSTYPE'
  ])
  return json ? parseLsblk(json) : []
}

/** Extrae de la salida JSON de `lsblk` las particiones extraíbles (USB) que están montadas. */
export function parseLsblk(json: string): HwStorage[] {
  const out: HwStorage[] = []
  const walk = (n: LsblkNode, parent: LsblkNode | null): void => {
    const removable = n.tran === 'usb' || parent?.tran === 'usb' || (n.rm && n.hotplug)
    const mount = n.mountpoints?.find((m): m is string => !!m)
    if (removable && mount && n.type !== 'loop') {
      out.push({
        id: n.name,
        label: n.label ?? n.name,
        mount,
        sizeBytes: Number(n.size),
        model: (parent?.model ?? n.model ?? '').trim(),
        fstype: n.fstype ?? ''
      })
    }
    for (const c of n.children ?? []) walk(c, n)
  }
  try {
    for (const n of (JSON.parse(json) as { blockdevices: LsblkNode[] }).blockdevices) walk(n, null)
  } catch {
    return []
  }
  return out
}

/** Batería y cargador desde /sys/class/power_supply. */
export function readPower(): Pick<HwState, 'battery' | 'ac'> {
  const base = '/sys/class/power_supply'
  let battery: HwState['battery'] = null
  let ac: boolean | null = null
  if (!existsSync(base)) return { battery, ac }
  for (const name of readdirSync(base)) {
    const dir = `${base}/${name}`
    const type = read(`${dir}/type`)
    if (type === 'Mains') ac = read(`${dir}/online`) === '1'
    if (type !== 'Battery' || read(`${dir}/present`) === '0') continue
    const capacity = Number(read(`${dir}/capacity`) ?? 0)
    const status = read(`${dir}/status`) ?? 'Unknown'
    const micro = (f: string): number | null => {
      const v = read(`${dir}/${f}`)
      return v === null ? null : Number(v) / 1e6
    }
    const energy = micro('energy_now') ?? (micro('charge_now') ?? 0) * (micro('voltage_now') ?? 0)
    const full = micro('energy_full') ?? (micro('charge_full') ?? 0) * (micro('voltage_now') ?? 0)
    const power = micro('power_now') ?? (micro('current_now') ?? 0) * (micro('voltage_now') ?? 0)
    let minutesLeft: number | null = null
    if (power > 0.1 && status === 'Discharging') minutesLeft = Math.round((energy / power) * 60)
    if (power > 0.1 && status === 'Charging')
      minutesLeft = Math.round(((full - energy) / power) * 60)
    battery = {
      capacity,
      status:
        {
          Discharging: 'Descargando',
          Charging: 'Cargando',
          Full: 'Cargada',
          'Not charging': 'Sin cargar'
        }[status] ?? status,
      powerW: power || null,
      energyWh: energy || null,
      fullWh: full || null,
      minutesLeft,
      model: read(`${dir}/model_name`) ?? name
    }
  }
  return { battery, ac }
}

let prevCpu: number[][] | null = null

/** CPU por núcleo (a partir de /proc/stat), memoria y carga del equipo real. */
export function readHost(): HwState['host'] {
  const lines = (read('/proc/stat') ?? '').split('\n').filter((l) => /^cpu\d* /.test(l))
  const now = lines.map((l) => l.split(/\s+/).slice(1).map(Number))
  const usage = now.map((t, i) => {
    const p = prevCpu?.[i]
    if (!p) return 0
    const idle = t[3] + (t[4] ?? 0) - (p[3] + (p[4] ?? 0))
    const total = t.reduce((a, b) => a + b, 0) - p.reduce((a, b) => a + b, 0)
    return total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : 0
  })
  prevCpu = now
  const mem = read('/proc/meminfo') ?? ''
  const kb = (key: string): number =>
    Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(mem)?.[1] ?? 0) * 1024
  return {
    hostname: os.hostname(),
    kernel: `${os.type()} ${os.release()}`,
    cpuModel: os.cpus()[0]?.model.trim() ?? 'CPU',
    cpu: usage[0] ?? 0,
    cores: usage.slice(1),
    memTotal: kb('MemTotal'),
    memAvailable: kb('MemAvailable'),
    load: os.loadavg(),
    uptime: os.uptime()
  }
}

export async function readPrinters(): Promise<string[]> {
  const out = await run('lpstat', ['-e'])
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function readCameras(): string[] {
  const base = '/sys/class/video4linux'
  if (!existsSync(base)) return []
  const names = readdirSync(base).map((v) => (read(`${base}/${v}/name`) ?? v).split(':')[0].trim())
  return [...new Set(names)]
}

export function readAudio(): string[] {
  return (read('/proc/asound/cards') ?? '')
    .split('\n')
    .map((l) => /^\s*\d+\s+\[.*?\]:\s*(.*)$/.exec(l)?.[1]?.trim())
    .filter((s): s is string => !!s)
}

export function readInputs(): string[] {
  const names = (read('/proc/bus/input/devices') ?? '')
    .split('\n')
    .filter((l) => l.startsWith('N: Name='))
    .map((l) => l.slice(9, -1))
  return [...new Set(names.filter((n) => /keyboard|mouse|touchpad|teclado/i.test(n)))]
}

export function readSerial(): HwState['serial'] {
  const candidates = ['/dev/ttyS0', '/dev/ttyS1']
  for (const n of existsSync('/dev') ? readdirSync('/dev') : []) {
    if (/^tty(USB|ACM)\d+$/.test(n)) candidates.push(`/dev/${n}`)
  }
  return candidates
    .filter((p) => existsSync(p))
    .map((path) => {
      try {
        accessSync(path, constants.R_OK | constants.W_OK)
        return { path, accessible: true }
      } catch {
        return { path, accessible: false }
      }
    })
}
