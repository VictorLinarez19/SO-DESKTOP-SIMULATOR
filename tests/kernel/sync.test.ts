import { describe, expect, it } from 'vitest'
import { Kernel } from '@kernel/kernel'
import type { SyncConfig } from '@kernel/sync/syncManager'
import { kernelWith, prog, run } from './helpers'

const SYNC: SyncConfig = {
  groups: [
    {
      id: 'pc',
      name: 'Productor–consumidor',
      semaphores: [
        { name: 'vacios', initial: 3 },
        { name: 'llenos', initial: 0 },
        { name: 's', initial: 1 }
      ],
      mutexes: ['mb'],
      buffers: [{ name: 'buf', capacity: 3 }],
      counting: { empty: 'vacios', full: 'llenos', buffer: 'buf' }
    },
    { id: 'cs', name: 'Sección crítica', mutexes: ['m'], variables: [{ name: 'x', initial: 0 }] }
  ]
}

const opts = { policy: 'RR' as const, sync: SYNC }

/** Dos procesos suman 1 a x veinte veces; la sección crítica dura más que el quantum. */
const incrementer = (id: string): ReturnType<typeof prog> =>
  prog(id, 'v: LOCK m\nLOAD x\nCPU 2\nADDI 1\nSTORE x\nUNLOCK m\nLOOP v 20', { quantum: 1 })

describe('Semáforos', () => {
  it('WAIT decrementa; con valor 0 bloquea, y SIGNAL despierta en orden FIFO', () => {
    const k = kernelWith(
      [
        prog('a', 'WAIT s\nCPU 5\nSIGNAL s\nCPU 1', { quantum: 1 }),
        prog('b', 'WAIT s\nCPU 1\nSIGNAL s'),
        prog('c', 'WAIT s\nCPU 1')
      ],
      opts
    )
    run(k, 3)
    expect(k.snapshot().sync.semaphores.find((s) => s.name === 's')).toMatchObject({
      value: 0,
      queue: [2, 3]
    })
    expect(k.process(2)!.waitingOn).toEqual({ kind: 'sync', object: 's', op: 'WAIT' })
    run(k, 20)
    const order = k.log
      .all()
      .filter((e) => e.message.startsWith('SIGNAL s: despierta'))
      .map((e) => e.message.at(-1))
    expect(order).toEqual(['2', '3'])
    expect(k.processes().every((p) => p.state === 'TERMINATED')).toBe(true)
  })
})

describe('Mutex y condición de carrera', () => {
  it('con el mutex nunca hay dos procesos en la sección crítica y no se pierden actualizaciones', () => {
    const k = kernelWith([incrementer('a'), incrementer('b')], opts)
    for (let t = 0; t < 400; t++) {
      k.tick()
      const owner = k.snapshot().sync.mutexes.find((m) => m.name === 'm')!.owner
      const inside = k.processes().filter((p) => p.holds.includes('m'))
      expect(inside.length).toBeLessThanOrEqual(1)
      if (owner !== null) expect(inside[0].pid).toBe(owner)
    }
    const x = k.snapshot().sync.variables[0]
    expect(x).toMatchObject({ value: 40, expected: 40 })
    expect(k.log.all().some((e) => e.message.includes('ocupado por PID'))).toBe(true)
  })

  it('sin el mutex se produce una condición de carrera y se pierden actualizaciones', () => {
    const k = kernelWith([incrementer('a'), incrementer('b')], opts)
    k.command({ type: 'setSyncEnabled', group: 'cs', enabled: false })
    run(k, 400)
    const x = k.snapshot().sync.variables[0]
    expect(x.expected).toBe(40)
    expect(x.value).toBeLessThan(40)
    expect(k.log.all().some((e) => e.message.startsWith('Condición de carrera'))).toBe(true)
  })

  it('UNLOCK de quien no es dueño es inválido y no libera el mutex', () => {
    const k = kernelWith(
      [prog('a', 'LOCK m\nCPU 10\nUNLOCK m'), prog('b', 'CPU 1\nUNLOCK m\nCPU 1')],
      opts
    )
    run(k, 5)
    expect(k.log.all().some((e) => e.message.includes('no es su dueño'))).toBe(true)
    expect(k.snapshot().sync.mutexes.find((m) => m.name === 'm')!.owner).toBe(1)
  })

  it('si el dueño termina, el mutex pasa al siguiente en espera', () => {
    const k = kernelWith([prog('a', 'LOCK m\nCPU 50'), prog('b', 'LOCK m\nCPU 1')], opts)
    run(k, 4)
    expect(k.process(2)!.state).toBe('BLOCKED')
    k.command({ type: 'kill', pid: 1 })
    expect(k.snapshot().sync.mutexes.find((m) => m.name === 'm')!.owner).toBe(2)
    expect(k.process(2)!.state).toBe('READY')
  })
})

describe('Productor–consumidor con búfer acotado', () => {
  const producer = prog(
    'prod',
    'p: WAIT vacios\nLOCK mb\nPUT buf\nUNLOCK mb\nSIGNAL llenos\nLOOP p 30',
    {
      priority: 1
    }
  )
  const consumer = prog(
    'cons',
    'c: WAIT llenos\nLOCK mb\nGET buf\nUNLOCK mb\nSIGNAL vacios\nCPU 4\nLOOP c 30'
  )

  it('el productor se bloquea con el búfer lleno y nunca hay desbordamientos', () => {
    const k = kernelWith([producer, consumer], { ...opts, policy: 'PRIORITY_RR' })
    for (let t = 0; t < 300; t++) {
      k.tick()
      const b = k.snapshot().sync.buffers[0]
      expect(b.items.length).toBeLessThanOrEqual(b.capacity)
    }
    const b = k.snapshot().sync.buffers[0]
    expect(b).toMatchObject({ produced: 30, consumed: 30, overflows: 0, underflows: 0 })
    expect(
      k.log.all().some((e) => e.pid === 1 && e.message.startsWith('WAIT vacios: vale 0'))
    ).toBe(true)
  })

  it('sin sincronización el búfer se desborda y se pierden datos', () => {
    const k = kernelWith([producer, consumer], { ...opts, policy: 'PRIORITY_RR' })
    k.command({ type: 'setSyncEnabled', group: 'pc', enabled: false })
    run(k, 300)
    expect(k.snapshot().sync.buffers[0].overflows).toBeGreaterThan(0)
  })

  it('al reactivar, los semáforos contadores se reinicializan según el búfer', () => {
    const k = kernelWith([producer, consumer], { ...opts, policy: 'PRIORITY_RR' })
    k.command({ type: 'setSyncEnabled', group: 'pc', enabled: false })
    run(k, 20)
    k.command({ type: 'setSyncEnabled', group: 'pc', enabled: true })
    const s = k.snapshot().sync
    const n = s.buffers[0].items.length
    expect(s.semaphores.find((x) => x.name === 'llenos')!.value).toBe(n)
    expect(s.semaphores.find((x) => x.name === 'vacios')!.value).toBe(3 - n)
  })

  it('rechaza programas que usan objetos no declarados', () => {
    expect(() => kernelWith([prog('z', 'WAIT nada')], opts)).toThrow(/no está declarado/)
  })
})

describe('Los 15 programas del sistema', () => {
  it.each(['PRIORITY_RR', 'RR'] as const)('con %s la sincronización es correcta', (policy) => {
    const k = new Kernel({ policy })
    run(k, 800)
    const s = k.snapshot().sync
    const v = s.variables.find((x) => x.name === 'red_bytes')!
    expect(v.value).toBe(v.expected)
    expect(v.value).toBeGreaterThan(0)
    const b = s.buffers.find((x) => x.name === 'buffer')!
    expect(b).toMatchObject({ overflows: 0, underflows: 0 })
    expect(b.consumed).toBeGreaterThan(0)
  })

  it('sin sincronización aparecen actualizaciones perdidas y desbordamientos', () => {
    const k = new Kernel({ policy: 'PRIORITY_RR' })
    k.command({ type: 'setSyncEnabled', group: 'pc', enabled: false })
    k.command({ type: 'setSyncEnabled', group: 'cs', enabled: false })
    run(k, 800)
    const s = k.snapshot().sync
    const v = s.variables.find((x) => x.name === 'red_bytes')!
    expect(v.value).toBeLessThan(v.expected)
    expect(s.buffers[0].overflows).toBeGreaterThan(0)
  })
})
