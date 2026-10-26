// Datos de cada aplicación del escritorio (sin componentes, para evitar ciclos de importación).

export type AppId =
  | 'finder'
  | 'textedit'
  | 'terminal'
  | 'users'
  | 'demo'
  | 'music'
  | 'camera'
  | 'devices'
  | 'disk'
  | 'activity'
  | 'diagram'
  | 'memory'
  | 'sync'
  | 'deadlock'
  | 'console'
  | 'about'

export interface AppManifest {
  id: AppId
  name: string
  /** Tamaño inicial y mínimo de la ventana. */
  size: { w: number; h: number }
  minSize: { w: number; h: number }
  /** Si es true, solo existe una ventana de la app. */
  singleton: boolean
  resizable: boolean
}

export const APPS: Record<AppId, AppManifest> = {
  demo: {
    id: 'demo',
    name: 'Demostración',
    size: { w: 980, h: 640 },
    minSize: { w: 600, h: 400 },
    singleton: true,
    resizable: true
  },
  users: {
    id: 'users',
    name: 'Usuarios y contraseñas',
    size: { w: 700, h: 500 },
    minSize: { w: 560, h: 380 },
    singleton: true,
    resizable: true
  },
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    size: { w: 780, h: 480 },
    minSize: { w: 460, h: 260 },
    singleton: false,
    resizable: true
  },
  textedit: {
    id: 'textedit',
    name: 'Editor de texto',
    size: { w: 720, h: 560 },
    minSize: { w: 420, h: 300 },
    singleton: true,
    resizable: true
  },
  music: {
    id: 'music',
    name: 'Música',
    size: { w: 560, h: 520 },
    minSize: { w: 460, h: 420 },
    singleton: true,
    resizable: true
  },
  camera: {
    id: 'camera',
    name: 'Cámara',
    size: { w: 760, h: 620 },
    minSize: { w: 480, h: 420 },
    singleton: true,
    resizable: true
  },
  devices: {
    id: 'devices',
    name: 'Información del sistema',
    size: { w: 1180, h: 740 },
    minSize: { w: 720, h: 460 },
    singleton: true,
    resizable: true
  },
  finder: {
    id: 'finder',
    name: 'Finder',
    size: { w: 980, h: 600 },
    minSize: { w: 640, h: 380 },
    singleton: false,
    resizable: true
  },
  disk: {
    id: 'disk',
    name: 'Utilidad de Discos',
    size: { w: 1240, h: 760 },
    minSize: { w: 760, h: 480 },
    singleton: true,
    resizable: true
  },
  activity: {
    id: 'activity',
    name: 'Monitor de actividad',
    size: { w: 1060, h: 640 },
    minSize: { w: 720, h: 420 },
    singleton: true,
    resizable: true
  },
  diagram: {
    id: 'diagram',
    name: 'Diagrama de estados',
    size: { w: 980, h: 640 },
    minSize: { w: 640, h: 440 },
    singleton: true,
    resizable: true
  },
  memory: {
    id: 'memory',
    name: 'Memoria',
    size: { w: 1120, h: 700 },
    minSize: { w: 720, h: 460 },
    singleton: true,
    resizable: true
  },
  sync: {
    id: 'sync',
    name: 'Sincronización',
    size: { w: 1080, h: 720 },
    minSize: { w: 680, h: 440 },
    singleton: true,
    resizable: true
  },
  deadlock: {
    id: 'deadlock',
    name: 'Interbloqueo',
    size: { w: 1100, h: 720 },
    minSize: { w: 700, h: 460 },
    singleton: true,
    resizable: true
  },
  console: {
    id: 'console',
    name: 'Consola del kernel',
    size: { w: 760, h: 460 },
    minSize: { w: 480, h: 280 },
    singleton: false,
    resizable: true
  },
  about: {
    id: 'about',
    name: 'Acerca de LinarezOS',
    size: { w: 420, h: 400 },
    minSize: { w: 420, h: 400 },
    singleton: true,
    resizable: false
  }
}

/** Apps fijas en el Dock, en orden. */
/** Apps fijas en el Dock, en orden; '|' es un separador. */
export const DOCK_APPS: (AppId | '|')[] = [
  'finder',
  'textedit',
  'terminal',
  'music',
  'camera',
  '|',
  'activity',
  'diagram',
  'memory',
  'sync',
  'deadlock',
  'disk',
  'devices',
  'demo',
  'console'
]

/** Proceso del sistema asociado a cada app (recibe las teclas cuando su ventana está activa). */
export const APP_PROGRAM: Partial<Record<AppId, string>> = {
  finder: 'finder',
  textedit: 'editor',
  terminal: 'terminal',
  music: 'musica',
  camera: 'camara'
}
