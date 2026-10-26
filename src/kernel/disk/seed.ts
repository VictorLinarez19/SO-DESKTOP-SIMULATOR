import type { LinarezFS } from './fs'

const enc = new TextEncoder()

/** Texto legible para los archivos .txt / .c, de exactamente `kb` KB. */
export function textContent(title: string, kb: number, body: string): Uint8Array {
  const size = kb * 1024
  const head = `${title}\n${'='.repeat(Math.min(60, title.length))}\n\n${body}\n\n`
  let text = head
  let i = 1
  while (enc.encode(text).length < size) {
    text += `Línea ${i++}: contenido almacenado en los bloques de datos de LinarezFS.\n`
  }
  return enc.encode(text).slice(0, size)
}

/**
 * Contenido inicial del disco. Se crean y borran archivos de relleno para que el
 * disco tenga huecos (como un sistema con uso) y los archivos queden repartidos en
 * distintos cilindros.
 */
export function seedFileSystem(fs: LinarezFS, now: number): void {
  const big = (path: string, kb: number): void => void fs.writeFile(path, { size: kb * 1024 }, now)
  const txt = (path: string, kb: number, title: string, body: string): void =>
    void fs.writeFile(path, textContent(title, kb, body), now)

  big('/Sistema/kernel.img', 1536)
  big('/Sistema/librerias/libc.so', 512)
  big('/.relleno/a', 900)
  big('/Sistema/compilador/lexico.ovl', 80)
  big('/Sistema/compilador/sintactico.ovl', 120)
  big('/Sistema/compilador/codegen.ovl', 100)
  big('/Aplicaciones/Finder.app', 640)
  big('/.relleno/b', 1200)
  big('/Aplicaciones/Navegador.app', 1536)
  big('/Sistema/librerias/libgui.so', 768)
  big('/.relleno/c', 700)
  big('/Aplicaciones/Música.app', 384)
  big('/Aplicaciones/Terminal.app', 256)
  big('/Usuarios/victor/Música/cancion1.mp3', 3072)
  big('/.relleno/d', 1500)
  big('/Usuarios/victor/Imágenes/foto1.png', 1024)
  big('/Usuarios/victor/Música/cancion2.mp3', 2560)
  big('/.relleno/e', 900)
  big('/Usuarios/victor/Imágenes/foto2.png', 900)
  big('/Descargas/paquete.bin', 16)

  // Al borrar el relleno quedan huecos repartidos por el disco: los archivos de
  // usuario que se creen después caerán en cilindros distintos.
  for (const f of ['a', 'b', 'c', 'd', 'e']) fs.remove(`/.relleno/${f}`, now)
  fs.remove('/.relleno', now)

  txt(
    '/Usuarios/victor/Documentos/notas.txt',
    8,
    'Notas',
    'Pendientes: terminar el simulador de LinarezOS y preparar la exposición.'
  )
  txt(
    '/Usuarios/victor/Documentos/informe.txt',
    24,
    'Informe de Sistemas de Operación',
    'Administración de procesos, memoria, disco y dispositivos de E/S.'
  )
  txt(
    '/Usuarios/victor/Documentos/tarea_SO.txt',
    12,
    'Tarea: algoritmos de planificación del disco',
    'FCFS, SSTF, SCAN, C-SCAN, LOOK y C-LOOK. Comparar el movimiento total del brazo.'
  )
  txt(
    '/Usuarios/victor/Proyectos/main.c',
    16,
    '/* main.c */',
    '#include <stdio.h>\nint main(void) {\n  printf("Hola desde LinarezOS\\n");\n  return 0;\n}'
  )
  fs.mkdir('/Respaldos', now)
}
