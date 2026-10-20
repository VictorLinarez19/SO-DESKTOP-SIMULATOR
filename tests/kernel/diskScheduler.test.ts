import { describe, expect, it } from 'vitest'
import { DiskArm, simulateQueue } from '@kernel/disk/diskScheduler'

// Ejemplo de Silberschatz: cabeza en 53, cilindros 0–199.
const QUEUE = [98, 183, 37, 122, 14, 124, 65, 67]

describe('Planificación del brazo del disco', () => {
  it.each([
    ['FCFS', 1, 640, [98, 183, 37, 122, 14, 124, 65, 67]],
    ['SSTF', 1, 236, [65, 67, 37, 14, 98, 122, 124, 183]],
    ['SCAN', -1, 236, [37, 14, 65, 67, 98, 122, 124, 183]],
    ['CSCAN', 1, 382, [65, 67, 98, 122, 124, 183, 14, 37]],
    ['LOOK', 1, 299, [65, 67, 98, 122, 124, 183, 37, 14]],
    ['CLOOK', 1, 322, [65, 67, 98, 122, 124, 183, 14, 37]]
  ] as const)('%s (sentido %i) recorre %i cilindros', (policy, dir, total, order) => {
    const r = simulateQueue(policy, 53, dir, QUEUE)
    expect(r.total).toBe(total)
    expect(r.order).toEqual(order)
  })

  it('el brazo tarda en llegar según la distancia y luego transfiere', () => {
    const arm = new DiskArm('FCFS')
    arm.enqueue({
      pid: 1,
      tag: 'file',
      cylinder: 120,
      transferTicks: 2,
      kb: 64,
      label: 'x',
      since: 0
    })
    let t = 0
    let done: unknown[] = []
    while (done.length === 0) done = arm.tick(++t)
    // 120 cilindros a 40 por tick = 3 ticks de búsqueda + 2 de transferencia
    expect(t).toBe(5)
    expect(arm.head).toBe(120)
    expect(arm.stats).toMatchObject({ totalMovement: 120, served: 1 })
  })

  it('SSTF puede dejar esperando mucho a una solicitud lejana (inanición)', () => {
    const arm = new DiskArm('SSTF')
    arm.enqueue({
      pid: 9,
      tag: 'file',
      cylinder: 190,
      transferTicks: 1,
      kb: 4,
      label: 'lejos',
      since: 0
    })
    let servedFar = -1
    for (let t = 1; t < 200 && servedFar < 0; t++) {
      // Llegan constantemente solicitudes cerca de la cabeza.
      if (arm.queue.length < 3) {
        arm.enqueue({
          pid: 1,
          tag: 'file',
          cylinder: 10 + (t % 5),
          transferTicks: 1,
          kb: 4,
          label: 'cerca',
          since: t
        })
      }
      if (arm.tick(t).some((r) => r.pid === 9)) servedFar = t
    }
    expect(servedFar).toBe(-1)
    arm.policy = 'SCAN'
    for (let t = 200; t < 260 && servedFar < 0; t++) {
      if (arm.tick(t).some((r) => r.pid === 9)) servedFar = t
    }
    expect(servedFar).toBeGreaterThan(0)
  })
})
