export const MENU_BAR_H = 28
/** Espacio que se reserva abajo para el Dock al maximizar. */
export const DOCK_RESERVED = 86
/** Distancia al borde de la pantalla que activa el acoplamiento (snap). */
export const SNAP_THRESHOLD = 6

export interface Bounds {
  x: number
  y: number
  w: number
  h: number
}

export type SnapZone = 'left' | 'right' | 'max'

/** Área útil del escritorio: entre la barra de menú y el Dock. */
export function workArea(): Bounds {
  return {
    x: 0,
    y: MENU_BAR_H,
    w: window.innerWidth,
    h: window.innerHeight - MENU_BAR_H - DOCK_RESERVED
  }
}

export function snapBounds(zone: SnapZone): Bounds {
  const a = workArea()
  const gap = 6
  switch (zone) {
    case 'max':
      return { x: a.x + gap, y: a.y + gap, w: a.w - gap * 2, h: a.h - gap }
    case 'left':
      return { x: a.x + gap, y: a.y + gap, w: a.w / 2 - gap * 1.5, h: a.h - gap }
    case 'right':
      return { x: a.x + a.w / 2 + gap / 2, y: a.y + gap, w: a.w / 2 - gap * 1.5, h: a.h - gap }
  }
}

/** Zona de acoplamiento según la posición del puntero al arrastrar. */
export function snapZoneAt(px: number, py: number): SnapZone | null {
  if (py <= MENU_BAR_H + SNAP_THRESHOLD) return 'max'
  if (px <= SNAP_THRESHOLD) return 'left'
  if (px >= window.innerWidth - SNAP_THRESHOLD) return 'right'
  return null
}

/** Elementos del Dock, para animar la minimización hacia su icono. */
export const dockIcons = new Map<string, HTMLElement>()
