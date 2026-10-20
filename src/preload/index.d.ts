import type { KernelCommand, KernelQuery, KernelSnapshot, QueryResults } from '../shared/ipc'
import type { HwState, NetResult } from '../shared/kernelTypes'
import type { NetAction } from '../shared/ipc'

declare global {
  interface Window {
    os: {
      onSnapshot(cb: (s: KernelSnapshot) => void): () => void
      command(cmd: KernelCommand): Promise<void>
      query<Q extends KernelQuery>(q: Q): Promise<QueryResults[Q['type']]>
      onHardware(cb: (s: HwState) => void): () => void
      net(action: NetAction): Promise<NetResult>
      system: {
        openPath(path: string): Promise<string>
        saveExport(name: string, content: string): Promise<string>
        quit(): Promise<void>
        toggleFullscreen(): Promise<void>
      }
    }
  }
}

export {}
