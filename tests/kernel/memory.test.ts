import { describe, expect, it } from 'vitest'
import { MemoryManager } from '@kernel/memory/memoryManager'
import type { FitPolicy } from '@shared/kernelTypes'

/** Memoria de 100 KB (SO en 0–9) con huecos de 30, 10 y 20 KB tras liberar 2 y 4. */
function fragmented(policy: FitPolicy): MemoryManager {
  const m = new MemoryManager({ totalKb: 100, osKb: 10, unitKb: 1, policy: 'FIRST' })
  m.allocate(1, 10) // 10–19
  m.allocate(2, 30) // 20–49
  m.allocate(3, 10) // 50–59
  m.allocate(4, 10) // 60–69
  m.allocate(5, 10) // 70–79
  m.free(2)
  m.free(4)
  m.policy = policy
  return m // huecos: 20–49 (30), 60–69 (10), 80–99 (20)
}

describe('Particiones dinámicas', () => {
  it.each([
    ['FIRST', 20],
    ['BEST', 60],
    ['WORST', 20],
    ['NEXT', 80]
  ] as const)('%s coloca 8 KB en la dirección %i', (policy, base) => {
    expect(fragmented(policy).allocate(9, 8)!.base).toBe(base)
  })

  it('el mejor ajuste elige el hueco más pequeño que alcanza', () => {
    expect(fragmented('BEST').allocate(9, 15)!.base).toBe(80)
  })

  it('al liberar, los huecos adyacentes se fusionan', () => {
    const m = fragmented('FIRST')
    m.free(3)
    expect(m.holes()).toEqual([
      { base: 20, size: 50 },
      { base: 80, size: 20 }
    ])
  })

  it('redondea a la unidad de asignación y cuenta la fragmentación interna', () => {
    const m = new MemoryManager({ totalKb: 256, osKb: 64, unitKb: 16, policy: 'FIRST' })
    const p = m.allocate(1, 72)!
    expect(p.size).toBe(80)
    expect(m.stats().internalFragmentationKb).toBe(8)
  })

  it('detecta fragmentación externa: hay memoria libre suficiente pero no contigua', () => {
    const m = fragmented('FIRST')
    expect(m.allocate(9, 40)).toBeNull()
    expect(m.fitsAfterCompaction(40)).toBe(true)
    const st = m.stats()
    expect(st).toMatchObject({ freeKb: 60, largestHoleKb: 30, holeCount: 3 })
    expect(st.externalFragmentation).toBeCloseTo(0.5)
  })

  it('la compactación deja un único hueco, conserva el orden y reubica', () => {
    const m = fragmented('FIRST')
    const moves = m.compact()
    expect(moves).toEqual([
      { pid: 3, from: 50, to: 20, size: 10 },
      { pid: 5, from: 70, to: 30, size: 10 }
    ])
    expect(m.holes()).toEqual([{ base: 40, size: 60 }])
    expect(m.stats().externalFragmentation).toBe(0)
    expect(m.allocate(9, 40)!.base).toBe(40)
  })

  it('mantiene sus invariantes con miles de operaciones aleatorias', () => {
    let seed = 7
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    for (const policy of ['FIRST', 'BEST', 'WORST', 'NEXT'] as const) {
      const m = new MemoryManager({ totalKb: 1024, osKb: 128, unitKb: 16, policy })
      const live = new Set<number>()
      for (let i = 1; i <= 3000; i++) {
        if (live.size > 0 && rnd() < 0.45) {
          const pid = [...live][Math.floor(rnd() * live.size)]
          m.free(pid)
          live.delete(pid)
        } else if (rnd() < 0.05) {
          m.compact()
        } else if (m.allocate(i, 8 + Math.floor(rnd() * 200))) {
          live.add(i)
        }
        const parts = m.partitions()
        for (let j = 0; j < parts.length; j++) {
          expect(parts[j].base).toBeGreaterThanOrEqual(128)
          expect(parts[j].base + parts[j].size).toBeLessThanOrEqual(1024)
          if (j > 0)
            expect(parts[j].base).toBeGreaterThanOrEqual(parts[j - 1].base + parts[j - 1].size)
        }
        const st = m.stats()
        const holes = m.holes().reduce((n, h) => n + h.size, 0)
        expect(st.usedKb + holes).toBe(1024 - 128)
      }
    }
  })
})
