import { create } from 'zustand'
import type { KernelCommand, KernelSnapshot } from '@shared/ipc'

interface KernelState {
  snapshot: KernelSnapshot | null
  send: (cmd: KernelCommand) => void
}

export const useKernel = create<KernelState>(() => ({
  snapshot: null,
  send: (cmd) => void window.os.command(cmd)
}))

window.os.onSnapshot((snapshot) => useKernel.setState({ snapshot }))
