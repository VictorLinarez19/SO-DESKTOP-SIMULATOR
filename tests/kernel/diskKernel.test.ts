import { describe, expect, it } from 'vitest'
import { Kernel } from '@kernel/kernel'
import { MemoryBlockDevice } from '@kernel/disk/blockDevice'
import type { FileDetails } from '@shared/kernelTypes'
import { kernelWith, prog, run } from './helpers'

describe('Disco y sistema de archivos en el kernel', () => {
  it('FREAD lee bloques reales y bloquea al proceso hasta que el brazo lo atiende', () => {
    const k = kernelWith([prog('lector', 'FREAD /Usuarios/juan/Documentos/informe.txt\nCPU 1')])
    run(k, 1)
    const p = k.process(1)!
    expect(p.waitingOn).toEqual({
      kind: 'file',
      op: 'read',
      path: '/Usuarios/juan/Documentos/informe.txt'
    })
    expect(k.snapshot().disk.arm.queue.length + (k.snapshot().disk.arm.current ? 1 : 0)).toBe(1)
    for (let i = 0; i < 30 && k.process(1)!.state !== 'TERMINATED'; i++) k.tick()
    expect(k.process(1)!.state).toBe('TERMINATED')
    expect(k.snapshot().disk.io).toMatchObject({ reads: 1, kbRead: 24 })
    expect(k.log.all().some((e) => /lee .*informe\.txt · 24 KB · bloques/.test(e.message))).toBe(
      true
    )
  })

  it('FWRITE guarda contenido real que luego se puede leer', () => {
    const k = kernelWith([prog('escritor', 'FWRITE /Usuarios/juan/Documentos/nuevo.txt 4')])
    run(k, 20)
    const info = k.query({
      type: 'fileInfo',
      path: '/Usuarios/juan/Documentos/nuevo.txt'
    }) as FileDetails
    expect(info.entry.size).toBe(4096)
    expect(info.blocks).toHaveLength(1)
    expect(info.preview).toMatch(/guardado por escritor/)
  })

  it('el disco persiste al reiniciar el kernel y al volver a montarlo', () => {
    const disk = new MemoryBlockDevice()
    const k = kernelWith([], { disk })
    k.command({
      type: 'fsWriteText',
      path: '/Usuarios/juan/Documentos/hola.txt',
      text: 'hola mundo'
    })
    k.command({ type: 'reset' })
    expect(k.snapshot().disk.mountCount).toBe(1)
    const other = new Kernel({ disk, programs: [] })
    expect(other.snapshot().disk.mountCount).toBe(2)
    const info = other.query({
      type: 'fileInfo',
      path: '/Usuarios/juan/Documentos/hola.txt'
    }) as FileDetails
    expect(info.preview).toBe('hola mundo')
  })

  it('las operaciones del Finder crean y borran', () => {
    const k = kernelWith([])
    k.command({ type: 'fsMkdir', path: '/Usuarios/juan/Nueva' })
    expect(k.snapshot().disk.files.some((f) => f.path === '/Usuarios/juan/Nueva')).toBe(true)
    k.command({ type: 'fsDelete', path: '/Usuarios/juan/Nueva' })
    expect(k.snapshot().disk.files.some((f) => f.path === '/Usuarios/juan/Nueva')).toBe(false)
    k.command({ type: 'fsDelete', path: '/Usuarios' })
    expect(k.log.all().at(-1)!.level).toBe('warning')
  })

  it('la imagen de un proceso intercambiado se escribe en el área de swap del disco', () => {
    const k = kernelWith(
      [prog('a', 'x: IO red 40\nLOOP x', { memoryKb: 64 }), prog('b', 'CPU 1')],
      { memory: { totalKb: 160, osKb: 32, unitKb: 16 } }
    )
    run(k, 3)
    k.command({ type: 'suspend', pid: 1 })
    expect(k.snapshot().disk.usage.swapUsed).toBe(16)
    // Hay memoria: al reactivarlo se lee su imagen del área de intercambio y esta se libera.
    k.command({ type: 'activate', pid: 1 })
    expect(k.process(1)!.state).toBe('BLOCKED')
    expect(k.process(1)!.memBase).not.toBeNull()
    expect(k.snapshot().disk.usage.swapUsed).toBe(0)
  })

  it('cambiar el algoritmo del brazo', () => {
    const k = kernelWith([])
    k.command({ type: 'setDiskPolicy', policy: 'CLOOK' })
    expect(k.snapshot().disk.arm.policy).toBe('CLOOK')
  })
})

describe('Disco con los 15 programas', () => {
  it('los programas leen y escriben archivos reales', () => {
    const k = new Kernel({ policy: 'RR' })
    run(k, 400)
    const d = k.snapshot().disk
    expect(d.io.reads).toBeGreaterThan(20)
    expect(d.io.writes).toBeGreaterThan(3)
    expect(d.files.some((f) => f.path === '/Usuarios/juan/Proyectos/a.out')).toBe(true)
    expect(d.arm.stats.totalMovement).toBeGreaterThan(0)
  })

  it('SSTF recorre menos cilindros por solicitud que FCFS con la misma carga', () => {
    const seek = (diskPolicy: 'FCFS' | 'SSTF'): number => {
      const k = new Kernel({ policy: 'RR', diskPolicy })
      run(k, 800)
      return k.snapshot().disk.arm.stats.avgSeek
    }
    expect(seek('SSTF')).toBeLessThan(seek('FCFS'))
  })
})
