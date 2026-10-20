import { describe, expect, it } from 'vitest'
import { ganttString, kernelWith, prog, run } from './helpers'
import { Kernel, STARVATION_TICKS } from '@kernel/kernel'

const forever = 'x: CPU 100\nLOOP x'

describe('Planificación', () => {
  it('Round Robin respeta el quantum propio de cada proceso', () => {
    const k = kernelWith([prog('a', forever, { quantum: 2 }), prog('b', forever, { quantum: 3 })], {
      policy: 'RR'
    })
    run(k, 11)
    // A×2, B×3, A×2, B×3, A…
    expect(ganttString(k.gantt.all())).toBe('11222112221')
    const quantumEnds = k.log.all().filter((e) => e.message.includes('fin de quantum'))
    expect(quantumEnds.map((e) => e.pid)).toEqual([1, 2, 1, 2])
  })

  it('el cambio de contexto consume ticks de CPU', () => {
    const k = kernelWith([prog('a', forever, { quantum: 2 }), prog('b', forever, { quantum: 2 })], {
      policy: 'RR',
      contextSwitchTicks: 1
    })
    run(k, 10)
    expect(ganttString(k.gantt.all())).toBe('*11*22*11*')
    expect(k.stats().csTicks).toBe(4)
  })

  it('FCFS no expropia: cada proceso corre hasta bloquearse o terminar', () => {
    const k = kernelWith([prog('a', 'CPU 5'), prog('b', 'CPU 2')], { policy: 'FCFS' })
    run(k, 9)
    expect(ganttString(k.gantt.all())).toBe('1111122--')
    expect(k.process(1)!.finishedAt).toBe(5)
  })

  it('con prioridades, quien llega con más prioridad expropia al que ejecuta', () => {
    const k = kernelWith(
      [
        prog('baja', forever, { priority: 7, quantum: 10 }),
        prog('alta', 'CPU 3', { priority: 1, arrival: 3 })
      ],
      { policy: 'PRIORITY_RR' }
    )
    run(k, 9)
    // "alta" llega en el tick 3, se admite en el 4 y expropia de inmediato
    expect(ganttString(k.gantt.all())).toBe('111222111')
    expect(k.log.all().some((e) => e.pid === 1 && e.message.includes('expropiado'))).toBe(true)
  })

  it('con prioridades, los de igual prioridad se turnan (RR) y el de menor prioridad espera', () => {
    const k = kernelWith(
      [
        prog('a', forever, { priority: 2, quantum: 2 }),
        prog('b', forever, { priority: 2, quantum: 2 }),
        prog('c', forever, { priority: 8, quantum: 2 })
      ],
      { policy: 'PRIORITY_RR' }
    )
    run(k, 40)
    expect(k.process(3)!.cpuTime).toBe(0)
    expect(k.process(3)!.readyStreak).toBe(40)
  })

  it('cambiar prioridad y quantum en vivo', () => {
    const k = kernelWith([prog('a', forever)])
    k.command({ type: 'setPriority', pid: 1, priority: 42 })
    k.command({ type: 'setQuantum', pid: 1, quantum: 7 })
    expect(k.process(1)).toMatchObject({ priority: 9, basePriority: 9, quantum: 7 })
  })
})

describe('E/S, temporizador y bucles', () => {
  it('las peticiones a un dispositivo se atienden en orden FCFS', () => {
    const k = kernelWith([prog('a', 'IO disco 3'), prog('b', 'IO disco 3')], { policy: 'RR' })
    run(k, 2)
    const disco = k.snapshot().devices.find((d) => d.id === 'disco')!
    expect(disco.busyPid).toBe(1)
    expect(disco.queue).toEqual([2])
    run(k, 8)
    // A se atiende en los ticks 2–4 y B en 5–7, sin huecos entre peticiones
    expect(k.process(1)!.finishedAt).toBe(5)
    expect(k.process(2)!.finishedAt).toBe(8)
  })

  it('una E/S de n ticks mantiene bloqueado al proceso n ticks', () => {
    const k = kernelWith([prog('a', 'IO red 4\nCPU 1')])
    run(k, 1) // tick 1: llamada al sistema → Bloqueado
    expect(k.process(1)!.state).toBe('BLOCKED')
    run(k, 4) // el disco trabaja los ticks 2–5
    expect(k.process(1)!.state).toBe('BLOCKED')
    run(k, 1) // tick 6: llega la IRQ
    expect(k.process(1)!.state).not.toBe('BLOCKED')
    expect(k.process(1)!.blockedTime).toBe(4)
  })

  it('SLEEP despierta por interrupción del temporizador', () => {
    const k = kernelWith([prog('a', 'SLEEP 5\nCPU 3')])
    run(k, 1)
    expect(k.process(1)!.waitingOn).toEqual({ kind: 'timer', until: 7 })
    run(k, 5)
    expect(k.process(1)).toMatchObject({ state: 'BLOCKED', blockedTime: 5 })
    run(k, 1)
    expect(k.process(1)!.state).toBe('RUNNING')
  })

  it('LOOP con repeticiones ejecuta el bloque n veces y luego termina', () => {
    const k = kernelWith([prog('a', 'x: CPU 2\nLOOP x 3', { quantum: 50 })])
    run(k, 20)
    expect(k.process(1)).toMatchObject({ state: 'TERMINATED', cpuTime: 6 })
  })

  it('aborta programas con bucles que no consumen CPU', () => {
    const k = kernelWith([prog('a', 'x: LOOP x')])
    run(k, 3)
    expect(k.process(1)!.exitReason).toMatch(/bucle/)
  })
})

describe('Invariantes con los 15 procesos', () => {
  it.each(['FCFS', 'RR', 'PRIORITY_RR'] as const)('se mantienen con %s', (policy) => {
    const k = new Kernel({ policy })
    for (let t = 0; t < 600; t++) {
      k.tick()
      const s = k.snapshot()
      const running = s.processes.filter((p) => p.state === 'RUNNING')
      expect(running.length).toBeLessThanOrEqual(1)
      expect(running[0]?.pid ?? null).toBe(s.cpu.pid)
      // La cola de listos contiene exactamente a los procesos en estado Listo.
      const ready = s.processes.filter((p) => p.state === 'READY').map((p) => p.pid)
      expect([...s.readyQueue].sort((a, b) => a - b)).toEqual(ready)
      // Todo bloqueado espera algo (E/S o temporizador).
      for (const p of s.processes) {
        if (p.state === 'BLOCKED') expect(p.waitingOn).not.toBeNull()
      }
      // Cada tick la CPU está ocupada, cambiando de contexto u ociosa.
      const st = s.stats
      expect(st.busyTicks + st.idleTicks + st.csTicks + st.osTicks).toBe(s.tick)
    }
    expect(k.processes()).toHaveLength(15)
  })
})

describe('Carga de los 15 programas del sistema', () => {
  const antivirus = (k: Kernel) => k.processes().find((p) => p.programId === 'antivirus')!

  it('con prioridades el Antivirus (prioridad 9) sufre inanición; los demás avanzan', () => {
    const k = new Kernel({ policy: 'PRIORITY_RR' })
    for (let t = 0; t < 800; t++) k.tick()
    expect(antivirus(k).maxReadyStreak).toBeGreaterThan(STARVATION_TICKS)
    for (const p of k.processes().filter((p) => p.programId !== 'antivirus')) {
      expect(p.cpuTime, p.name).toBeGreaterThan(0)
      expect(p.maxReadyStreak, p.name).toBeLessThan(100)
    }
    // El kernel reporta la inanición del Antivirus (y de nadie más).
    const reports = k.log.all().filter((e) => e.kind === 'starvation' && e.level === 'warning')
    expect(new Set(reports.map((e) => e.pid))).toEqual(new Set([antivirus(k).pid]))
  })

  it('con Round Robin nadie sufre inanición y el Antivirus termina', () => {
    const k = new Kernel({ policy: 'RR' })
    for (let t = 0; t < 800; t++) k.tick()
    for (const p of k.processes()) expect(p.maxReadyStreak, p.name).toBeLessThan(60)
    expect(antivirus(k).state).toBe('TERMINATED')
  })
})

describe('Envejecimiento (aging)', () => {
  it('corrige la inanición del Antivirus', () => {
    const k = new Kernel({ policy: 'PRIORITY_RR', aging: true })
    for (let t = 0; t < 800; t++) k.tick()
    const av = k.processes().find((p) => p.programId === 'antivirus')!
    expect(av.maxReadyStreak).toBeLessThan(100)
    expect(av.cpuTime).toBeGreaterThan(20)
    expect(k.log.all().some((e) => e.message.startsWith('Envejecimiento'))).toBe(true)
  })

  it('la prioridad ganada se pierde al dejar la CPU', () => {
    const k = kernelWith(
      [
        prog('alta', 'x: CPU 100\nLOOP x', { priority: 1, quantum: 3 }),
        prog('alta2', 'x: CPU 100\nLOOP x', { priority: 1, quantum: 3 }),
        prog('baja', 'x: CPU 100\nLOOP x', { priority: 4, quantum: 2 })
      ],
      { policy: 'PRIORITY_RR', aging: true }
    )
    // Sin envejecimiento "baja" nunca ejecutaría; con él sube un nivel cada 10 ticks.
    let t = 0
    while (k.process(3)!.cpuTime === 0 && t++ < 100) k.tick()
    expect(t).toBeLessThan(45)
    expect(k.process(3)!.priority).toBeLessThan(4)
    while (k.process(3)!.state === 'RUNNING') k.tick()
    expect(k.process(3)).toMatchObject({ state: 'READY', priority: 4, basePriority: 4 })
  })
})
