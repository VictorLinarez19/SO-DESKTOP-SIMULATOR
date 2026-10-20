import { useEffect, useRef, useState, type ReactNode } from 'react'

export type MenuItem =
  | { label: string; shortcut?: string; action?: () => void; disabled?: boolean; checked?: boolean }
  | 'separator'

export interface MenuDef {
  id: string
  label: ReactNode
  bold?: boolean
  items: MenuItem[]
}

/** Menús desplegables de la barra superior: clic para abrir y pasar el puntero para cambiar. */
export function MenuGroup({ menus }: { menus: MenuDef[] }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu-group" ref={ref}>
      {menus.map((m) => (
        <div key={m.id} className="menu-root">
          <button
            className={`menu-title${m.bold ? ' bold' : ''}${open === m.id ? ' open' : ''}`}
            onPointerDown={() => setOpen(open === m.id ? null : m.id)}
            onPointerEnter={() => open && setOpen(m.id)}
          >
            {m.label}
          </button>
          {open === m.id && (
            <div className="menu-dropdown glass-strong">
              {m.items.map((item, i) =>
                item === 'separator' ? (
                  <div key={i} className="menu-sep" />
                ) : (
                  <button
                    key={i}
                    className="menu-item"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(null)
                      item.action?.()
                    }}
                  >
                    <span className="menu-check">{item.checked ? '✓' : ''}</span>
                    <span className="menu-label">{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
