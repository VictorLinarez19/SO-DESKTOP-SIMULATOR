// Wi-Fi (NetworkManager: nmcli) y Bluetooth (BlueZ: bluetoothctl) reales.
// Solo se ejecutan por acción explícita del usuario; los argumentos se pasan sin shell.
import { execFile } from 'node:child_process'
import type { BluetoothDevice, NetResult, NetState, WifiNetwork } from '@shared/kernelTypes'

interface Out {
  code: number
  stdout: string
  stderr: string
}

function run(cmd: string, args: string[], input?: string, timeout = 15_000): Promise<Out> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      const raw = err ? (err as { code?: unknown }).code : 0
      const code = typeof raw === 'number' ? raw : err ? 1 : 0
      resolve({ code, stdout, stderr })
    })
    if (input !== undefined) child.stdin?.end(input)
  })
}

// ───────────────────────── análisis de la salida (funciones puras) ─────────────────────────

/** Divide una línea del modo terso de nmcli (-t): separa por ':' respetando '\:'. */
export function splitTerse(line: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) cur += line[++i]
    else if (line[i] === ':') {
      out.push(cur)
      cur = ''
    } else cur += line[i]
  }
  out.push(cur)
  return out
}

/** `nmcli -t -f IN-USE,SSID,SIGNAL,SECURITY dev wifi list` → redes sin duplicados, de mayor a menor señal. */
export function parseWifiList(text: string, known: Set<string>): WifiNetwork[] {
  const best = new Map<string, WifiNetwork>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const [inUse, ssid, signal, security] = splitTerse(line)
    if (!ssid) continue
    const net: WifiNetwork = {
      ssid,
      signal: Number(signal) || 0,
      security: security || 'Abierta',
      inUse: inUse === '*',
      known: known.has(ssid)
    }
    const prev = best.get(ssid)
    if (!prev || net.inUse || (!prev.inUse && net.signal > prev.signal)) best.set(ssid, net)
  }
  return [...best.values()].sort((a, b) => Number(b.inUse) - Number(a.inUse) || b.signal - a.signal)
}

/** `bluetoothctl devices` → [{mac, name}]. */
export function parseBtDevices(text: string): { mac: string; name: string }[] {
  const out: { mac: string; name: string }[] = []
  for (const line of text.split('\n')) {
    const m = /^Device\s+([0-9A-F:]{17})\s+(.*)$/i.exec(line.trim())
    if (m) out.push({ mac: m[1].toUpperCase(), name: m[2] })
  }
  return out
}

/** `bluetoothctl info MAC` → paired / connected. */
export function parseBtInfo(text: string): { paired: boolean; connected: boolean } {
  const yes = (key: string): boolean => new RegExp(`^\\s*${key}:\\s*yes`, 'mi').test(text)
  return { paired: yes('Paired'), connected: yes('Connected') }
}

const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/i

// ───────────────────────── estado ─────────────────────────

export async function readNet(): Promise<NetState> {
  const state: NetState = {
    wifi: { available: false, enabled: false, device: '', ssid: null, networks: [] },
    bluetooth: { available: false, powered: false, adapter: '', devices: [] }
  }

  const devs = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE', 'dev'])
  const wifi = devs.stdout
    .split('\n')
    .map(splitTerse)
    .find((d) => d[1] === 'wifi')
  if (wifi) {
    state.wifi.available = true
    state.wifi.device = wifi[0]
    state.wifi.enabled = /^(activado|enabled)$/i.test(
      (await run('nmcli', ['radio', 'wifi'])).stdout.trim()
    )
    if (state.wifi.enabled) {
      const saved = await run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show'])
      const known = new Set(
        saved.stdout
          .split('\n')
          .map(splitTerse)
          .filter((c) => c[1] === '802-11-wireless')
          .map((c) => c[0])
      )
      const list = await run('nmcli', [
        '-t',
        '-f',
        'IN-USE,SSID,SIGNAL,SECURITY',
        'dev',
        'wifi',
        'list'
      ])
      state.wifi.networks = parseWifiList(list.stdout, known)
      state.wifi.ssid = state.wifi.networks.find((n) => n.inUse)?.ssid ?? null
    }
  }

  const show = await run('bluetoothctl', ['show'])
  if (show.code === 0 && /Controller/.test(show.stdout)) {
    state.bluetooth.available = true
    state.bluetooth.powered = /Powered:\s*yes/i.test(show.stdout)
    state.bluetooth.adapter = /Name:\s*(.*)/.exec(show.stdout)?.[1]?.trim() ?? ''
    if (state.bluetooth.powered) {
      const devices = parseBtDevices((await run('bluetoothctl', ['devices'])).stdout)
      const full: BluetoothDevice[] = await Promise.all(
        devices.map(async (d) => ({
          ...d,
          ...parseBtInfo((await run('bluetoothctl', ['info', d.mac])).stdout)
        }))
      )
      state.bluetooth.devices = full.sort(
        (a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name)
      )
    }
  }
  return state
}

// ───────────────────────── acciones ─────────────────────────

const fail = (message: string): NetResult => ({ ok: false, message })

export async function wifiConnect(ssid: string, password?: string): Promise<NetResult> {
  if (!ssid || ssid.length > 32) return fail('Nombre de red no válido')
  if (password !== undefined && (password.length < 8 || password.length > 63)) {
    return fail('La contraseña debe tener entre 8 y 63 caracteres')
  }
  const r =
    password === undefined
      ? await run('nmcli', ['connection', 'up', 'id', ssid], undefined, 30_000)
      : await run('nmcli', ['--ask', 'dev', 'wifi', 'connect', ssid], `${password}\n`, 30_000)
  return r.code === 0
    ? { ok: true, message: `Conectado a «${ssid}»` }
    : fail(r.stderr.trim().split('\n')[0] || 'No se pudo conectar')
}

export async function wifiDisconnect(device: string): Promise<NetResult> {
  if (!/^[\w.-]+$/.test(device)) return fail('Dispositivo no válido')
  const r = await run('nmcli', ['dev', 'disconnect', device])
  return r.code === 0 ? { ok: true, message: 'Wi-Fi desconectado' } : fail(r.stderr.trim())
}

export async function wifiPower(on: boolean): Promise<NetResult> {
  const r = await run('nmcli', ['radio', 'wifi', on ? 'on' : 'off'])
  return r.code === 0
    ? { ok: true, message: `Wi-Fi ${on ? 'activado' : 'desactivado'}` }
    : fail(r.stderr.trim())
}

export async function btPower(on: boolean): Promise<NetResult> {
  const r = await run('bluetoothctl', ['power', on ? 'on' : 'off'])
  return /succeeded/i.test(r.stdout)
    ? { ok: true, message: `Bluetooth ${on ? 'activado' : 'desactivado'}` }
    : fail(
        r.stdout.trim().split('\n').pop() || r.stderr.trim() || 'No se pudo cambiar el Bluetooth'
      )
}

export async function btConnect(mac: string, connect: boolean): Promise<NetResult> {
  if (!MAC.test(mac)) return fail('Dirección Bluetooth no válida')
  const r = await run('bluetoothctl', [connect ? 'connect' : 'disconnect', mac], undefined, 20_000)
  return /successful/i.test(r.stdout)
    ? { ok: true, message: connect ? 'Dispositivo conectado' : 'Dispositivo desconectado' }
    : fail(r.stdout.trim().split('\n').pop() || 'No se pudo completar la operación')
}

/** Busca dispositivos Bluetooth cercanos durante unos segundos. */
export async function btScan(): Promise<NetResult> {
  await run('bluetoothctl', ['--timeout', '6', 'scan', 'on'], undefined, 10_000)
  return { ok: true, message: 'Búsqueda terminada' }
}

export async function wifiScan(): Promise<NetResult> {
  await run('nmcli', ['dev', 'wifi', 'rescan'])
  return { ok: true, message: 'Búsqueda de redes iniciada' }
}
