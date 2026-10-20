import { describe, expect, it } from 'vitest'
import { parseBtDevices, parseBtInfo, parseWifiList, splitTerse } from '../../src/main/hal/network'

describe('HAL de red: análisis de nmcli y bluetoothctl', () => {
  it('splitTerse respeta los dos puntos escapados', () => {
    expect(splitTerse('*:Casa\\:5G:80:WPA2')).toEqual(['*', 'Casa:5G', '80', 'WPA2'])
  })

  it('lista de redes Wi-Fi: sin duplicados, la conectada primero, luego por señal', () => {
    const text = [
      ' :Cafe:40:WPA2',
      '*:Casa:70:WPA2',
      ' :Casa:90:WPA2',
      ' :Vecino:85:WPA2 WPA3',
      ' :Libre:30:',
      ' ::50:WPA2'
    ].join('\n')
    const nets = parseWifiList(text, new Set(['Casa', 'Libre']))
    expect(nets.map((n) => n.ssid)).toEqual(['Casa', 'Vecino', 'Cafe', 'Libre'])
    expect(nets[0]).toMatchObject({ inUse: true, known: true })
    expect(nets.find((n) => n.ssid === 'Libre')).toMatchObject({ security: 'Abierta', known: true })
    expect(nets.find((n) => n.ssid === 'Vecino')!.known).toBe(false)
  })

  it('dispositivos y estado de Bluetooth', () => {
    const devices = parseBtDevices(
      'Device c0:16:93:3d:8b:15 Mi Teclado\nDevice AA:BB:CC:DD:EE:FF Audífonos\nbasura'
    )
    expect(devices).toEqual([
      { mac: 'C0:16:93:3D:8B:15', name: 'Mi Teclado' },
      { mac: 'AA:BB:CC:DD:EE:FF', name: 'Audífonos' }
    ])
    expect(parseBtInfo('Device X\n\tPaired: yes\n\tConnected: no')).toEqual({
      paired: true,
      connected: false
    })
    expect(parseBtInfo('\tPaired: no\n\tConnected: yes')).toEqual({
      paired: false,
      connected: true
    })
  })
})
