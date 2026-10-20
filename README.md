# guiñanOS

Simulador de sistema operativo de escritorio para la materia **Sistemas de Operación**. Un kernel
simulado (procesos, memoria, disco, sincronización, interbloqueo) con interfaz estilo macOS y
conectado al **hardware real** de la computadora (teclado, ratón, USB, cámara, batería, Wi-Fi,
Bluetooth, impresión).

## Cómo levantarlo

```bash
npm install
node node_modules/electron/install.js   # solo si Electron no se descargó solo
npm run dev                             # abre guiñanOS
```

Otras órdenes:

| Orden | Qué hace |
|---|---|
| `npm run build && npm run preview` | Compila y abre la versión de producción |
| `npm run dist` | Genera el ejecutable `.AppImage` en `release/` |
| `npm test` | Pruebas automáticas del kernel, el disco, las cuentas y la Terminal |
| `npm run sim -- --ticks 800 --plain` | El kernel sin interfaz, por consola |
| `npm run typecheck` · `npm run lint` | Comprobaciones de código |

> En Ubuntu, Chromium puede negarse a arrancar por su sandbox SUID; los scripts `dev` y `preview` ya
> incluyen `--noSandbox`.

### Primer inicio de sesión

El sistema **no entra solo al escritorio**: arranca, muestra la pantalla de inicio de sesión y pide la
cuenta. Cuentas iniciales (se guardan en `disk.img`, con la contraseña protegida con sal + SHA-256):

| Cuenta | Contraseña | Tipo |
|---|---|---|
| Juan | `guinan` | Administrador |
| Invitado | _(ninguna)_ | Estándar |

Un administrador crea y elimina cuentas en **Usuarios y contraseñas**. Una cuenta estándar solo puede
modificar su carpeta personal (`/Usuarios/<cuenta>`), tanto en el Finder como en la Terminal.

## Requisitos del proyecto y dónde verlos

| Requisito | Dónde se ve |
|---|---|
| Funciones de un SO de escritorio | Escritorio, ventanas, Dock, Spotlight, Mission Control, sesiones, Terminal |
| 15 procesos con quantum por proceso | **Monitor de actividad** (tabla, Gantt, quantum editable) |
| Estados y transiciones (7 estados) | **Diagrama de estados** |
| Información de cada proceso (recursos, prioridad) | Inspector del Monitor de actividad (clic en un proceso) |
| Interbloqueo existente y mostrado | **Interbloqueo** (grafo de asignación con el ciclo en rojo) |
| Inanición con evidencia | Aviso en el Monitor de actividad; el *aging* la corrige |
| Memoria: compactación y recubrimiento | **Memoria** (mapa, compactar, overlays del Compilador) |
| Fragmentación mostrada | Alerta naranja y métricas en **Memoria** |
| Sincronización de procesos | **Sincronización** (semáforos, mutex, búfer, condición de carrera) |
| Disco duro | **Utilidad de Discos** y **Finder** (`disk.img` real, guiñanFS, 6 algoritmos del brazo) |
| E/S y hardware real | **Información del sistema** y el **Centro de control** |

La app **Demostración** reinicia el kernel y lo configura con un clic para provocar cada fenómeno
(interbloqueo, inanición, fragmentación, carrera…).

## Hardware real

| Dispositivo | Comportamiento |
|---|---|
| Teclado y ratón | Cada tecla o clic es una interrupción (IRQ) para el proceso de la ventana activa |
| Cámara | Solo enciende si el proceso Cámara posee el recurso `camara` |
| Memoria USB | Al conectarla hay una IRQ y el proceso Respaldo USB copia un archivo real a `guiñanOS-respaldos/` |
| Batería y cargador | IRQ al cambiar; sin cargador y bajo 20 % el kernel ralentiza su reloj |
| Wi-Fi y Bluetooth | **Centro de control**: listar, conectar, desconectar y activar (NetworkManager y BlueZ reales) |
| Impresión | El Spooler genera un PDF real en `~/.config/guiñanOS/Impresiones` |
| Disco | `~/.config/guiñanOS/disk.img` (32 MB) con un sistema de archivos propio |
| Bocinas | Suenan solo mientras el dispositivo de audio atiende al proceso Música |

El Wi-Fi y el Bluetooth cambian el estado real del equipo: solo actúan cuando tú los pulsas.

## Energía y sesión

Menú del logo o Centro de control: **Bloquear pantalla** (`Ctrl+Alt+Q`), **Suspender** (el kernel se
pausa hasta pulsar una tecla), **Reiniciar**, **Apagar** y **Cerrar sesión** (`Ctrl+Mayús+Q`).

## Atajos

| Atajo | Acción |
|---|---|
| `Ctrl+Espacio` | Spotlight (apps, procesos, archivos, acciones) |
| `F3` o `Ctrl+↑` | Mission Control |
| `Espacio` | Pausar o reanudar el kernel |
| `F11` | Pantalla completa |
| `Ctrl+W` / `Ctrl+M` / `Ctrl+Q` / `Ctrl+N` | Cerrar, minimizar, salir de la app, nueva ventana |

## Terminal

Comandos reales que consultan y controlan el kernel. Escribe `help` para la lista completa:
`ps`, `top`, `info`, `kill`, `nice`, `quantum`, `suspend`, `resume`, `spawn`, `sched`, `aging`,
`mem`, `fit`, `compact`, `sync`, `deadlock`, `res`, `disk`, `df`, `ls`, `cd`, `pwd`, `cat`, `mkdir`,
`rmdir`, `rm`, `lsdev`, `whoami`, `uptime`, `pause`, `run`, `speed`, `reset`, `clear`, y de sesión:
`exit` (cierra la Terminal), `logout`, `lock`, `sleep`, `reboot`, `shutdown`.

## Exportar evidencia

La **Consola del kernel** exporta la bitácora completa en CSV o JSON y un reporte en Markdown con las
métricas y el estado final, en `~/.config/guiñanOS/Exportaciones`.

## Arquitectura

```
src/kernel/    Kernel en TypeScript puro (se prueba sin Electron)
  process/ scheduler/ memory/ sync/ resources/ disk/ devices/
src/main/      Proceso principal de Electron: worker del kernel y capa de hardware (HAL)
src/preload/   Puente seguro entre la interfaz y el sistema
src/renderer/  Interfaz React: ventanas, Dock, apps
src/shared/    Tipos, cuentas, escenarios e intérprete de la Terminal
tests/         Pruebas con Vitest
```

El kernel corre en su propio hilo (`worker_thread`); la interfaz solo recibe instantáneas de su estado
y le envía órdenes. Los eventos del hardware real entran al kernel como interrupciones.

## Pruebas

`npm test` ejecuta más de 150 pruebas: planificación, estados, memoria, sincronización,
interbloqueo (incluido el algoritmo del banquero), planificación del brazo del disco con los totales
del libro de Silberschatz, el sistema de archivos, las cuentas, la Terminal y cada escenario de
demostración.
