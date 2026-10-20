import { describe, expect, it } from 'vitest'
import { Kernel } from '@kernel/kernel'
import { MAX_TICK_MS, MIN_TICK_MS } from '@shared/ipc'

describe('Kernel: reloj y control', () => {
  it('avanza el reloj con cada tick', () => {
    const k = new Kernel()
    k.tick()
    k.tick()
    expect(k.snapshot().tick).toBe(2)
  })

  it('en pausa solo avanza con "step"', () => {
    const k = new Kernel()
    k.command({ type: 'step' })
    expect(k.snapshot().tick).toBe(0)
    k.command({ type: 'pause' })
    k.command({ type: 'step' })
    expect(k.snapshot()).toMatchObject({ tick: 1, running: false })
  })

  it('limita la velocidad del reloj', () => {
    const k = new Kernel()
    k.command({ type: 'setSpeed', tickMs: 1 })
    expect(k.tickInterval).toBe(MIN_TICK_MS)
    k.command({ type: 'setSpeed', tickMs: 99999 })
    expect(k.tickInterval).toBe(MAX_TICK_MS)
  })

  it('reset vuelve al arranque', () => {
    const k = new Kernel()
    for (let i = 0; i < 30; i++) k.tick()
    k.command({ type: 'reset' })
    expect(k.snapshot().tick).toBe(0)
    expect(k.processes().map((p) => p.pid)).toEqual([1])
  })
})
