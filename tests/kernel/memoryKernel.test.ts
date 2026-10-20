import { describe, expect, it } from 'vitest'
import { createPcb } from '@kernel/process/pcb'
import { kernelWith, prog, run } from './helpers'

const forever = 'x: SLEEP 5\nLOOP x'

/**
 * RAM de 160 KB (32 del SO). A, B, C y D ocupan 32 KB cada uno, contiguos.
 * A y C terminan enseguida y dejan dos huecos de 32 KB separados por B:
 * hay 64 KB libres, pero E (64 KB) no cabe en ninguno.
 */
function fragmentationScenario(autoCompact: boolean) {
  return kernelWith(
    [
      prog('a', 'CPU 1', { memoryKb: 32 }),
      prog('b', forever, { memoryKb: 32 }),
      prog('c', 'CPU 1', { memoryKb: 32 }),
      prog('d', forever, { memoryKb: 32 }),
      prog('e', 'CPU 2', { memoryKb: 64, arrival: 5 })
    ],
    { policy: 'RR', memory: { totalKb: 160, osKb: 32, unitKb: 16, autoCompact } }
  )
}

describe('Memoria en el kernel', () => {
  it('admite a memoria con registro base y libera al terminar', () => {
    const k = kernelWith([prog('a', 'CPU 3', { memoryKb: 40 })], {
      memory: { totalKb: 256, osKb: 64, unitKb: 16 }
    })
    run(k, 1)
    expect(k.process(1)).toMatchObject({ memBase: 64, memSize: 48 })
    expect(k.memoryInfo().stats.internalFragmentationKb).toBe(8)
    run(k, 5)
    expect(k.process(1)!.state).toBe('TERMINATED')
    expect(k.memoryInfo().stats.usedKb).toBe(0)
  })

  it('sin memoria, el proceso se admite en el área de intercambio y entra al liberarse espacio', () => {
    const k = kernelWith(
      [prog('a', 'CPU 4', { memoryKb: 64 }), prog('b', 'CPU 2', { memoryKb: 64 })],
      { policy: 'FCFS', memory: { totalKb: 128, osKb: 32, unitKb: 16 } }
    )
    run(k, 1)
    expect(k.process(2)).toMatchObject({ state: 'READY_SUSPENDED', memWait: 'no-memory' })
    expect(k.memoryInfo().waiting.map((w) => w.pid)).toEqual([2])
    run(k, 8)
    expect(k.process(2)!.state).toBe('TERMINATED')
    expect(k.memoryInfo().stats.swapIns).toBe(1)
  })

  it('muestra la fragmentación externa y la resuelve con compactación manual', () => {
    const k = fragmentationScenario(false)
    run(k, 10)
    const e = k.process(5)!
    expect(e).toMatchObject({ state: 'READY_SUSPENDED', memWait: 'fragmentation' })
    const before = k.memoryInfo()
    expect(before.stats).toMatchObject({ freeKb: 64, largestHoleKb: 32, holeCount: 2 })
    expect(before.stats.externalFragmentation).toBeCloseTo(0.5)
    expect(k.log.all().some((ev) => ev.message.startsWith('Fragmentación externa: PID 5'))).toBe(
      true
    )

    k.command({ type: 'compact' })
    // B y D se desplazan a direcciones bajas: sus registros base cambian.
    expect(k.process(2)!.memBase).toBe(32)
    expect(k.process(4)!.memBase).toBe(64)
    expect(k.memoryInfo().stats).toMatchObject({ holeCount: 1, largestHoleKb: 64, compactions: 1 })
    run(k, 8)
    expect(k.gantt.all().some((g) => g.kind === 'os')).toBe(true)
    expect(k.process(5)!.state).toBe('TERMINATED')
  })

  it('con compactación automática el kernel compacta solo y paga el costo en CPU', () => {
    const k = fragmentationScenario(true)
    run(k, 20)
    expect(k.process(5)!.state).toBe('TERMINATED')
    expect(k.memoryInfo().stats.compactions).toBe(1)
    expect(k.stats().osTicks).toBeGreaterThan(0)
  })

  it('intercambia un proceso bloqueado de menor prioridad para cargar uno de mayor prioridad', () => {
    const k = kernelWith(
      [
        prog('lento', 'x: IO red 40\nCPU 1\nLOOP x', { memoryKb: 48, priority: 8 }),
        prog('urgente', 'CPU 3', { memoryKb: 32, priority: 1, arrival: 25 })
      ],
      { memory: { totalKb: 96, osKb: 32, unitKb: 16 } }
    )
    run(k, 30)
    expect(k.process(1)!.state).toBe('BLOCKED_SUSPENDED')
    expect(k.log.all().some((e) => e.message.startsWith('Swap out: PID 1'))).toBe(true)
    run(k, 10)
    expect(k.process(2)!.state).toBe('TERMINATED')
    run(k, 20) // termina la E/S de "lento": vuelve a memoria
    expect(k.process(1)!.memBase).not.toBeNull()
    // swap in de "urgente" (admitido en el área de intercambio) y de "lento" al volver
    expect(k.memoryInfo().stats).toMatchObject({ swapOuts: 1, swapIns: 2 })
  })
})

describe('Recubrimiento (overlays)', () => {
  const spec = prog('comp', 'OVERLAY a\nCPU 2\nOVERLAY b\nCPU 2\nOVERLAY b\nCPU 1', {
    memoryKb: 60,
    quantum: 10,
    overlays: { rootKb: 20, modules: { a: 40, b: 30 } }
  })

  it('carga cada módulo desde disco en el área común y no recarga el que ya está', () => {
    const k = kernelWith([spec])
    run(k, 1)
    expect(k.process(1)!.waitingOn).toEqual({ kind: 'overlay', module: 'a' })
    run(k, 2) // el disco carga «a» en el tick 2 y la IRQ llega en el 3
    expect(k.process(1)!.overlay).toMatchObject({ loaded: 'a', pending: null })
    run(k, 20)
    const p = k.process(1)!
    expect(p.state).toBe('TERMINATED')
    expect(p.overlay!.loaded).toBe('b')
    const loads = k.log.all().filter((e) => e.message.startsWith('Recubrimiento: carga'))
    expect(loads).toHaveLength(2)
    expect(k.log.all().some((e) => e.message.includes('«b» ya está en memoria'))).toBe(true)
  })

  it('valida la declaración de los módulos', () => {
    expect(() => createPcb(1, { ...spec, memoryKb: 50 }, 0)).toThrow(/necesita 60 KB/)
    expect(() => createPcb(1, { ...spec, source: 'OVERLAY z' }, 0)).toThrow(/no está declarado/)
  })

  it('el Compilador del sistema ahorra memoria gracias al recubrimiento', async () => {
    const { BOOT_PROGRAMS } = await import('@kernel/process/programs')
    const comp = BOOT_PROGRAMS.find((p) => p.id === 'compilador')!
    const all = Object.values(comp.overlays!.modules).reduce((a, b) => a + b, comp.overlays!.rootKb)
    expect(comp.memoryKb).toBeLessThan(all)
  })
})
