import { describe, expect, it } from 'vitest'
import { LOW_BATTERY } from '@kernel/kernel'
import type { HwStorage } from '@shared/kernelTypes'
import { kernelWith, prog, run } from './helpers'

const usb: HwStorage = {
  id: 'sdb1',
  label: 'KINGSTON',
  mount: '/media/juan/KINGSTON',
  sizeBytes: 16e9,
  model: 'DataTraveler',
  fstype: 'vfat'
}

describe('Teclado y ratón reales', () => {
  it('la E/S de teclado espera una tecla real y la IRQ despierta al proceso', () => {
    const k = kernelWith([prog('editor', 'IO teclado 3\nCPU 1')], { realDevices: true })
    run(k, 20)
    expect(k.process(1)!.state).toBe('BLOCKED')
    k.command({ type: 'hwEvent', event: { kind: 'key', key: 'a' } })
    run(k, 1)
    expect(k.process(1)!.state).not.toBe('BLOCKED')
    expect(k.log.all().some((e) => e.message.includes('tecla «a»'))).toBe(true)
  })

  it('la tecla va al proceso de la ventana activa, aunque no sea el primero en la cola', () => {
    const k = kernelWith(
      [prog('terminal', 'IO teclado 1\nCPU 1'), prog('editor', 'IO teclado 1\nCPU 1')],
      { realDevices: true }
    )
    run(k, 5)
    k.command({ type: 'hwEvent', event: { kind: 'key', key: 'x', target: 'editor' } })
    run(k, 1)
    expect(k.process(2)!.state).not.toBe('BLOCKED')
    expect(k.process(1)!.state).toBe('BLOCKED')
  })

  it('las teclas sin nadie esperando quedan en el búfer del teclado', () => {
    const k = kernelWith([prog('editor', 'SLEEP 3\nIO teclado 1\nCPU 1')], { realDevices: true })
    k.command({ type: 'hwEvent', event: { kind: 'key', key: 'q' } })
    expect(k.snapshot().devices.find((d) => d.id === 'teclado')!.buffered).toBe(1)
    run(k, 10)
    expect(k.process(1)!.state).toBe('TERMINATED')
  })

  it('el ratón real completa la espera de ratón', () => {
    const k = kernelWith([prog('finder', 'IO raton 5\nCPU 1')], { realDevices: true })
    run(k, 10)
    expect(k.process(1)!.state).toBe('BLOCKED')
    k.command({ type: 'hwEvent', event: { kind: 'mouse', action: 'click' } })
    run(k, 2)
    expect(k.process(1)!.state).toBe('TERMINATED')
  })
})

describe('Memoria USB real', () => {
  const respaldo = prog('respaldo', 'FREAD /Usuarios/juan/Documentos/informe.txt\nIO usb 3\nCPU 1')

  it('sin memoria USB la transferencia no avanza; al conectarla termina y se copia el archivo', () => {
    const k = kernelWith([respaldo], { realDevices: true })
    k.command({ type: 'setUsbStrict', enabled: true })
    run(k, 40)
    expect(k.process(1)!.waitingOn).toEqual({ kind: 'io', device: 'usb' })
    expect(k.snapshot().devices.find((d) => d.id === 'usb')!.medium).toBe(false)
    k.command({ type: 'hwEvent', event: { kind: 'storageAttach', storage: usb } })
    run(k, 6)
    expect(k.process(1)!.state).toBe('TERMINATED')
    const [effect] = k.drainEffects()
    expect(effect).toMatchObject({
      type: 'usbWrite',
      mount: usb.mount,
      fileName: 'respaldo_001_informe.txt'
    })
    expect(effect.type === 'usbWrite' && effect.content).toMatch(/Informe de Sistemas de Operación/)
    expect(k.drainEffects()).toEqual([])
  })

  it('con la copia desactivada no se escribe en la memoria real', () => {
    const k = kernelWith([respaldo], { realDevices: true })
    k.command({ type: 'hwEvent', event: { kind: 'storageAttach', storage: usb } })
    k.command({ type: 'setUsbBackup', enabled: false })
    run(k, 30)
    expect(k.drainEffects()).toEqual([])
  })

  it('sin memoria conectada (y sin exigirla) la USB real se simula', () => {
    const k = kernelWith([respaldo], { realDevices: true })
    run(k, 30)
    expect(k.process(1)!.state).toBe('TERMINATED')
    expect(k.drainEffects()).toEqual([])
  })

  it('en modo simulado la USB es un dispositivo temporizado más', () => {
    const k = kernelWith([respaldo])
    run(k, 30)
    expect(k.process(1)!.state).toBe('TERMINATED')
    expect(k.drainEffects()).toEqual([])
  })
})

describe('Impresora, energía y Editor', () => {
  it('al terminar la E/S de impresora se manda a imprimir el documento leído', () => {
    const k = kernelWith([
      prog('spooler', 'FREAD /Usuarios/juan/Documentos/tarea_SO.txt\nIO impresora 2')
    ])
    run(k, 30)
    const [effect] = k.drainEffects()
    expect(effect).toMatchObject({
      type: 'print',
      title: 'tarea_SO.txt',
      owner: 'spooler',
      jobId: 1
    })
  })

  it('sin cargador y con poca batería entra en modo de bajo consumo', () => {
    const k = kernelWith([])
    const before = k.tickInterval
    k.command({ type: 'hwEvent', event: { kind: 'power', ac: true, battery: 50 } })
    k.command({ type: 'hwEvent', event: { kind: 'power', ac: false, battery: LOW_BATTERY - 5 } })
    expect(k.snapshot().hardware.lowPower).toBe(true)
    expect(k.tickInterval).toBeGreaterThan(before)
    k.command({ type: 'hwEvent', event: { kind: 'power', ac: true, battery: LOW_BATTERY - 4 } })
    expect(k.snapshot().hardware.lowPower).toBe(false)
    expect(k.tickInterval).toBe(before)
    expect(k.log.all().some((e) => e.message === 'IRQ Energía: cargador conectado')).toBe(true)
  })

  it('el proceso Editor guarda en disco el texto que el usuario escribió', () => {
    const k = kernelWith([prog('editor', 'FWRITE /Usuarios/juan/Documentos/notas.txt 8')])
    k.command({
      type: 'docUpdate',
      path: '/Usuarios/juan/Documentos/notas.txt',
      text: 'Escrito con el teclado real'
    })
    run(k, 20)
    const info = k.query({ type: 'fileInfo', path: '/Usuarios/juan/Documentos/notas.txt' }) as {
      preview: string
    }
    expect(info.preview).toBe('Escrito con el teclado real')
  })

  it('guarda imágenes binarias (fotos de la cámara) y las devuelve como data URL', () => {
    const k = kernelWith([])
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
    k.command({
      type: 'fsWriteBinary',
      path: '/Usuarios/juan/Imágenes/foto.png',
      base64: btoa(String.fromCharCode(...png))
    })
    const info = k.query({ type: 'fileInfo', path: '/Usuarios/juan/Imágenes/foto.png' }) as {
      image: string
    }
    expect(info.image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
  })
})
