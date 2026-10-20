import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface WindowCtx {
  id: string
  focused: boolean
  /** Nodo de la barra de título donde las apps colocan su barra de herramientas. */
  toolbarEl: HTMLElement | null
}

export const WindowContext = createContext<WindowCtx>({ id: '', focused: false, toolbarEl: null })

export function useWindow(): WindowCtx {
  return useContext(WindowContext)
}

/** Barra de herramientas unificada con el título, al estilo macOS. */
export function WindowToolbar({ children }: { children: ReactNode }): ReactNode {
  const { toolbarEl } = useWindow()
  return toolbarEl ? createPortal(children, toolbarEl) : null
}
