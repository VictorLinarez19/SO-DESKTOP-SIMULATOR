// Los 15 programas que arrancan con el sistema.
// Prioridad: 0 = máxima, 9 = mínima. Quantum en ticks. Memoria en KB (se usa a partir de F3).

export interface ProgramSpec {
  id: string
  name: string
  priority: number
  quantum: number
  memoryKb: number
  /** Tick en el que el proceso llega al sistema. */
  arrival: number
  source: string
  /**
   * Recubrimiento (overlays): parte residente + módulos que se turnan en un área común.
   * memoryKb debe ser rootKb + el módulo más grande.
   */
  overlays?: { rootKb: number; modules: Record<string, number> }
}

export const BOOT_PROGRAMS: ProgramSpec[] = [
  {
    id: 'launchd',
    name: 'launchd',
    priority: 0,
    quantum: 2,
    memoryKb: 64,
    arrival: 0,
    source: `
      # Proceso init: supervisa servicios periódicamente
      inicio: CPU 1
              SLEEP 30
              LOOP inicio`
  },
  {
    id: 'windowserver',
    name: 'WindowServer',
    priority: 1,
    quantum: 3,
    memoryKb: 128,
    arrival: 1,
    source: `
      # Compone las ventanas y espera el refresco de la pantalla (vsync)
      frame: CPU 1
             IO pantalla 16
             LOOP frame`
  },
  {
    id: 'finder',
    name: 'Finder',
    priority: 4,
    quantum: 4,
    memoryKb: 96,
    arrival: 2,
    source: `
      # Lista la carpeta Documentos (lee el directorio del disco) y espera al ratón
      ciclo: CPU 2
             FREAD /Usuarios/victor/Documentos
             CPU 1
             IO raton 12
             LOOP ciclo`
  },
  {
    id: 'terminal',
    name: 'Terminal',
    priority: 3,
    quantum: 3,
    memoryKb: 48,
    arrival: 3,
    source: `
      # Espera órdenes del teclado y muestra la salida
      shell: CPU 1
             IO teclado 30
             CPU 1
             IO pantalla 3
             LOOP shell`
  },
  {
    id: 'editor',
    name: 'Editor de texto',
    priority: 4,
    quantum: 4,
    memoryKb: 80,
    arrival: 4,
    source: `
      # Guarda el documento en el disco tras cada edición
      edita: CPU 1
             IO teclado 20
             CPU 1
             FWRITE /Usuarios/victor/Documentos/notas.txt 8
             LOOP edita`
  },
  {
    id: 'navegador',
    name: 'Navegador',
    priority: 5,
    quantum: 3,
    memoryKb: 256,
    arrival: 5,
    source: `
      # Antes de pedir la página registra el tráfico en el contador compartido.
      # Su quantum (3) es menor que la sección crítica: puede ser expropiado dentro de ella.
      pagina: CPU 2
              LOCK m_red
              LOAD red_bytes
              CPU 3
              ADDI 1
              STORE red_bytes
              UNLOCK m_red
              IO red 10
              IO pantalla 2
              LOOP pagina`
  },
  {
    id: 'musica',
    name: 'Música',
    priority: 2,
    quantum: 3,
    memoryKb: 72,
    arrival: 6,
    source: `
      # Uso exclusivo de las bocinas; decodifica un bloque de audio y lo reproduce
              REQ audio
      bloque: CPU 1
              IO audio 20
              LOOP bloque`
  },
  {
    id: 'camara',
    name: 'Cámara',
    priority: 3,
    quantum: 3,
    memoryKb: 112,
    arrival: 8,
    source: `
      # Uso exclusivo de la cámara mientras está abierta
              REQ camara
      cuadro: CPU 2
              IO camara 30
              LOOP cuadro`
  },
  {
    id: 'descargas',
    name: 'Descargas',
    priority: 5,
    quantum: 4,
    memoryKb: 64,
    arrival: 9,
    source: `
      # Productor: descarga un bloque, actualiza el contador de red y lo deja en el búfer
      bajar: IO red 8
             LOCK m_red
             LOAD red_bytes
             CPU 2
             ADDI 1
             STORE red_bytes
             UNLOCK m_red
             WAIT vacios
             LOCK m_buffer
             PUT buffer
             UNLOCK m_buffer
             SIGNAL llenos
             LOOP bajar`
  },
  {
    id: 'indexador',
    name: 'Indexador',
    priority: 5,
    quantum: 5,
    memoryKb: 64,
    arrival: 10,
    source: `
      # Consumidor: toma un bloque del búfer, lo indexa y consulta el paquete descargado
      indexa: WAIT llenos
              LOCK m_buffer
              GET buffer
              UNLOCK m_buffer
              SIGNAL vacios
              CPU 6
              FREAD /Descargas/paquete.bin
              LOOP indexa`
  },
  {
    id: 'spooler',
    name: 'Spooler de impresión',
    priority: 5,
    quantum: 3,
    memoryKb: 48,
    arrival: 12,
    source: `
      # Lee el documento a imprimir, toma la impresora y después la memoria USB
      trabajo: FREAD /Usuarios/victor/Documentos/tarea_SO.txt
               CPU 2
               REQ impresora
               CPU 2
               REQ usb
               IO impresora 10
               REL usb
               REL impresora
               LOOP trabajo`
  },
  {
    id: 'respaldo',
    name: 'Respaldo USB',
    priority: 5,
    quantum: 5,
    memoryKb: 96,
    arrival: 14,
    source: `
      # Lee el informe del disco, toma la memoria USB y después la impresora para el
      # comprobante: orden inverso al del Spooler → posible interbloqueo
      copia: FREAD /Usuarios/victor/Documentos/informe.txt
             REQ usb
             CPU 2
             REQ impresora
             IO usb 8
             REL impresora
             REL usb
             LOOP copia`
  },
  {
    id: 'compilador',
    name: 'Compilador',
    priority: 4,
    quantum: 6,
    // Con recubrimiento: 60 KB residentes + 120 KB de área de overlay (el módulo mayor).
    // Sin recubrimiento necesitaría 60 + 80 + 120 + 100 = 360 KB.
    memoryKb: 180,
    overlays: { rootKb: 60, modules: { lexico: 80, sintactico: 120, codegen: 100 } },
    arrival: 16,
    source: `
      # Compila 3 veces main.c; cada fase es un módulo de recubrimiento distinto
      archivo: FREAD /Usuarios/victor/Proyectos/main.c
               OVERLAY lexico
               CPU 4
               OVERLAY sintactico
               CPU 6
               OVERLAY codegen
               CPU 4
               FWRITE /Usuarios/victor/Proyectos/a.out 24
               LOOP archivo 3
               EXIT`
  },
  {
    id: 'antivirus',
    name: 'Antivirus',
    priority: 9,
    quantum: 8,
    memoryKb: 128,
    arrival: 18,
    source: `
      # Baja prioridad: candidato a inanición. Analiza los archivos del disco uno a uno.
      escaneo: CPU 12
               FSCAN
               LOOP escaneo 5
               EXIT`
  },
  {
    id: 'monitor',
    name: 'Monitor de actividad',
    priority: 2,
    quantum: 2,
    memoryKb: 64,
    arrival: 20,
    source: `
      muestra: CPU 1
               SLEEP 20
               LOOP muestra`
  }
]

export function findProgram(id: string): ProgramSpec | undefined {
  return BOOT_PROGRAMS.find((p) => p.id === id)
}
