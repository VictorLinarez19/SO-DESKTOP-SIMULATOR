# Guía de demostración de LinarezOS

Guía paso a paso para presentar el simulador frente al profesor. Sigue el orden de las secciones: cada
una muestra uno o varios requisitos del proyecto, dice **qué hacer**, **qué se debe ver** y **qué
explicar**. La demostración completa dura entre 20 y 25 minutos.

---

## 0. Antes de la presentación (hazlo un día antes)

1. Instala y prueba que arranque:

   ```bash
   npm install
   node node_modules/electron/install.js   # solo si Electron no se descargó
   npm run dev
   ```

   Si sale el error `Cannot read properties of undefined (reading 'commandLine')`, arranca con:

   ```bash
   env -u ELECTRON_RUN_AS_NODE npm run dev
   ```

2. Corre las pruebas para tener la evidencia lista (deben pasar las 161):

   ```bash
   npm test
   ```

3. Ten a la mano:
   - Una **memoria USB** (para la interrupción y el respaldo real).
   - El **cargador** de la laptop (para mostrar la IRQ de batería).
   - La cámara web destapada.

4. Abre una vez cada app para revisar que todo cargue. Al final usa **Demostración → Restaurar el
   sistema** para dejar el kernel limpio.

5. Pon la ventana en pantalla completa con `F11` el día de la presentación.

> **Consejo:** si en algún momento algo se ve raro o se te pierde el hilo, abre **Demostración** y
> pulsa **Restaurar el sistema**. Reinicia el kernel con la configuración normal.

---

## 1. Arranque e inicio de sesión (≈ 2 min)

**Qué hacer**

1. Ejecuta `npm run dev`. Se ve la pantalla de arranque con los mensajes del kernel (carga del
   kernel, montaje de LinarezFS desde `disk.img`, etc.).
2. En la pantalla de inicio de sesión entra con:

   | Usuario | Contraseña | Tipo |
   |---|---|---|
   | **victor** | `victor` | Administrador |
   | Invitado | _(ninguna)_ | Estándar |

3. Equivócate a propósito una vez con la contraseña para mostrar que la valida.

**Qué explicar**

- El sistema no entra directo al escritorio: pide una cuenta como un SO real.
- Las cuentas se guardan **dentro del disco simulado** (`/Sistema/cuentas.txt` en `disk.img`) y la
  contraseña se guarda con **sal + SHA-256**, nunca en texto plano.

---

## 2. El escritorio como SO (≈ 3 min)

**Qué hacer**

1. Abre varias apps desde el **Dock** (abajo): Finder, Editor de texto, Terminal.
2. Mueve, cambia de tamaño, minimiza (`Ctrl+M`) y cierra (`Ctrl+W`) ventanas.
3. Pulsa `Ctrl+Espacio` para abrir **Spotlight** y busca una app o un proceso (por ejemplo,
   «Antivirus»).
4. Pulsa `F3` para **Mission Control** (vista de todas las ventanas).
5. Abre el **Centro de control** (arriba a la derecha) y cambia el fondo de pantalla.
6. Pulsa `Espacio` (con el escritorio activo) para **pausar** el kernel y otra vez para
   **reanudarlo**.

**Qué explicar**

- Cada app del escritorio es un **proceso** del kernel. Cuando una ventana está activa, el proceso
  de esa app recibe las teclas y clics como **interrupciones** (IRQ).
- El kernel corre en su propio hilo; la interfaz solo dibuja lo que el kernel le manda.

---

## 3. Procesos y planificación (≈ 4 min)

Requisito: **15 procesos con quantum por proceso**.

**Qué hacer**

1. Abre **Monitor de actividad**.
2. Muestra la tabla: PID, proceso, estado, prioridad, quantum, % CPU, memoria, tiempo de CPU, espera.
   Cuenta los **15 procesos** (launchd, WindowServer, Finder, Terminal, Editor de texto, Navegador,
   Música, Cámara, Descargas, Indexador, Spooler de impresión, Respaldo USB, Compilador, Antivirus y
   Monitor de actividad).
3. Señala el **diagrama de Gantt** (uso de la CPU por tick) y las métricas de abajo: espera
   promedio, respuesta promedio, retorno promedio y cambios de contexto.
4. Cambia el **planificador** en la barra superior: FCFS → Round Robin → Prioridades + Round Robin.
   Muestra cómo cambia el Gantt.
5. Haz clic en un proceso (por ejemplo, **Compilador**) para abrir el **Inspector**:
   - Muestra su PCB: estado, contador de programa, registros base y límite, recursos asignados,
     tiempo en Listo, ráfaga restante, etc.
   - Cambia su **quantum** y su **prioridad** desde el Inspector.
   - Pulsa **Suspender** y luego **Reactivar**.
   - Pulsa **Forzar salida** y después **Relanzar**.

**Qué explicar**

- Cada proceso tiene **su propio quantum** (por ejemplo, launchd tiene 2, el Antivirus 8).
- Prioridad **0 = máxima, 9 = mínima** (convención de Silberschatz).
- Pestaña **E/S** del Monitor: colas de los dispositivos y qué proceso atiende cada uno.

---

## 4. Estados y transiciones (≈ 2 min)

Requisito: **modelo de 7 estados**.

**Qué hacer**

1. Abre **Diagrama de estados**.
2. Muestra los 7 estados: Nuevo, Listo, Ejecutando, Bloqueado, Listo-suspendido,
   Bloqueado-suspendido y Terminado. Las transiciones se iluminan conforme ocurren.
3. Con el diagrama abierto, vuelve al Monitor de actividad y **suspende** un proceso: verás la
   transición a un estado suspendido. Al **reactivarlo** regresa.

**Qué explicar**

- Los estados suspendidos significan que la imagen del proceso se mandó al **área de intercambio
  (swap)** en disco.

---

## 5. Inanición y aging (≈ 3 min)

Requisito: **inanición con evidencia** y su corrección.

**Qué hacer**

1. Abre **Demostración** y en la tarjeta **Provocar inanición** pulsa **Iniciar**. Se abre el
   Monitor de actividad solo.
2. Espera a que la barra de progreso de la tarjeta se llene (≈ 280 ticks).
3. Señala el aviso **Inanición:** en el Monitor de actividad: el **Antivirus** (prioridad 9) lleva
   más de 100 ticks seguidos en Listo sin recibir CPU. Muestra la columna **Racha en Listo**.
4. Regresa a **Demostración** y pulsa **Iniciar** en **Corregir la inanición (aging)**.
5. Muestra cómo la prioridad efectiva del Antivirus sube mientras espera hasta que por fin se ejecuta.

**Qué explicar**

- Con prioridades estrictas, un proceso de baja prioridad puede no ejecutarse nunca.
- El **envejecimiento (aging)** sube poco a poco la prioridad de quien espera mucho.

---

## 6. Interbloqueo (≈ 4 min)

Requisito: **interbloqueo existente y mostrado**.

**Qué hacer**

1. En **Demostración** pulsa **Iniciar** en **Provocar un interbloqueo**. Se abre la app
   **Interbloqueo**.
2. Espera ≈ 260 ticks. Aparece una **notificación** y en el **grafo de asignación de recursos** se
   pinta el **ciclo en rojo**:
   - **Spooler de impresión** tiene la *impresora* y pide la *USB*.
   - **Respaldo USB** tiene la *USB* y pide la *impresora*.
3. Señala el panel **Condiciones de Coffman**: las cuatro aparecen cumplidas (exclusión mutua,
   retención y espera, sin expropiación y espera circular).
4. Muestra la tabla **Estado de asignación (algoritmo del banquero)**: Asignado, Máximo, Necesidad y
   Disponible.
5. Resuélvelo a mano con **Abortar víctima** o **Recuperar (retroceso)**. El ciclo desaparece.
6. Ahora pulsa **Iniciar** en **Evitar el interbloqueo (banquero)**. Son los mismos procesos, pero el
   banquero **retiene la solicitud peligrosa** y nunca se forma el ciclo. Muestra el contador
   **Solicitudes retenidas (banquero)**.

**Qué explicar**

- Las 4 estrategias que tiene el sistema (selector **Estrategia**): Ignorar (avestruz), Detectar y
  recuperar, Evitar (banquero) y Prevenir (sin retención y espera).
- Recuperación por **abortar** (se mata a la víctima) o por **retroceso / rollback** (se le quitan
  los recursos y se reinicia).

---

## 7. Memoria: fragmentación, compactación y recubrimiento (≈ 3 min)

Requisito: **compactación, recubrimiento (overlays) y fragmentación mostrada**.

**Qué hacer**

1. Abre **Memoria**. Muestra el mapa: el **Sistema operativo (residente)** al inicio, las
   particiones de cada proceso y los **huecos libres**. Abajo, la **Tabla de particiones** (base,
   límite, tamaño) y el **Área de intercambio (disco)**.
2. En **Demostración** pulsa **Iniciar** en **Fragmentación externa**. Esto apaga la compactación
   automática.
3. Espera ≈ 120 ticks. Aparece la **alerta naranja de fragmentación externa**: un proceso espera
   aunque **la suma** de la memoria libre sí alcanza, porque no está contigua.
4. Pulsa **Compactar**. Los procesos se recorren, los huecos se juntan en uno y el proceso entra.
   Muestra el contador **Compactaciones** y **Última compactación**.
5. Cambia la política de **Colocación**: Primer ajuste, Mejor ajuste, Peor ajuste y Siguiente ajuste.
6. Para el **recubrimiento**, busca el proceso **Compilador** en el mapa: su partición tiene una
   **raíz (residente)** y un **área de OVERLAY** donde se cargan por turnos las fases *léxico*,
   *sintáctico* y *codegen*.

**Qué explicar**

- Diferencia entre **fragmentación interna** (espacio sobrante dentro de una partición) y
  **externa** (huecos sueltos entre particiones). Ambas aparecen como métricas.
- Con overlays, un programa más grande que su partición puede ejecutarse cargando solo la parte que
  necesita en cada momento.

---

## 8. Sincronización (≈ 3 min)

Requisito: **sincronización de procesos**.

**Qué hacer**

1. Abre **Sincronización**. Muestra:
   - **Productor–consumidor:** *Descargas* produce (`PUT`) y el *Indexador* consume (`GET`) del búfer
     FIFO. Los **semáforos** `vacios` y `llenos` cuentan las casillas y el **mutex** `m_buffer`
     protege el búfer.
   - **Sección crítica:** *Navegador* y *Descargas* actualizan una **variable compartida** protegida
     por el mutex `m_red`. Muestra quién es el **dueño** del mutex y quién está **en espera**.
2. En **Demostración** pulsa **Iniciar** en **Condición de carrera**. Se quita el mutex: el **valor
   real** de la variable deja de coincidir con el **esperado** y aparecen **actualizaciones
   perdidas** y el aviso **¡Exclusión mutua violada!**
3. Opcional: **Sin sincronización: desbordamiento** apaga también los semáforos y el productor
   escribe con el búfer lleno, perdiendo datos (≈ 700 ticks; puedes dejarlo corriendo mientras
   explicas).

**Qué explicar**

- El Navegador tiene un quantum (3) menor que su sección crítica: puede ser **expropiado a mitad**
  de ella. Por eso sin mutex hay carrera.

---

## 9. Disco y sistema de archivos (≈ 3 min)

Requisito: **disco duro**.

**Qué hacer**

1. Abre **Finder**. Navega a `/Usuarios/victor/Documentos` y abre `notas.txt`. Crea un documento
   nuevo y una carpeta.
2. Abre **Utilidad de Discos**:
   - Muestra el **Mapa de bloques**: bloques de metadatos, libres, usados y swap. Selecciona un
     archivo en el Finder y se resaltan **su bloque índice y sus bloques de datos** (asignación
     indexada).
   - Muestra el panel **Brazo del disco** con su recorrido.
3. En **Demostración** pulsa **Iniciar** en **Comparar planificación del disco** (arranca en FCFS).
   Después cambia la **Planificación del brazo** a SSTF, SCAN, C-SCAN, LOOK y C-LOOK y compara el
   recorrido total del brazo.
4. Muestra los **permisos**: cierra sesión (`Ctrl+Mayús+Q`), entra como **Invitado** e intenta borrar
   un archivo de `/Usuarios/victor`. No te deja. Vuelve a entrar como **victor**.

**Qué explicar**

- El disco **es un archivo real** de 32 MB: `~/.config/LinarezOS/disk.img`. Lo que guardas
  **persiste** aunque cierres la app.
- LinarezFS usa **i-nodos, mapa de bits y asignación indexada**.

---

## 10. Hardware real y E/S (≈ 3 min)

Requisito: **E/S y hardware real**.

**Qué hacer** (elige lo que tengas a la mano)

1. **Teclado y ratón:** escribe en el Editor de texto; en el Monitor de actividad (pestaña **E/S**)
   o en la **Consola del kernel** se ven las IRQ que llegan al proceso de la ventana activa.
2. **Cámara:** abre **Cámara**. Solo enciende cuando el proceso *Cámara* obtiene el recurso
   `camara`. Toma una foto: se guarda como PNG en el disco de LinarezOS.
3. **Música:** abre **Música**. Las bocinas suenan solo mientras el dispositivo de audio atiende al
   proceso *Música*.
4. **Memoria USB:** conéctala. Llega una IRQ, el proceso **Respaldo USB** copia un archivo **real** a
   la carpeta `LinarezOS-respaldos/` de la memoria. Muéstralo después en el explorador de archivos
   de Ubuntu.
5. **Batería:** desconecta y vuelve a conectar el cargador. Llega una IRQ. Sin cargador y con menos
   de 20 % el kernel ralentiza su reloj.
6. **Impresión:** el Spooler genera un **PDF real** en `~/.config/LinarezOS/Impresiones`.
7. **Wi-Fi y Bluetooth:** en el **Centro de control** puedes listar y conectar redes reales.
   ⚠️ Esto cambia el Wi-Fi real de la laptop; no lo desconectes si dependes de internet en la
   presentación.
8. Abre **Información del sistema** para mostrar el hardware real detectado y los **controladores
   de dispositivo** de LinarezOS.

---

## 11. Terminal (≈ 2 min)

Abre **Terminal** y escribe estos comandos en orden. Todos consultan o controlan el kernel de
verdad:

```text
help                 # lista de comandos
whoami               # victor (administrador)
ps                   # tabla de procesos
info <pid>           # PCB completo de un proceso (toma un PID de la tabla de ps)
nice <pid> 1         # cambia la prioridad
quantum <pid> 6      # cambia el quantum
sched rr             # cambia el planificador a Round Robin
mem                  # mapa de memoria
compact              # compacta
deadlock             # estrategia y estado del interbloqueo
disk scan            # cambia el algoritmo del brazo
ls /Usuarios/victor/Documentos
cat /Usuarios/victor/Documentos/informe.txt
lsdev                # controladores de dispositivo
```

---

## 12. Cierre: evidencia y energía (≈ 1 min)

1. Abre **Consola del kernel** y exporta la bitácora en **CSV o JSON** y el **reporte en Markdown**.
   Se guardan en `~/.config/LinarezOS/Exportaciones`. Es buena evidencia para entregar.
2. Muestra el menú del logo (arriba a la izquierda): **Bloquear pantalla**, **Suspender**,
   **Reiniciar**, **Apagar** y **Cerrar sesión**. Termina con **Apagar**.

---

## Tabla rápida: requisito → dónde se ve

| Requisito | App | Escenario de Demostración |
|---|---|---|
| Funciones de un SO de escritorio | Escritorio, Dock, Spotlight, Mission Control, sesión | — |
| 15 procesos con quantum propio | Monitor de actividad | — |
| 7 estados y transiciones | Diagrama de estados | — |
| PCB de cada proceso | Monitor de actividad → Inspector | — |
| Inanición | Monitor de actividad | Provocar inanición / Corregir (aging) |
| Interbloqueo | Interbloqueo | Provocar un interbloqueo / Evitar (banquero) |
| Fragmentación y compactación | Memoria | Fragmentación externa |
| Recubrimiento (overlays) | Memoria (proceso Compilador) | — |
| Sincronización | Sincronización | Condición de carrera / Desbordamiento |
| Disco duro | Finder, Utilidad de Discos | Comparar planificación del disco |
| Hardware real y E/S | Información del sistema, Centro de control, Cámara, Música | — |

## Atajos útiles

| Atajo | Acción |
|---|---|
| `Ctrl+Espacio` | Spotlight |
| `F3` o `Ctrl+↑` | Mission Control |
| `Espacio` | Pausar / reanudar el kernel |
| `F11` | Pantalla completa |
| `Ctrl+W` / `Ctrl+M` / `Ctrl+Q` / `Ctrl+N` | Cerrar / minimizar / salir de la app / nueva ventana |
| `Ctrl+Alt+Q` | Bloquear pantalla |
| `Ctrl+Mayús+Q` | Cerrar sesión |

## Si algo sale mal

| Problema | Solución |
|---|---|
| `Electron uninstall` al correr `npm run dev` | `node node_modules/electron/install.js` |
| `Cannot read properties of undefined (reading 'commandLine')` | `env -u ELECTRON_RUN_AS_NODE npm run dev` |
| El kernel parece detenido | Pulsa `Espacio` o escribe `run` en la Terminal |
| Un fenómeno no aparece | En Demostración pulsa **Reiniciar escenario** y espera a que se llene la barra |
| Todo quedó en un estado raro | Demostración → **Restaurar el sistema** |
| Avisos `vaInitialize failed` u `ozone-platform` en la consola | Son avisos de la tarjeta gráfica; ignóralos |
