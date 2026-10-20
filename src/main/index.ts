import { app, BrowserWindow, ipcMain, session, shell } from 'electron'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { KernelHost } from './kernelHost'
import { HardwareMonitor } from './hal/hardwareMonitor'
import { printJob } from './hal/printer'
import * as net from './hal/network'
import { IPC, type NetAction } from '@shared/ipc'
import type { NetResult } from '@shared/kernelTypes'
import type { HwState } from '@shared/kernelTypes'

let kernel: KernelHost | undefined
let hardware: HardwareMonitor | undefined
let lastHw: HwState | undefined

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function createWindow(): void {
  // Sin marco: el escritorio de guiñanOS (barra de menú, Dock, ventanas) ocupa toda la ventana.
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0b0b12',
    title: 'guiñanOS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  kernel?.attach(win.webContents)
  win.webContents.on('did-finish-load', () => {
    if (lastHw) win.webContents.send(IPC.hardware, lastHw)
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Ubuntu 24 bloquea el sandbox SUID de Chromium (AppArmor): sin esto el ejecutable no arranca.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox')

app.whenReady().then(() => {
  const dataDir = app.getPath('userData')
  const diskPath = join(dataDir, 'disk.img')
  const printDir = join(dataDir, 'Impresiones')

  // La cámara y el micrófono reales los usa la interfaz (getUserMedia).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(permission === 'media')
  )
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  // El disco de guiñanOS es un archivo real en la carpeta de datos de la aplicación.
  kernel = new KernelHost(diskPath)
  kernel.onEffect = (effect) => {
    if (effect.type !== 'print') return
    printJob(effect, printDir, lastHw?.printers ?? [])
      .then((path) => kernel?.command({ type: 'hwEvent', event: { kind: 'printed', path } }))
      .catch((err: Error) =>
        kernel?.command({
          type: 'hwEvent',
          event: { kind: 'printed', path: '', error: err.message }
        })
      )
  }

  hardware = new HardwareMonitor({
    diskPath,
    printDir,
    onEvent: (event) => kernel?.command({ type: 'hwEvent', event }),
    onState: (state) => {
      lastHw = state
      broadcast(IPC.hardware, state)
    }
  })
  void hardware.start()

  // Wi-Fi y Bluetooth reales: solo por acción explícita del usuario desde el Centro de control.
  ipcMain.handle(IPC.net, async (_e, a: NetAction): Promise<NetResult> => {
    let result: NetResult = { ok: true, message: '' }
    switch (a.type) {
      case 'wifiPower':
        result = await net.wifiPower(a.on)
        break
      case 'wifiScan':
        result = await net.wifiScan()
        break
      case 'wifiConnect':
        result = await net.wifiConnect(a.ssid, a.password)
        break
      case 'wifiDisconnect':
        result = await net.wifiDisconnect(lastHw?.net.wifi.device ?? '')
        break
      case 'btPower':
        result = await net.btPower(a.on)
        break
      case 'btScan':
        result = await net.btScan()
        break
      case 'btConnect':
        result = await net.btConnect(a.mac, a.connect)
        break
    }
    await hardware?.refreshNet()
    return result
  })
  ipcMain.handle(IPC.quit, () => app.quit())
  ipcMain.handle(IPC.toggleFullscreen, (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    win?.setFullScreen(!win.isFullScreen())
  })
  // Exportaciones (bitácora, reportes): se guardan en una carpeta propia de la aplicación.
  const exportDir = join(dataDir, 'Exportaciones')
  ipcMain.handle(IPC.saveExport, (_e, name: string, content: string) => {
    mkdirSync(exportDir, { recursive: true })
    const path = join(exportDir, name.replace(/[^\p{L}\d._-]/gu, '_'))
    writeFileSync(path, content)
    return path
  })
  // Abrir en el escritorio anfitrión carpetas reales (impresiones, respaldos en la USB).
  ipcMain.handle(IPC.openPath, (_e, path: string) => {
    const allowed = [dataDir, ...(lastHw?.storage.map((s) => s.mount) ?? [])]
    if (allowed.some((root) => path.startsWith(root))) return shell.openPath(path)
    return 'Ruta no permitida'
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  hardware?.stop()
  void kernel?.shutdown()
  app.quit()
})
