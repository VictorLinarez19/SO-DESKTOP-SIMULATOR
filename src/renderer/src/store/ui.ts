import { create } from 'zustand'

export type Power =
  'booting' | 'login' | 'on' | 'locked' | 'sleeping' | 'shutting-down' | 'restarting'

export type Wallpaper = 'aurora' | 'oceano' | 'atardecer' | 'grafito'

export const WALLPAPERS: { id: Wallpaper; name: string }[] = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'oceano', name: 'Océano' },
  { id: 'atardecer', name: 'Atardecer' },
  { id: 'grafito', name: 'Grafito' }
]

function loadWallpaper(): Wallpaper {
  try {
    const w = localStorage.getItem('linarezos.wallpaper') as Wallpaper | null
    return w && WALLPAPERS.some((x) => x.id === w) ? w : 'aurora'
  } catch {
    return 'aurora'
  }
}

/** Estado de interfaz compartido entre apps y el escritorio. */
interface UiState {
  selectedPid: number | null
  selectPid(pid: number | null): void
  /** Archivo seleccionado en el Finder (la Utilidad de Discos resalta sus bloques). */
  selectedFile: string | null
  selectFile(path: string | null): void
  /** Carpeta que muestra el Finder. */
  finderPath: string
  setFinderPath(path: string): void
  spotlight: boolean
  controlCenter: boolean
  missionControl: boolean
  /**
   * Fase del equipo: arranque, pantalla de inicio de sesión, sesión activa, pantalla
   * bloqueada, suspendido, apagándose o reiniciándose.
   */
  power: Power
  wallpaper: Wallpaper
  set(
    patch: Partial<Pick<UiState, 'spotlight' | 'controlCenter' | 'missionControl' | 'power'>>
  ): void
  setWallpaper(w: Wallpaper): void
}

export const useUi = create<UiState>((set) => ({
  selectedPid: null,
  selectPid: (pid) => set({ selectedPid: pid }),
  selectedFile: null,
  selectFile: (path) => set({ selectedFile: path }),
  finderPath: '/Usuarios/victor/Documentos',
  setFinderPath: (path) => set({ finderPath: path }),
  spotlight: false,
  controlCenter: false,
  missionControl: false,
  power: 'booting' as Power,
  wallpaper: loadWallpaper(),
  set: (patch) => set(patch),
  setWallpaper: (wallpaper) => {
    try {
      localStorage.setItem('linarezos.wallpaper', wallpaper)
    } catch {
      // Sin almacenamiento local: el fondo dura solo esta sesión.
    }
    set({ wallpaper })
  }
}))
