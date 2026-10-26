// Genera docs/LinarezOS.pptx (presentación corta del proyecto).
const pptxgen = require('pptxgenjs')
const { applyTheme } = require(require('os').homedir() + '/.claude/skills/synced/713448e9-58e9-4747-afa8-308a5bf5790a_4480272f-6c83-43bd-ba8a-f89b205437f7/pptx/scripts/apply_theme.js')

const THEME = {
  name: 'LinarezOS',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '1B1033', lt1: 'FFFFFF', dk2: '3B2A6B', lt2: 'F3F0FA',
    accent1: '7B3FE4', accent2: 'FF6A3D', accent3: '0A84FF', accent4: '30D158',
    accent5: 'FFD60A', accent6: 'FF453A', hlink: '0A84FF', folHlink: '7B3FE4'
  }
}

const pres = new pptxgen()
pres.layout = 'LAYOUT_16x9'
pres.title = 'LinarezOS: simulador de sistema operativo de escritorio'
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
const C = pres.SchemeColor
const IMG = (n) => `docs/capturas/${n}.png`

pres.defineSlideMaster({
  title: 'OSCURA', background: { color: THEME.colors.dk1 },
  objects: [], slideNumber: { x: 9.2, y: 5.25, color: C.background2, fontSize: 10 }
})
pres.defineSlideMaster({
  title: 'CLARA', background: { color: THEME.colors.lt1 },
  objects: [{ text: { text: 'LinarezOS', options: { x: 0.5, y: 5.25, w: 3, h: 0.25, fontSize: 10, color: C.text2, margin: 0, isTextBox: true } } }],
  slideNumber: { x: 9.2, y: 5.25, color: C.text2, fontSize: 10 }
})

function titled(title, notes) {
  const s = pres.addSlide({ masterName: 'CLARA' })
  s.addText(title, { x: 0.5, y: 0.3, w: 9, h: 0.7, fontFace: 'Cambria', fontSize: 32, bold: true, color: C.text1, margin: 0, isTextBox: true, objectName: 'Título' })
  if (notes) s.addNotes(notes)
  return s
}
function bullets(s, items, opts = {}) {
  s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1, paraSpaceAfter: 8 } })),
    { x: opts.x ?? 0.5, y: 1.25, w: opts.w ?? 4.1, h: opts.h ?? 3.7, fontSize: 15, color: C.text1, valign: 'top', margin: 0, isTextBox: true, objectName: 'Puntos' })
}
function shot(s, name, x = 4.85, y = 1.35, w = 4.8) {
  s.addImage({ path: IMG(name), x, y, w, h: w * 701 / 1367, shadow: { type: 'outer', color: '000000', opacity: 0.3, blur: 10, offset: 3, angle: 90 }, altText: 'Captura de ' + name, objectName: 'Captura ' + name })
}

// 1. Portada
let s = pres.addSlide({ masterName: 'OSCURA' })
s.addText('LinarezOS', { x: 0.7, y: 1.5, w: 8.6, h: 1.2, fontFace: 'Cambria', fontSize: 66, bold: true, color: C.background1, margin: 0, isTextBox: true })
s.addText('Simulador de sistema operativo de escritorio', { x: 0.7, y: 2.75, w: 8.6, h: 0.6, fontSize: 26, color: C.accent2, margin: 0, isTextBox: true })
s.addText('Sistemas de Operación · 7.º semestre\nKernel simulado + hardware real de la laptop', { x: 0.7, y: 3.7, w: 8.6, h: 0.9, fontSize: 16, color: C.background2, margin: 0, isTextBox: true })
s.addNotes('Presentación corta del proyecto. Mostrar la app en vivo en cuanto se pueda.')

// 2. Requisitos
s = titled('Qué cubre el proyecto')
const reqs = [
  ['15 procesos con quantum propio', 'RR, FCFS y prioridades'],
  ['7 estados y transiciones', 'incluye swap a disco'],
  ['Interbloqueo visible', 'grafo, detección, banquero'],
  ['Inanición con evidencia', 'y envejecimiento (aging)'],
  ['Memoria: compactación y overlays', 'fragmentación a la vista'],
  ['Sincronización', 'semáforos, mutex, carreras'],
  ['Disco real y 6 algoritmos', 'LinarezFS en disk.img'],
  ['Hardware real', 'USB, cámara, Wi-Fi, Bluetooth']
]
reqs.forEach(([a, b], i) => {
  const x = 0.5 + (i % 2) * 4.6, y = 1.3 + Math.floor(i / 2) * 0.95
  s.addShape(pres.ShapeType.roundRect, { x, y, w: 4.4, h: 0.8, rectRadius: 0.12, fill: { color: C.background2 }, objectName: 'Tarjeta ' + (i + 1) })
  s.addText([{ text: a, options: { bold: true, fontSize: 15, breakLine: true } }, { text: b, options: { fontSize: 12, color: C.text2 } }],
    { x: x + 0.2, y, w: 4.0, h: 0.8, valign: 'middle', margin: 0, color: C.text1, isTextBox: true })
})
s.addNotes('Cada tarjeta corresponde a un requisito de la tarea y a una app de la demo.')

// 3. Arquitectura
s = titled('Arquitectura')
const layers = [
  ['Interfaz estilo macOS', 'React + Framer Motion · ventanas, Dock, Spotlight', C.accent3],
  ['Proceso principal de Electron (HAL)', 'USB, batería, impresión, disco real, IPC', C.accent1],
  ['Kernel simulado (worker thread)', 'TypeScript puro · planificador, memoria, FS, E/S', C.accent2]
]
layers.forEach(([t, d, col], i) => {
  const y = 1.3 + i * 1.15
  s.addShape(pres.ShapeType.roundRect, { x: 0.5, y, w: 5.2, h: 0.95, rectRadius: 0.12, fill: { color: col }, objectName: 'Capa ' + (i + 1) })
  s.addText([{ text: t, options: { bold: true, fontSize: 16, breakLine: true } }, { text: d, options: { fontSize: 12 } }],
    { x: 0.7, y, w: 4.9, h: 0.95, valign: 'middle', margin: 0, color: C.background1, isTextBox: true })
})
bullets(s, ['El kernel no depende de Electron: se prueba por consola con Vitest', 'Los eventos reales entran como interrupciones (IRQ)', 'Más de 150 pruebas automáticas'], { x: 6.1, w: 3.4 })
s.addNotes('El kernel corre en su propio hilo; la interfaz solo recibe instantáneas de su estado.')

// 3b. Escritorio y sesiones
s = titled('Escritorio, sesiones y Terminal')
bullets(s, ['Inicio de sesión con cuentas guardadas en disk.img', 'Administrador y usuario estándar con permisos distintos', 'Bloquear, suspender, reiniciar y apagar', 'Terminal con comandos reales: ps, kill, mem, ls, exit…', 'Spotlight, Mission Control y Centro de control'])
shot(s, 'login')
s.addNotes('Mostrar el inicio de sesión: Victor (contraseña victor) es administrador; Ana solo escribe en su carpeta.')

// 4. Procesos
s = titled('Procesos, estados y planificación')
bullets(s, ['15 procesos: Finder, Terminal, Navegador, Antivirus…', 'Modelo de 7 estados con la causa de cada transición', 'Quantum distinto por proceso, editable en vivo', 'Round Robin, FCFS y prioridades expropiativas'])
shot(s, 'estados')
s.addNotes('Abrir el Diagrama de estados: las fichas se mueven y las aristas se iluminan.')

// 5. Memoria
s = titled('Memoria: fragmentación y compactación')
bullets(s, ['Particiones dinámicas: primer, mejor, peor y siguiente ajuste', 'Fragmentación externa detectada y mostrada', 'Compactación que reubica y cuesta CPU', 'Recubrimiento: el Compilador usa 180 KB en vez de 360', 'Swap real a disk.img'])
shot(s, 'memoria')
s.addNotes('Desactivar la compactación automática y esperar la alerta naranja; luego pulsar Compactar.')

// 6. Sincronización
s = titled('Sincronización de procesos')
bullets(s, ['Semáforos con cola FIFO y mutex con dueño', 'Productor–consumidor con búfer de 5 casillas', 'Sin mutex: actualizaciones perdidas (condición de carrera)', 'Sin semáforos: desbordamiento del búfer'])
shot(s, 'sincronizacion')
s.addNotes('Apagar los interruptores en la app Sincronización y ver los contadores en rojo.')

// 7. Interbloqueo e inanición
s = titled('Interbloqueo e inanición')
bullets(s, ['Spooler y Respaldo USB piden impresora y USB en orden inverso', 'Detección con grafo de asignación y ciclo en rojo', 'Recuperar, evitar (banquero) o prevenir', 'El Antivirus (prioridad 9) pasa más de 100 ticks sin CPU; el aging lo corrige'])
shot(s, 'interbloqueo')
s.addNotes('El interbloqueo aparece cerca del tick 115. Mostrar luego el aviso de inanición en el Monitor de actividad.')

// 8. Disco
s = titled('Disco y sistema de archivos')
bullets(s, ['LinarezFS: i-nodos, mapa de bits y asignación indexada', 'disk.img: archivo real de 32 MB que persiste', 'Brazo con FCFS, SSTF, SCAN, C-SCAN, LOOK y C-LOOK', 'Finder y Utilidad de Discos muestran los bloques'])
shot(s, 'disco')
s.addNotes('Cambiar el algoritmo del brazo y comparar la gráfica de recorrido.')

// 9. Hardware real
s = titled('Hardware real de la laptop')
const rows = [['Dispositivo', 'Cómo lo controla el kernel'],
  ['Teclado y ratón', 'cada tecla o clic es una IRQ'],
  ['Cámara', 'solo enciende si el proceso tiene el recurso'],
  ['Memoria USB', 'se detecta al conectar y recibe respaldos'],
  ['Wi-Fi y Bluetooth', 'se listan, conectan y activan'],
  ['Batería', 'poca carga: modo de bajo consumo'],
  ['Impresión', 'PDF real del documento que lee el Spooler']]
s.addTable(rows.map((r, i) => r.map((t) => ({ text: t, options: { bold: i === 0, color: i === 0 ? 'FFFFFF' : '1B1033', fill: { color: i === 0 ? '7B3FE4' : (i % 2 ? 'F3F0FA' : 'FFFFFF') } } }))),
  { x: 0.5, y: 1.3, w: 4.2, colW: [1.4, 2.8], fontSize: 11, border: { type: 'solid', color: 'E0DAF0', pt: 0.75 }, valign: 'middle', objectName: 'Tabla hardware' })
shot(s, 'hardware')
s.addNotes('Conectar una memoria USB durante la demo y mostrar la carpeta LinarezOS-respaldos.')

// 10. Cierre
s = pres.addSlide({ masterName: 'OSCURA' })
s.addText('Conclusiones', { x: 0.7, y: 0.6, w: 8.6, h: 0.8, fontFace: 'Cambria', fontSize: 40, bold: true, color: C.background1, margin: 0, isTextBox: true })
s.addText([
  'Un SO completo simulado: procesos, memoria, disco y E/S', 'Cada concepto se puede provocar y observar en vivo', 'Conectado a hardware real, no solo simulado'
].map((t, i, a) => ({ text: t, options: { bullet: true, breakLine: i < a.length - 1, paraSpaceAfter: 10 } })),
  { x: 0.7, y: 1.7, w: 8.6, h: 1.8, fontSize: 20, color: C.background2, margin: 0, isTextBox: true })
s.addText('Demostración en vivo con la app «Demostración»', { x: 0.7, y: 4.1, w: 8.6, h: 0.6, fontSize: 26, bold: true, color: C.accent2, margin: 0, isTextBox: true })
s.addNotes('Cerrar con la app Demostración: interbloqueo, inanición y fragmentación con un clic.')

;(async () => {
  await pres.writeFile({ fileName: 'docs/LinarezOS.pptx' })
  await applyTheme('docs/LinarezOS.pptx', THEME)
  console.log('ok')
})()
