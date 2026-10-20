import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { HwState, NetResult } from '@shared/kernelTypes'
import {
  IPC,
  type KernelCommand,
  type KernelQuery,
  type NetAction,
  type KernelSnapshot,
  type QueryResults
} from '@shared/ipc'

const api = {
  onSnapshot(cb: (s: KernelSnapshot) => void): () => void {
    const listener = (_e: IpcRendererEvent, s: KernelSnapshot): void => cb(s)
    ipcRenderer.on(IPC.snapshot, listener)
    return () => ipcRenderer.removeListener(IPC.snapshot, listener)
  },
  command(cmd: KernelCommand): Promise<void> {
    return ipcRenderer.invoke(IPC.command, cmd)
  },
  query<Q extends KernelQuery>(q: Q): Promise<QueryResults[Q['type']]> {
    return ipcRenderer.invoke(IPC.query, q)
  },
  onHardware(cb: (s: HwState) => void): () => void {
    const listener = (_e: IpcRendererEvent, s: HwState): void => cb(s)
    ipcRenderer.on(IPC.hardware, listener)
    return () => ipcRenderer.removeListener(IPC.hardware, listener)
  },
  net: (action: NetAction): Promise<NetResult> => ipcRenderer.invoke(IPC.net, action),
  system: {
    saveExport: (name: string, content: string): Promise<string> =>
      ipcRenderer.invoke(IPC.saveExport, name, content),
    openPath: (path: string): Promise<string> => ipcRenderer.invoke(IPC.openPath, path),
    quit: (): Promise<void> => ipcRenderer.invoke(IPC.quit),
    toggleFullscreen: (): Promise<void> => ipcRenderer.invoke(IPC.toggleFullscreen)
  }
}

export type OsApi = typeof api

contextBridge.exposeInMainWorld('os', api)
