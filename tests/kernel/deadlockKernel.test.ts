import { describe, expect, it } from 'vitest'
import { AUTO_RECOVERY_DELAY, Kernel, type KernelOptions } from '@kernel/kernel'
import type { DeadlockPolicy } from '@shared/kernelTypes'
import { kernelWith, prog, run } from './helpers'

const resources = [
  { id: 'r1', name: 'R1', instances: 1 },
  { id: 'r2', name: 'R2', instances: 1 }
]

/** A toma r1 y luego r2; B toma r2 y luego r1 (orden inverso). */
const pair = (opts: KernelOptions = {}) =>
  kernelWith(
    [
      prog('a', 'REQ r1\nCPU 3\nREQ r2\nCPU 1\nREL r2\nREL r1', { priority: 3 }),
      prog('b', 'REQ r2\nCPU 3\nREQ r1\nCPU 1\nREL r1\nREL r2', { priority: 6 })
    ],
    { policy: 'RR', resources, ...opts }
  )

const deadlockEvents = (k: Kernel) =>
  k.log.all().filter((e) => e.message.startsWith('Interbloqueo detectado'))

describe('Interbloqueo con recursos', () => {
  it('se produce, se detecta y se muestra el ciclo del grafo de asignación', () => {
    const k = pair()
    run(k, 30)
    const dl = k.snapshot().resources.deadlock!
    expect(dl.pids).toEqual([1, 2])
    expect(new Set(dl.cycle)).toEqual(new Set(['P1', 'r2', 'P2', 'r1']))
    expect(deadlockEvents(k)).toHaveLength(1)
    expect(deadlockEvents(k)[0].level).toBe('critical')
    // Sin recuperación los dos quedan bloqueados para siempre.
    run(k, 100)
    expect([k.process(1)!.state, k.process(2)!.state]).toEqual(['BLOCKED', 'BLOCKED'])
  })

  it('recuperación por retroceso: la víctima (menor prioridad) suelta todo y reinicia', () => {
    const k = pair()
    run(k, 30)
    k.command({ type: 'recoverDeadlock' })
    expect(k.process(2)).toMatchObject({ rollbacks: 1, pc: 0 })
    expect(k.process(2)!.resources).toEqual({})
    run(k, 40)
    expect(k.process(1)!.state).toBe('TERMINATED')
    expect(k.process(2)!.state).toBe('TERMINATED')
  })

  it('recuperación abortando a la víctima', () => {
    const k = pair({ recovery: 'kill' })
    run(k, 30)
    k.command({ type: 'recoverDeadlock' })
    expect(k.process(2)!.exitReason).toMatch(/interbloqueo/)
    run(k, 20)
    expect(k.process(1)!.state).toBe('TERMINATED')
  })

  it('con recuperación automática, el kernel la aplica tras unos ticks visibles', () => {
    const k = pair({ autoRecover: true })
    run(k, 30 + AUTO_RECOVERY_DELAY + 40)
    expect(k.snapshot().resources.stats).toMatchObject({ deadlocks: 1, recoveries: 1 })
    expect(k.processes().every((p) => p.state === 'TERMINATED')).toBe(true)
  })

  it.each([
    ['AVOID', /Banquero/],
    ['PREVENT', /Prevención/]
  ] as [DeadlockPolicy, RegExp][])(
    'con %s nunca se produce el interbloqueo',
    (policy, evidence) => {
      const k = pair({ deadlockPolicy: policy })
      run(k, 60)
      expect(deadlockEvents(k)).toHaveLength(0)
      expect(k.processes().every((p) => p.state === 'TERMINATED')).toBe(true)
      expect(k.log.all().some((e) => evidence.test(e.message))).toBe(true)
    }
  )

  it('con la estrategia del avestruz no se detecta, salvo que se pida', () => {
    const k = pair({ deadlockPolicy: 'IGNORE' })
    run(k, 30)
    expect(k.snapshot().resources.deadlock).toBeNull()
    k.command({ type: 'detectDeadlock' })
    expect(k.snapshot().resources.deadlock!.pids).toEqual([1, 2])
  })

  it('también detecta interbloqueos entre mutex', () => {
    const k = kernelWith(
      [
        prog('a', 'LOCK m1\nCPU 3\nLOCK m2\nUNLOCK m2\nUNLOCK m1'),
        prog('b', 'LOCK m2\nCPU 3\nLOCK m1\nUNLOCK m1\nUNLOCK m2')
      ],
      {
        policy: 'RR',
        resources,
        sync: { groups: [{ id: 'g', name: 'g', mutexes: ['m1', 'm2'] }] }
      }
    )
    run(k, 30)
    expect(k.snapshot().resources.deadlock!.resources.sort()).toEqual(['mutex:m1', 'mutex:m2'])
    k.command({ type: 'recoverDeadlock' })
    run(k, 30)
    expect(k.processes().every((p) => p.state === 'TERMINATED')).toBe(true)
  })

  it('REL de un recurso que no se tiene y solicitudes que exceden lo declarado', () => {
    const k = kernelWith([prog('a', 'REL r1\nREQ r1\nCPU 1\nREL r1')], {
      resources,
      deadlockPolicy: 'AVOID'
    })
    // La necesidad máxima declarada es la mayor cantidad retenida a la vez.
    expect(k.process(1)!.maxClaim).toEqual({ r1: 1 })
    run(k, 5)
    expect(k.log.all().some((e) => e.message.includes('inválido'))).toBe(true)
  })
})

describe('Interbloqueo con los 15 programas', () => {
  it('Spooler y Respaldo USB llegan a un interbloqueo que se detecta y se recupera', () => {
    const k = new Kernel({ policy: 'PRIORITY_RR', autoRecover: true })
    run(k, 800)
    const st = k.snapshot().resources.stats
    expect(st.deadlocks).toBeGreaterThan(0)
    expect(st.recoveries).toBeGreaterThan(0)
    const first = deadlockEvents(k)[0]
    expect(first.message).toMatch(/Impresora/)
    expect(first.message).toMatch(/Unidad USB/)
  })

  it.each(['AVOID', 'PREVENT'] as DeadlockPolicy[])('con %s no hay interbloqueos', (policy) => {
    const k = new Kernel({ policy: 'PRIORITY_RR', deadlockPolicy: policy })
    run(k, 800)
    expect(k.snapshot().resources.stats.deadlocks).toBe(0)
    const spooler = k.processes().find((p) => p.programId === 'spooler')!
    expect(spooler.ioCount).toBeGreaterThan(5)
  })
})
