import { create } from 'zustand'
import type { KernelEvent } from '@shared/kernelTypes'
import { useKernel } from './kernel'

export interface Notice {
  id: number
  title: string
  body: string
  level: 'info' | 'warning' | 'critical'
  kind: KernelEvent['kind']
  pid?: number
}

interface NoticeState {
  notices: Notice[]
  dismiss(id: number): void
}

const MAX_VISIBLE = 4
const TITLES: Partial<Record<KernelEvent['kind'], string>> = {
  deadlock: 'Interbloqueo',
  starvation: 'Inanición',
  resource: 'Recursos',
  memory: 'Memoria',
  sync: 'Sincronización',
  interrupt: 'Hardware',
  file: 'Archivos',
  scheduler: 'Sistema'
}

export const useNotifications = create<NoticeState>((set) => ({
  notices: [],
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
}))

// Convierte en notificaciones los eventos del kernel marcados como importantes.
let lastSeen = 0
let lastBoot = 0
useKernel.subscribe((state) => {
  const snap = state.snapshot
  if (!snap) return
  if (snap.bootedAt !== lastBoot) {
    lastBoot = snap.bootedAt
    lastSeen = 0
  }
  const fresh = snap.events.filter((e) => e.level && e.id > lastSeen)
  if (snap.events.length) lastSeen = Math.max(lastSeen, snap.events[snap.events.length - 1].id)
  if (fresh.length === 0) return
  useNotifications.setState((s) => ({
    notices: [
      ...fresh.map((e) => ({
        id: e.id,
        title: TITLES[e.kind] ?? 'guiñanOS',
        body: e.message,
        level: e.level!,
        kind: e.kind,
        pid: e.pid
      })),
      ...s.notices
    ].slice(0, MAX_VISIBLE)
  }))
})
