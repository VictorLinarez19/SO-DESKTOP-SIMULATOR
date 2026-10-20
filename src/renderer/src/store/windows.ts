import { create } from 'zustand'
import { APPS, type AppId } from '../apps/manifest'
import { MENU_BAR_H, snapBounds, workArea, type Bounds, type SnapZone } from '../wm/geometry'

export interface WinState extends Bounds {
  id: string
  appId: AppId
  z: number
  minimized: boolean
  maximized: boolean
  snapped: SnapZone | null
  /** Geometría previa a maximizar/acoplar, para restaurarla. */
  restore: Bounds | null
  /** Mientras se arrastra o redimensiona, la geometría se aplica sin animación. */
  interacting: boolean
}

interface WmState {
  windows: WinState[]
  focusedId: string | null
  nextZ: number
  /** Silueta que anticipa dónde quedará la ventana al soltarla en un borde. */
  snapPreview: SnapZone | null
  /** Contador por app para animar el rebote del icono en el Dock al abrir. */
  launches: Partial<Record<AppId, number>>

  open(appId: AppId): string
  activateApp(appId: AppId): void
  close(id: string): void
  closeApp(appId: AppId): void
  focus(id: string): void
  minimize(id: string): void
  unminimize(id: string): void
  toggleMaximize(id: string): void
  snap(id: string, zone: SnapZone): void
  setBounds(id: string, b: Partial<Bounds>, release?: boolean): void
  endInteraction(id: string): void
  setSnapPreview(zone: SnapZone | null): void
}

let seq = 0

function topVisible(windows: WinState[], except?: string): string | null {
  const visible = windows.filter((w) => !w.minimized && w.id !== except)
  if (visible.length === 0) return null
  return visible.reduce((a, b) => (a.z > b.z ? a : b)).id
}

export const useWm = create<WmState>((set, get) => {
  const patch = (id: string, p: Partial<WinState>): void =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, ...p } : w)) }))

  return {
    windows: [],
    focusedId: null,
    nextZ: 1,
    snapPreview: null,
    launches: {},

    open(appId) {
      const app = APPS[appId]
      const existing = get().windows.filter((w) => w.appId === appId)
      if (app.singleton && existing.length > 0) {
        get().unminimize(existing[0].id)
        return existing[0].id
      }
      const area = workArea()
      const w = Math.min(app.size.w, area.w - 40)
      const h = Math.min(app.size.h, area.h - 20)
      const cascade = (get().windows.length % 6) * 28
      const id = `w${++seq}`
      const win: WinState = {
        id,
        appId,
        x: Math.round(area.x + (area.w - w) / 2 + cascade - 70),
        y: Math.round(Math.max(MENU_BAR_H + 8, area.y + (area.h - h) / 2 + cascade - 40)),
        w,
        h,
        z: get().nextZ,
        minimized: false,
        maximized: false,
        snapped: null,
        restore: null,
        interacting: false
      }
      set((s) => ({
        windows: [...s.windows, win],
        focusedId: id,
        nextZ: s.nextZ + 1,
        launches: { ...s.launches, [appId]: (s.launches[appId] ?? 0) + 1 }
      }))
      return id
    },

    activateApp(appId) {
      const wins = get().windows.filter((w) => w.appId === appId)
      if (wins.length === 0) {
        get().open(appId)
        return
      }
      // Como en macOS: se traen al frente todas sus ventanas y se restaura la última minimizada.
      const minimized = wins.filter((w) => w.minimized)
      if (minimized.length === wins.length) {
        get().unminimize(minimized.reduce((a, b) => (a.z > b.z ? a : b)).id)
      } else {
        for (const w of [...wins].sort((a, b) => a.z - b.z)) if (!w.minimized) get().focus(w.id)
      }
    },

    close(id) {
      set((s) => {
        const windows = s.windows.filter((w) => w.id !== id)
        return {
          windows,
          focusedId: s.focusedId === id ? topVisible(windows) : s.focusedId
        }
      })
    },

    closeApp(appId) {
      for (const w of get().windows.filter((w) => w.appId === appId)) get().close(w.id)
    },

    focus(id) {
      const s = get()
      const win = s.windows.find((w) => w.id === id)
      if (!win) return
      if (s.focusedId === id && win.z === s.nextZ - 1) return
      patch(id, { z: s.nextZ })
      set({ focusedId: id, nextZ: s.nextZ + 1 })
    },

    minimize(id) {
      patch(id, { minimized: true, interacting: false })
      set((s) => ({ focusedId: s.focusedId === id ? topVisible(s.windows, id) : s.focusedId }))
    },

    unminimize(id) {
      patch(id, { minimized: false })
      get().focus(id)
    },

    toggleMaximize(id) {
      const win = get().windows.find((w) => w.id === id)
      if (!win || !APPS[win.appId].resizable) return
      if (win.maximized || win.snapped) {
        const r = win.restore ?? win
        patch(id, { ...r, maximized: false, snapped: null, restore: null, interacting: false })
      } else {
        get().snap(id, 'max')
      }
      get().focus(id)
    },

    snap(id, zone) {
      const win = get().windows.find((w) => w.id === id)
      if (!win || !APPS[win.appId].resizable) return
      const restore = win.restore ?? { x: win.x, y: win.y, w: win.w, h: win.h }
      patch(id, {
        ...snapBounds(zone),
        maximized: zone === 'max',
        snapped: zone === 'max' ? null : zone,
        restore,
        interacting: false
      })
    },

    setBounds(id, b, release = false) {
      patch(id, {
        ...b,
        interacting: true,
        ...(release ? { maximized: false, snapped: null, restore: null } : {})
      })
    },

    endInteraction(id) {
      patch(id, { interacting: false })
    },

    setSnapPreview(zone) {
      if (get().snapPreview !== zone) set({ snapPreview: zone })
    }
  }
})
