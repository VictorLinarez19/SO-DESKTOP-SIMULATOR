import { describe, expect, it } from 'vitest'
import { Kernel, STARVATION_TICKS } from '@kernel/kernel'
import { SCENARIOS } from '@shared/scenarios'

function play(id: string, extra = 0): Kernel {
  const k = new Kernel()
  const s = SCENARIOS.find((x) => x.id === id)!
  for (const c of s.commands) k.command(c)
  for (let i = 0; i < s.ticks + extra; i++) k.tick()
  return k
}

describe('Escenarios de demostración', () => {
  it('interbloqueo: se produce y queda activo (sin recuperación automática)', () => {
    const k = play('deadlock')
    expect(k.snapshot().resources.deadlock).not.toBeNull()
  })

  it('evitar: con el banquero no hay interbloqueo', () => {
    expect(play('deadlock-avoid', 300).snapshot().resources.stats.deadlocks).toBe(0)
  })

  it('inanición: el Antivirus supera el umbral y se avisa', () => {
    const k = play('starvation')
    const av = k.processes().find((p) => p.programId === 'antivirus')!
    expect(av.maxReadyStreak).toBeGreaterThan(STARVATION_TICKS)
    expect(k.log.all().some((e) => e.kind === 'starvation' && e.level === 'warning')).toBe(true)
  })

  it('aging: el Antivirus ya no pasa de 100 ticks esperando', () => {
    const av = play('aging', 200)
      .processes()
      .find((p) => p.programId === 'antivirus')!
    expect(av.maxReadyStreak).toBeLessThan(STARVATION_TICKS)
  })

  it('fragmentación: aparece el aviso y no se compacta sola', () => {
    const k = play('fragmentation', 200)
    expect(k.log.all().some((e) => e.message.startsWith('Fragmentación externa'))).toBe(true)
    expect(k.snapshot().memory.autoCompact).toBe(false)
  })

  it('carrera y desbordamiento: sin sincronización se pierden datos', () => {
    const race = play('race', 300).snapshot().sync.variables[0]
    expect(race.value).toBeLessThan(race.expected)
    const over = play('overflow', 300).snapshot().sync.buffers[0]
    expect(over.overflows).toBeGreaterThan(0)
  })

  it('disco: arranca con FCFS', () => {
    expect(play('disk').snapshot().disk.arm.policy).toBe('FCFS')
  })

  it('restaurar: deja todo en la configuración normal', () => {
    const k = new Kernel()
    for (const c of SCENARIOS.find((s) => s.id === 'race')!.commands) k.command(c)
    for (const c of SCENARIOS.find((s) => s.id === 'normal')!.commands) k.command(c)
    const s = k.snapshot()
    expect(s.sync.groups.every((g) => g.enabled)).toBe(true)
    expect(s.resources.autoRecover).toBe(true)
    expect(s.tick).toBe(0)
  })
})
