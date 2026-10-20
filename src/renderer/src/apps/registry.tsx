import type { AppId } from './manifest'
import { ActivityMonitor } from './activity/ActivityMonitor'
import { StateDiagram } from './diagram/StateDiagram'
import { KernelConsole } from './console/KernelConsole'
import { About } from './about/About'
import { MemoryApp } from './memory/MemoryApp'
import { SyncApp } from './sync/SyncApp'
import { DeadlockApp } from './deadlock/DeadlockApp'
import { Finder } from './finder/Finder'
import { DiskUtility } from './disk/DiskUtility'
import { DevicesApp } from './devices/DevicesApp'
import { CameraApp } from './camera/CameraApp'
import { MusicApp } from './music/MusicApp'
import { TextEdit } from './textedit/TextEdit'
import { TerminalApp } from './terminal/TerminalApp'
import { UsersApp } from './users/UsersApp'
import { DemoApp } from './demo/DemoApp'

export const APP_COMPONENTS: Record<AppId, () => React.JSX.Element> = {
  finder: Finder,
  disk: DiskUtility,
  devices: DevicesApp,
  camera: CameraApp,
  music: MusicApp,
  textedit: TextEdit,
  terminal: TerminalApp,
  users: UsersApp,
  demo: DemoApp,
  activity: ActivityMonitor,
  diagram: StateDiagram,
  memory: MemoryApp,
  sync: SyncApp,
  deadlock: DeadlockApp,
  console: KernelConsole,
  about: About
}
