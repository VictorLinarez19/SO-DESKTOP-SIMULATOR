import type { HwEvent, HwState, HwStorage, HwUsbDevice, NetState } from '@shared/kernelTypes'
import { readNet } from './network'
import {
  readAudio,
  readCameras,
  readHost,
  readInputs,
  readPower,
  readPrinters,
  readSerial,
  readStorage,
  readUsb
} from './sources'

interface Options {
  /** Cambios del hardware que el kernel recibe como interrupciones. */
  onEvent(e: HwEvent): void
  /** Estado completo para la interfaz. */
  onState(s: HwState): void
  printDir: string
  diskPath: string
}

const LOG_SIZE = 40

/**
 * HAL: sondea el hardware real y detecta cambios (conexión/desconexión de USB,
 * memorias montadas, cargador y batería). Sondear sysfs es la forma más simple
 * de detectar el hotplug sin privilegios ni módulos nativos.
 */
export class HardwareMonitor {
  private usb: HwUsbDevice[] = []
  private storage: HwStorage[] = []
  private ac: boolean | null = null
  private battery: number | null = null
  private slow = {
    printers: [] as string[],
    cameras: [] as string[],
    audio: [] as string[],
    inputs: [] as string[],
    serial: [] as HwState['serial']
  }
  private net: NetState = {
    wifi: { available: false, enabled: false, device: '', ssid: null, networks: [] },
    bluetooth: { available: false, powered: false, adapter: '', devices: [] }
  }
  private log: HwState['log'] = []
  private timers: NodeJS.Timeout[] = []
  private first = true

  constructor(private readonly opts: Options) {}

  async start(): Promise<void> {
    await this.pollSlow()
    await this.pollFast()
    this.timers.push(setInterval(() => void this.pollFast(), 1000))
    this.timers.push(setInterval(() => void this.pollSlow(), 10_000))
    this.timers.push(setInterval(() => void this.pollNet(), 8_000))
    await this.pollNet()
  }

  /** Relee Wi-Fi y Bluetooth (tras una acción del usuario) y publica el estado al instante. */
  async refreshNet(): Promise<void> {
    await this.pollNet()
    this.publish()
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
  }

  private note(text: string): void {
    this.log.unshift({ time: Date.now(), text })
    this.log.length = Math.min(this.log.length, LOG_SIZE)
  }

  private async pollSlow(): Promise<void> {
    this.slow = {
      printers: await readPrinters(),
      cameras: readCameras(),
      audio: readAudio(),
      inputs: readInputs(),
      serial: readSerial()
    }
  }

  /** Detecta altas y bajas de red: cambian de red Wi-Fi o de dispositivo Bluetooth conectado. */
  private async pollNet(): Promise<void> {
    const next = await readNet()
    const prev = this.net
    const first = prev.wifi.device === '' && !prev.bluetooth.available
    this.net = next
    if (first) return
    const say = (device: 'wifi' | 'bluetooth', text: string): void => {
      this.note(text)
      this.opts.onEvent({ kind: 'netChange', device, text })
    }
    if (next.wifi.ssid !== prev.wifi.ssid) {
      say('wifi', next.wifi.ssid ? `Wi-Fi conectado a «${next.wifi.ssid}»` : 'Wi-Fi desconectado')
    }
    for (const d of next.bluetooth.devices) {
      const old = prev.bluetooth.devices.find((o) => o.mac === d.mac)
      if (d.connected !== (old?.connected ?? false)) {
        say('bluetooth', `Bluetooth: «${d.name}» ${d.connected ? 'conectado' : 'desconectado'}`)
      }
    }
  }

  private publish(): void {
    this.opts.onState(this.state())
  }

  private async pollFast(): Promise<void> {
    // USB: altas y bajas.
    const usb = readUsb()
    if (!this.first) {
      for (const d of usb.filter((d) => !this.usb.some((o) => o.id === d.id))) {
        this.note(`Conectado: ${d.product} (${d.type})`)
        this.opts.onEvent({ kind: 'usbAttach', id: d.id, name: d.product, type: d.type })
      }
      for (const d of this.usb.filter((o) => !usb.some((d) => d.id === o.id))) {
        this.note(`Desconectado: ${d.product}`)
        this.opts.onEvent({ kind: 'usbDetach', id: d.id, name: d.product, type: d.type })
      }
    }
    this.usb = usb

    // Memorias montadas (también las que ya estaban al arrancar).
    const storage = await readStorage()
    for (const s of storage.filter((s) => !this.storage.some((o) => o.id === s.id))) {
      this.note(`Memoria USB montada: ${s.label} en ${s.mount}`)
      this.opts.onEvent({ kind: 'storageAttach', storage: s })
    }
    for (const s of this.storage.filter((o) => !storage.some((s) => s.id === o.id))) {
      this.note(`Memoria USB retirada: ${s.label}`)
      this.opts.onEvent({ kind: 'storageDetach', id: s.id, label: s.label })
    }
    this.storage = storage

    // Energía.
    const { battery, ac } = readPower()
    const level = battery?.capacity ?? null
    if (ac !== this.ac || level !== this.battery) {
      if (!this.first && ac !== this.ac)
        this.note(ac ? 'Cargador conectado' : 'Cargador desconectado')
      this.ac = ac
      this.battery = level
      this.opts.onEvent({ kind: 'power', ac, battery: level })
    }

    this.first = false
    this.publish()
  }

  private state(): HwState {
    const { battery, ac } = readPower()
    return {
      timestamp: Date.now(),
      usb: this.usb,
      storage: this.storage,
      battery,
      ac,
      net: this.net,
      host: readHost(),
      ...this.slow,
      log: this.log,
      printDir: this.opts.printDir,
      diskPath: this.opts.diskPath
    }
  }
}
