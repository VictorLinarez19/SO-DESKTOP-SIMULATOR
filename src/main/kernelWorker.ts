// Hilo dedicado al kernel: su reloj no depende del render de la UI.
import { parentPort, workerData } from 'node:worker_threads'
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Kernel, USB_BACKUP_DIR } from '@kernel/kernel'
import type { WorkerMessage, WorkerRequest } from '@shared/ipc'
import type { KernelEffect } from '@shared/kernelTypes'
import { FileBlockDevice } from './hal/diskImage'

if (!parentPort) throw new Error('kernelWorker debe ejecutarse como worker_thread')
const port = parentPort

/** A relojes muy rápidos no tiene sentido mandar más de ~30 instantáneas por segundo. */
const MIN_PUBLISH_MS = 33

const { diskPath } = workerData as { diskPath: string }
const disk = new FileBlockDevice(diskPath)
// En la app el interbloqueo se muestra y luego se recupera solo, para que el sistema siga vivo.
const kernel = new Kernel({ disk, realDevices: true, autoRecover: true })
/** Respaldos que se conservan en la memoria USB real (los más antiguos se borran). */
const KEEP_BACKUPS = 5
let timer: NodeJS.Timeout | undefined
let lastPublish = 0
let pendingPublish: NodeJS.Timeout | undefined

/** Ejecuta lo que el kernel pidió hacer fuera de la simulación. */
function runEffects(): void {
  for (const effect of kernel.drainEffects()) {
    if (effect.type === 'usbWrite') writeToUsb(effect)
    else port.postMessage({ type: 'effect', effect } satisfies WorkerMessage)
  }
}

/** Copia real a la memoria USB, solo dentro de la carpeta propia de LinarezOS. */
function writeToUsb(e: Extract<KernelEffect, { type: 'usbWrite' }>): void {
  const dir = join(e.mount, USB_BACKUP_DIR)
  const path = join(dir, e.fileName)
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(path, e.content)
    const ours = readdirSync(dir)
      .filter((f) => /^respaldo_\d+_/.test(f))
      .sort()
    for (const f of ours.slice(0, Math.max(0, ours.length - KEEP_BACKUPS))) unlinkSync(join(dir, f))
    kernel.command({
      type: 'hwEvent',
      event: { kind: 'usbWritten', path, bytes: Buffer.byteLength(e.content) }
    })
  } catch (err) {
    kernel.command({
      type: 'hwEvent',
      event: { kind: 'usbWritten', path, bytes: 0, error: (err as Error).message }
    })
  }
}

function publishNow(): void {
  clearTimeout(pendingPublish)
  pendingPublish = undefined
  lastPublish = Date.now()
  const msg: WorkerMessage = { type: 'snapshot', snapshot: kernel.snapshot() }
  port.postMessage(msg)
}

function publish(): void {
  const wait = lastPublish + MIN_PUBLISH_MS - Date.now()
  if (wait <= 0) publishNow()
  else pendingPublish ??= setTimeout(publishNow, wait)
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error('[kernel] fallo interno, se pausa la simulación:', err)
    kernel.command({ type: 'pause' })
  }
}

function schedule(): void {
  clearInterval(timer)
  timer = setInterval(() => {
    if (!kernel.isRunning) return
    safely(() => kernel.tick())
    runEffects()
    publish()
  }, kernel.tickInterval)
}

port.on('message', (msg: WorkerRequest) => {
  if (msg.type === 'query') {
    let result: unknown = null
    safely(() => (result = kernel.query(msg.query)))
    const reply: WorkerMessage = { type: 'queryResult', id: msg.id, result }
    port.postMessage(reply)
    return
  }
  const before = kernel.tickInterval
  safely(() => kernel.command(msg.command))
  runEffects()
  if (kernel.tickInterval !== before) schedule()
  publishNow()
})

schedule()
publishNow()
