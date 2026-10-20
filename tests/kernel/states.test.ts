import { describe, expect, it } from 'vitest'
import { canTransition } from '@kernel/process/states'
import { kernelWith, prog, run } from './helpers'

describe('Máquina de 7 estados', () => {
  it.each([
    ['NEW', 'READY'],
    ['READY', 'RUNNING'],
    ['RUNNING', 'READY'],
    ['RUNNING', 'BLOCKED'],
    ['BLOCKED', 'READY'],
    ['BLOCKED', 'BLOCKED_SUSPENDED'],
    ['BLOCKED_SUSPENDED', 'READY_SUSPENDED'],
    ['READY_SUSPENDED', 'READY'],
    ['RUNNING', 'TERMINATED']
  ] as const)('permite %s → %s', (a, b) => expect(canTransition(a, b)).toBe(true))

  it.each([
    ['NEW', 'RUNNING'],
    ['BLOCKED', 'RUNNING'],
    ['READY', 'BLOCKED'],
    ['READY_SUSPENDED', 'RUNNING'],
    ['TERMINATED', 'READY']
  ] as const)('prohíbe %s → %s', (a, b) => expect(canTransition(a, b)).toBe(false))

  it('un proceso recorre Nuevo → Listo → Ejecución → Bloqueado → Listo → Terminado', () => {
    const k = kernelWith([prog('a', 'CPU 1\nIO disco 2\nCPU 1')])
    run(k, 10)
    const path = k.log
      .all()
      .filter((e) => e.kind === 'transition' && e.pid === 1)
      .map((e) => e.to)
    expect(path).toEqual(['READY', 'RUNNING', 'BLOCKED', 'READY', 'RUNNING', 'TERMINATED'])
  })

  it('suspender y reactivar usa los estados suspendidos', () => {
    const k = kernelWith([prog('a', 'x: IO disco 5\nLOOP x'), prog('b', 'x: CPU 9\nLOOP x')])
    run(k, 3) // a pidió E/S y está bloqueado
    expect(k.process(1)!.state).toBe('BLOCKED')
    k.command({ type: 'suspend', pid: 1 })
    expect(k.process(1)!.state).toBe('BLOCKED_SUSPENDED')
    run(k, 6) // la E/S termina estando suspendido
    expect(k.process(1)!.state).toBe('READY_SUSPENDED')
    k.command({ type: 'activate', pid: 1 })
    // Mediano plazo: reserva memoria y el brazo del disco va al área de intercambio a leer la imagen.
    expect(k.process(1)!.state).toBe('READY_SUSPENDED')
    for (let i = 0; i < 20 && k.process(1)!.state === 'READY_SUSPENDED'; i++) k.tick()
    expect(k.process(1)!.state).toBe('READY')
    expect(k.log.all().some((e) => e.message.startsWith('Swap in: carga PID 1'))).toBe(true)
  })

  it('kill termina al proceso desde cualquier estado y libera la CPU', () => {
    const k = kernelWith([prog('a', 'x: CPU 5\nLOOP x')])
    run(k, 3)
    expect(k.snapshot().cpu.pid).toBe(1)
    k.command({ type: 'kill', pid: 1 })
    expect(k.process(1)).toMatchObject({
      state: 'TERMINATED',
      exitReason: expect.stringMatching(/kill/)
    })
    expect(k.snapshot().cpu.pid).toBeNull()
  })
})

describe('Contadores de transiciones', () => {
  it('cuentan cada arista del diagrama', () => {
    const k = kernelWith([prog('a', 'CPU 1\nIO disco 2\nCPU 1')])
    run(k, 10)
    expect(k.snapshot().transitionCounts).toEqual({
      'NEW>READY': 1,
      'READY>RUNNING': 2,
      'RUNNING>BLOCKED': 1,
      'BLOCKED>READY': 1,
      'RUNNING>TERMINATED': 1
    })
  })
})
