import { ipcMain, type WebContents } from 'electron'
import type { Worker } from 'node:worker_threads'
import createKernelWorker from './kernelWorker?nodeWorker'
import type { KernelEffect } from '@shared/kernelTypes'
import {
  IPC,
  type KernelCommand,
  type KernelQuery,
  type KernelSnapshot,
  type WorkerMessage,
  type WorkerRequest
} from '@shared/ipc'

/** Arranca el kernel en un worker_thread y lo conecta con la UI vía IPC. */
export class KernelHost {
  private readonly worker: Worker
  private readonly targets = new Set<WebContents>()
  private readonly pendingQueries = new Map<number, (result: unknown) => void>()
  private nextQuery = 1
  private last: KernelSnapshot | undefined
  /** Efectos que debe ejecutar el proceso main (p. ej. imprimir). */
  onEffect: (effect: KernelEffect) => void = () => undefined

  constructor(diskPath: string) {
    this.worker = createKernelWorker({ workerData: { diskPath } })
    this.worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'snapshot') {
        this.last = msg.snapshot
        for (const wc of this.targets) {
          if (!wc.isDestroyed()) wc.send(IPC.snapshot, msg.snapshot)
        }
      } else if (msg.type === 'effect') {
        this.onEffect(msg.effect)
      } else {
        this.pendingQueries.get(msg.id)?.(msg.result)
        this.pendingQueries.delete(msg.id)
      }
    })
    this.worker.on('error', (err) => console.error('[kernel] error en worker:', err))

    ipcMain.handle(IPC.command, (_e, command: KernelCommand) => this.command(command))
    ipcMain.handle(IPC.query, (_e, query: KernelQuery) => {
      const id = this.nextQuery++
      return new Promise((resolve) => {
        this.pendingQueries.set(id, resolve)
        this.post({ type: 'query', id, query })
      })
    })
  }

  command(command: KernelCommand): void {
    this.post({ type: 'command', command })
  }

  attach(wc: WebContents): void {
    this.targets.add(wc)
    wc.once('destroyed', () => this.targets.delete(wc))
    wc.once('did-finish-load', () => {
      if (this.last) wc.send(IPC.snapshot, this.last)
    })
  }

  async shutdown(): Promise<void> {
    await this.worker.terminate()
  }

  private post(msg: WorkerRequest): void {
    this.worker.postMessage(msg)
  }
}
