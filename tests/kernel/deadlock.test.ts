import { describe, expect, it } from 'vitest'
import { detectDeadlock, findCycle, safetyCheck, type Vec } from '@kernel/resources/deadlock'

const R = ['A', 'B', 'C']
const m = (o: Record<number, Vec>): Map<number, Vec> =>
  new Map(Object.entries(o).map(([k, v]) => [Number(k), v]))

describe('Detección de interbloqueo', () => {
  it('ejemplo de Silberschatz sin interbloqueo', () => {
    // Disponible (0,0,0); P0..P4
    const deadlocked = detectDeadlock({
      resources: R,
      available: { A: 0, B: 0, C: 0 },
      allocation: m({
        0: { B: 1 },
        1: { A: 2 },
        2: { A: 3, C: 3 },
        3: { A: 2, B: 1, C: 1 },
        4: { C: 2 }
      }),
      request: m({ 0: {}, 1: { A: 2, C: 2 }, 2: {}, 3: { A: 1, B: 0, C: 0 }, 4: { C: 2 } })
    })
    expect(deadlocked).toEqual([])
  })

  it('el mismo ejemplo con P2 pidiendo una C más queda en interbloqueo', () => {
    const deadlocked = detectDeadlock({
      resources: R,
      available: { A: 0, B: 0, C: 0 },
      allocation: m({
        0: { B: 1 },
        1: { A: 2 },
        2: { A: 3, C: 3 },
        3: { A: 2, B: 1, C: 1 },
        4: { C: 2 }
      }),
      request: m({ 0: {}, 1: { A: 2, C: 2 }, 2: { C: 1 }, 3: { A: 1 }, 4: { C: 2 } })
    })
    expect(deadlocked).toEqual([1, 2, 3, 4])
  })

  it('espera circular con recursos de una instancia', () => {
    expect(
      detectDeadlock({
        resources: ['impresora', 'usb'],
        available: {},
        allocation: m({ 11: { impresora: 1 }, 12: { usb: 1 } }),
        request: m({ 11: { usb: 1 }, 12: { impresora: 1 } })
      })
    ).toEqual([11, 12])
  })

  it('encuentra el ciclo del grafo de asignación', () => {
    const cycle = findCycle([
      ['P11', 'usb'],
      ['usb', 'P12'],
      ['P12', 'impresora'],
      ['impresora', 'P11'],
      ['P3', 'camara']
    ])
    expect(new Set(cycle)).toEqual(new Set(['P11', 'usb', 'P12', 'impresora']))
    expect(
      findCycle([
        ['a', 'b'],
        ['b', 'c']
      ])
    ).toBeNull()
  })
})

describe('Algoritmo del banquero', () => {
  // Ejemplo clásico: 5 procesos, A=10, B=5, C=7
  const allocation = m({
    0: { A: 0, B: 1, C: 0 },
    1: { A: 2, B: 0, C: 0 },
    2: { A: 3, B: 0, C: 2 },
    3: { A: 2, B: 1, C: 1 },
    4: { A: 0, B: 0, C: 2 }
  })
  const need = m({
    0: { A: 7, B: 4, C: 3 },
    1: { A: 1, B: 2, C: 2 },
    2: { A: 6, B: 0, C: 0 },
    3: { A: 0, B: 1, C: 1 },
    4: { A: 4, B: 3, C: 1 }
  })

  it('reconoce un estado seguro y da una secuencia segura', () => {
    const r = safetyCheck(R, { A: 3, B: 3, C: 2 }, allocation, need)
    expect(r.safe).toBe(true)
    expect(r.sequence).toHaveLength(5)
  })

  it('reconoce un estado inseguro', () => {
    expect(safetyCheck(R, { A: 0, B: 0, C: 0 }, allocation, need).safe).toBe(false)
  })
})
