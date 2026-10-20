import {
  DEVICE_IDS,
  DEVICE_LABEL,
  type DeviceId,
  type DeviceInfo,
  type DeviceMode,
  type IoTag
} from '../../shared/kernelTypes'
import { CYLINDERS, DiskArm, type DiskRequest } from '../disk/diskScheduler'

interface IoRequest {
  pid: number
  remaining: number
  tag: IoTag
}

/** Tamaño del búfer de teclado: pulsaciones que se guardan si nadie las espera. */
const TYPE_AHEAD = 16

class Device {
  current: IoRequest | null = null
  queue: IoRequest[] = []
  served = 0
  busyTicks = 0
  mode: DeviceMode = 'timed'
  medium = false
  irqs = 0
  buffered = 0

  constructor(readonly id: DeviceId) {}
}

export interface IoCompletion {
  device: DeviceId
  pid: number
  tag: IoTag
}

/**
 * Controladores de dispositivo: cada uno atiende una petición a la vez (FCFS)
 * y genera una interrupción al terminarla. El disco es especial: su cola la
 * ordena el planificador del brazo según el algoritmo elegido.
 */
export class DeviceManager {
  private readonly devices = new Map<DeviceId, Device>(
    DEVICE_IDS.filter((id) => id !== 'disco').map((id) => [id, new Device(id)])
  )
  private ioSeq = 0
  /** Peticiones que el hardware real completó; su IRQ se entrega en el tick siguiente. */
  private signaled: IoCompletion[] = []

  constructor(readonly arm: DiskArm) {}

  /** E/S genérica de n ticks. En el disco se le asigna un cilindro (deriva del PID). */
  request(device: DeviceId, pid: number, ticks: number, tag: IoTag = 'io', now = 0): void {
    if (device === 'disco') {
      this.arm.enqueue({
        pid,
        tag,
        cylinder: (pid * 37 + this.ioSeq++ * 53) % CYLINDERS,
        transferTicks: ticks,
        fixedTicks: ticks,
        kb: 0,
        label: 'E/S de disco',
        since: now
      })
      return
    }
    const dev = this.get(device)
    if (dev.mode === 'event' && dev.buffered > 0) {
      // Había pulsaciones en el búfer: la petición se satisface sin esperar.
      dev.buffered--
      dev.served++
      this.signaled.push({ device, pid, tag })
      return
    }
    dev.queue.push({ pid, remaining: ticks, tag })
  }

  /** Peticiones que completó el hardware real desde el último tick (sus IRQ se atienden ya). */
  takeSignaled(): IoCompletion[] {
    const out = this.signaled
    this.signaled = []
    return out
  }

  setMode(device: DeviceId, mode: DeviceMode): void {
    const dev = this.get(device)
    dev.mode = mode
    dev.buffered = 0
  }

  setMedium(device: DeviceId, present: boolean): void {
    this.get(device).medium = present
  }

  mode(device: DeviceId): DeviceMode {
    return device === 'disco' ? 'timed' : this.get(device).mode
  }

  /**
   * Interrupción del hardware real en un dispositivo de modo `event`: completa la
   * petición del proceso preferido (el de la ventana activa) o la primera en espera.
   * Devuelve el PID atendido, o null si la pulsación quedó en el búfer.
   */
  signal(device: DeviceId, preferPid?: number): number | null {
    const dev = this.get(device)
    dev.irqs++
    if (dev.mode !== 'event') return null
    let req: IoRequest | undefined
    if (preferPid !== undefined) {
      if (dev.current?.pid === preferPid) req = dev.current
      else req = dev.queue.find((r) => r.pid === preferPid)
    }
    req ??= dev.current ?? dev.queue[0]
    if (!req) {
      if (device === 'teclado') dev.buffered = Math.min(TYPE_AHEAD, dev.buffered + 1)
      return null
    }
    if (dev.current === req) dev.current = null
    else dev.queue = dev.queue.filter((r) => r !== req)
    dev.served++
    this.signaled.push({ device, pid: req.pid, tag: req.tag })
    return req.pid
  }

  /** Solicitud al disco con cilindro y tamaño reales (archivos, swap, recubrimientos). */
  diskRequest(req: Omit<DiskRequest, 'id'>): void {
    this.arm.enqueue(req)
  }

  /**
   * Trabajo de los dispositivos durante un tick. Devuelve las E/S que terminaron;
   * su interrupción se entrega al inicio del tick siguiente.
   */
  tick(now = 0): IoCompletion[] {
    const done: IoCompletion[] = this.arm
      .tick(now)
      .map((r) => ({ device: 'disco' as const, pid: r.pid, tag: r.tag }))
    for (const dev of this.devices.values()) {
      if (!dev.current) dev.current = dev.queue.shift() ?? null
      if (!dev.current) continue
      dev.busyTicks++
      // Teclado/ratón reales: la petición espera la interrupción del hardware.
      if (dev.mode === 'event') continue
      // Memoria USB real: sin medio conectado la transferencia no avanza.
      if (dev.mode === 'media' && !dev.medium) continue
      if (--dev.current.remaining <= 0) {
        done.push({ device: dev.id, pid: dev.current.pid, tag: dev.current.tag })
        dev.served++
        // El controlador toma de inmediato la siguiente petición de la cola.
        dev.current = dev.queue.shift() ?? null
      }
    }
    return done
  }

  /** Cancela cualquier petición del proceso (al terminarlo). */
  cancel(pid: number): void {
    this.arm.cancel(pid)
    for (const dev of this.devices.values()) {
      if (dev.current?.pid === pid) dev.current = null
      dev.queue = dev.queue.filter((r) => r.pid !== pid)
    }
    this.signaled = this.signaled.filter((r) => r.pid !== pid)
  }

  info(): DeviceInfo[] {
    const arm = this.arm
    return DEVICE_IDS.map((id) => {
      if (id === 'disco') {
        return {
          id,
          name: DEVICE_LABEL[id],
          busyPid: arm.current?.req.pid ?? null,
          busyTag: arm.current?.req.tag ?? null,
          remaining: arm.current?.remaining ?? 0,
          queue: arm.queue.map((r) => r.pid),
          served: arm.stats.served - (arm.current ? 1 : 0),
          busyTicks: arm.stats.busyTicks,
          mode: 'timed' as const,
          medium: null,
          irqs: 0,
          buffered: 0
        }
      }
      const d = this.get(id)
      return {
        id,
        name: DEVICE_LABEL[id],
        busyPid: d.current?.pid ?? null,
        busyTag: d.current?.tag ?? null,
        remaining: d.current?.remaining ?? 0,
        queue: d.queue.map((r) => r.pid),
        served: d.served,
        busyTicks: d.busyTicks,
        mode: d.mode,
        medium: d.mode === 'media' ? d.medium : null,
        irqs: d.irqs,
        buffered: d.buffered
      }
    })
  }

  private get(id: DeviceId): Device {
    return this.devices.get(id)!
  }
}
