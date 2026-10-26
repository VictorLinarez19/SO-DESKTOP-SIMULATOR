// Iconos de las apps, dibujados en SVG al estilo de los iconos de macOS (cuadrado redondeado).
import type { AppId } from '../apps/manifest'

function Squircle({ from, to, children }: { from: string; to: string; children: React.ReactNode }) {
  const id = `g-${from.slice(1)}-${to.slice(1)}`
  return (
    <svg viewBox="0 0 100 100" className="app-icon-svg">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="92" height="92" rx="22" fill={`url(#${id})`} />
      <rect
        x="4.5"
        y="4.5"
        width="91"
        height="91"
        rx="21.5"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
      />
      {children}
    </svg>
  )
}

function ActivityIcon() {
  return (
    <Squircle from="#3a3a3c" to="#111113">
      <rect x="18" y="20" width="64" height="60" rx="8" fill="#0b0b0d" />
      <path
        d="M22 58 L34 58 L40 40 L48 70 L56 30 L62 58 L78 58"
        fill="none"
        stroke="#30d158"
        strokeWidth="4.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Squircle>
  )
}

function DiagramIcon() {
  return (
    <Squircle from="#5e5ce6" to="#2c2a9e">
      <g stroke="#fff" strokeWidth="3.5" fill="none" opacity="0.9">
        <path d="M33 34 L66 34" />
        <path d="M30 40 L45 64" />
        <path d="M70 40 L55 64" />
      </g>
      <circle cx="27" cy="33" r="9" fill="#ffd60a" />
      <circle cx="73" cy="33" r="9" fill="#30d158" />
      <circle cx="50" cy="70" r="9" fill="#ff453a" />
    </Squircle>
  )
}

function MemoryIcon() {
  return (
    <Squircle from="#30d158" to="#0b7a33">
      <rect
        x="20"
        y="30"
        width="60"
        height="40"
        rx="5"
        fill="#0d2d18"
        stroke="#b6f5c8"
        strokeWidth="2.5"
      />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={27 + i * 13} y="38" width="9" height="16" rx="2" fill="#7ee2a0" />
      ))}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={24 + i * 8} y="72" width="4" height="8" rx="1" fill="#ffd60a" />
      ))}
    </Squircle>
  )
}

function SyncIcon() {
  return (
    <Squircle from="#ff9f0a" to="#c25e00">
      <path
        d="M28 40 h36 l-8 -8 M72 60 h-36 l8 8"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="40" y="44" width="20" height="14" rx="3" fill="#fff" opacity="0.95" />
      <path d="M44 44 v-4 a6 6 0 0 1 12 0 v4" fill="none" stroke="#fff" strokeWidth="3.5" />
    </Squircle>
  )
}

function DeadlockIcon() {
  return (
    <Squircle from="#ff453a" to="#9b1c14">
      <path
        d="M50 22 a28 28 0 0 1 26 18"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M78 58 a28 28 0 0 1 -44 16"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M26 62 a28 28 0 0 1 10 -34"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M70 30 l7 10 -12 2 M42 76 l-9 -2 4 -10 M30 30 l8 -3 -1 11"
        fill="#fff"
        stroke="#fff"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <rect x="40" y="44" width="20" height="16" rx="3" fill="#fff" />
    </Squircle>
  )
}

function FinderIcon() {
  return (
    <svg viewBox="0 0 100 100" className="app-icon-svg">
      <defs>
        <linearGradient id="fdl" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6ec6ff" />
          <stop offset="1" stopColor="#1e88e5" />
        </linearGradient>
        <linearGradient id="fdr" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f5f5f7" />
          <stop offset="1" stopColor="#c7c7cc" />
        </linearGradient>
        <clipPath id="fdc">
          <rect x="4" y="4" width="92" height="92" rx="22" />
        </clipPath>
      </defs>
      <g clipPath="url(#fdc)">
        <rect x="4" y="4" width="92" height="92" fill="url(#fdr)" />
        <path d="M4 4 H56 C48 30 46 50 52 70 L44 70 L48 96 H4 Z" fill="url(#fdl)" />
      </g>
      <rect
        x="4.5"
        y="4.5"
        width="91"
        height="91"
        rx="21.5"
        fill="none"
        stroke="rgba(255,255,255,0.35)"
      />
      <path d="M30 34 v8 M70 34 v8" stroke="#1c1c1e" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M28 66 q22 14 44 0"
        fill="none"
        stroke="#1c1c1e"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function DiskIcon() {
  return (
    <Squircle from="#d1d1d6" to="#8e8e93">
      <rect x="20" y="34" width="60" height="32" rx="6" fill="#636366" />
      <rect
        x="20"
        y="34"
        width="60"
        height="32"
        rx="6"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.5"
        strokeWidth="2"
      />
      <circle cx="68" cy="50" r="3.5" fill="#30d158" />
      <path d="M28 46 h26 M28 54 h20" stroke="#d1d1d6" strokeWidth="3" strokeLinecap="round" />
    </Squircle>
  )
}

function TextEditIcon() {
  return (
    <Squircle from="#ffffff" to="#d1d1d6">
      <rect x="24" y="18" width="52" height="64" rx="4" fill="#fff" stroke="#c7c7cc" />
      <path
        d="M32 32 h36 M32 42 h36 M32 52 h28 M32 62 h32"
        stroke="#8e8e93"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M62 70 l16 -16 6 6 -16 16 h-6z" fill="#ff9f0a" />
    </Squircle>
  )
}

function MusicIcon() {
  return (
    <Squircle from="#ff5e7a" to="#d2135a">
      <path
        d="M40 66 V30 l30 -6 V60"
        fill="none"
        stroke="#fff"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <circle cx="34" cy="66" r="8" fill="#fff" />
      <circle cx="64" cy="60" r="8" fill="#fff" />
    </Squircle>
  )
}

function CameraIcon() {
  return (
    <Squircle from="#3a3a3c" to="#1c1c1e">
      <rect x="20" y="34" width="60" height="38" rx="8" fill="#e5e5ea" />
      <rect x="40" y="27" width="20" height="10" rx="3" fill="#e5e5ea" />
      <circle cx="50" cy="53" r="13" fill="#1c1c1e" />
      <circle cx="50" cy="53" r="8" fill="#e8304f" />
      <circle cx="70" cy="42" r="3" fill="#ff453a" />
    </Squircle>
  )
}

function DevicesIcon() {
  return (
    <Squircle from="#64d2ff" to="#0a6fd6">
      <rect
        x="26"
        y="26"
        width="48"
        height="48"
        rx="6"
        fill="#0b3a66"
        stroke="#bfe6ff"
        strokeWidth="3"
      />
      <rect x="38" y="38" width="24" height="24" rx="3" fill="#64d2ff" />
      {[34, 44, 54, 64].map((v) => (
        <g key={v} stroke="#bfe6ff" strokeWidth="3">
          <path d={`M${v} 18 v8 M${v} 74 v8 M18 ${v} h8 M74 ${v} h8`} />
        </g>
      ))}
    </Squircle>
  )
}

function TerminalIcon() {
  return (
    <Squircle from="#2c2c2e" to="#000000">
      <path
        d="M24 38 l14 12 -14 12"
        fill="none"
        stroke="#30d158"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M46 66 h28" stroke="#30d158" strokeWidth="6" strokeLinecap="round" />
    </Squircle>
  )
}

function UsersIcon() {
  return (
    <Squircle from="#8e8e93" to="#48484a">
      <circle cx="38" cy="40" r="11" fill="#fff" />
      <path d="M18 74 a20 18 0 0 1 40 0z" fill="#fff" />
      <circle cx="66" cy="44" r="9" fill="#d1d1d6" />
      <path d="M52 74 a16 15 0 0 1 32 0z" fill="#d1d1d6" />
    </Squircle>
  )
}

function DemoIcon() {
  return (
    <Squircle from="#ffd60a" to="#ff9f0a">
      <path d="M38 28 v44 l36 -22z" fill="#fff" />
    </Squircle>
  )
}

function ConsoleIcon() {
  return (
    <Squircle from="#48484a" to="#1c1c1e">
      <path
        d="M26 36 L40 48 L26 60"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M46 62 H72" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
    </Squircle>
  )
}

/** Logo de LinarezOS: una "L" dentro de una "O". */
export function LogoIcon() {
  return (
    <Squircle from="#ff5470" to="#9b1030">
      <circle cx="50" cy="50" r="27" fill="none" stroke="#fff" strokeWidth="7" />
      <path
        d="M43 36 V62 H60"
        fill="none"
        stroke="#fff"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Squircle>
  )
}

export const APP_ICONS: Record<AppId, () => React.JSX.Element> = {
  finder: FinderIcon,
  disk: DiskIcon,
  textedit: TextEditIcon,
  terminal: TerminalIcon,
  users: UsersIcon,
  demo: DemoIcon,
  music: MusicIcon,
  camera: CameraIcon,
  devices: DevicesIcon,
  activity: ActivityIcon,
  diagram: DiagramIcon,
  memory: MemoryIcon,
  sync: SyncIcon,
  deadlock: DeadlockIcon,
  console: ConsoleIcon,
  about: LogoIcon
}

/** Glifo monocromo del sistema para la barra de menú. */
export function LogoGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
      <path
        d="M5.5 6.5 q2 -2.6 4.2 -0.7 t4.2 -0.6 t4 -0.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="12" cy="14.5" r="5.6" fill="none" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  )
}
