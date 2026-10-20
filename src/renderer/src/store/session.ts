import { create } from 'zustand'
import {
  ACCOUNTS_PATH,
  HOME_FOLDERS,
  defaultAccounts,
  homeOf,
  makeAccount,
  parseAccounts,
  serializeAccounts,
  validName,
  validPassword,
  verifyPassword,
  type Account
} from '@shared/accounts'
import { useKernel } from './kernel'
import { useUi } from './ui'
import { useWm } from './windows'

interface SessionState {
  accounts: Account[] | null
  user: Account | null
  /** Pausa del kernel antes de suspender el equipo (para restaurarla al despertar). */
  wasRunning: boolean
  load(): Promise<void>
  login(name: string, password: string): Promise<boolean>
  logout(): void
  lock(): void
  sleep(): void
  wake(): void
  restart(): void
  shutdown(): void
  addAccount(
    name: string,
    fullName: string,
    password: string,
    admin: boolean
  ): Promise<string | null>
  removeAccount(name: string): string | null
  setPassword(name: string, password: string): Promise<string | null>
}

const send = (cmd: Parameters<typeof window.os.command>[0]): void => void window.os.command(cmd)

function persist(accounts: Account[]): void {
  send({ type: 'fsWriteText', path: ACCOUNTS_PATH, text: serializeAccounts(accounts) })
}

function createHome(name: string): void {
  send({ type: 'fsMkdir', path: homeOf(name) })
  for (const f of HOME_FOLDERS) send({ type: 'fsMkdir', path: `${homeOf(name)}/${f}` })
}

/** Cierra todas las ventanas y deja el escritorio limpio para el siguiente usuario. */
export function resetDesktop(): void {
  const wm = useWm.getState()
  for (const w of [...wm.windows]) wm.close(w.id)
  useUi.getState().set({ spotlight: false, controlCenter: false, missionControl: false })
}

export const useSession = create<SessionState>((set, get) => ({
  accounts: null,
  user: null,
  wasRunning: true,

  async load() {
    // Las cuentas viven en disk.img: si el disco es nuevo se crean las predeterminadas.
    const file = await window.os.query({ type: 'fileInfo', path: ACCOUNTS_PATH })
    let accounts = file?.preview ? parseAccounts(file.preview) : []
    if (accounts.length === 0) {
      accounts = await defaultAccounts()
      persist(accounts)
      for (const a of accounts) createHome(a.name)
    }
    set({ accounts })
  },

  async login(name, password) {
    const account = get().accounts?.find((a) => a.name === name)
    if (!account || !(await verifyPassword(account, password))) return false
    const ui = useUi.getState()
    if (get().user?.name !== account.name) {
      ui.setFinderPath(`${homeOf(account.name)}/Documentos`)
      ui.selectFile(null)
    }
    set({ user: account })
    ui.set({ power: 'on' })
    return true
  },

  logout() {
    resetDesktop()
    set({ user: null })
    useUi.getState().set({ power: 'login' })
  },

  lock() {
    useUi
      .getState()
      .set({ power: 'locked', spotlight: false, controlCenter: false, missionControl: false })
  },

  sleep() {
    const k = useKernel.getState()
    set({ wasRunning: k.snapshot?.running ?? true })
    k.send({ type: 'pause' })
    useUi
      .getState()
      .set({ power: 'sleeping', spotlight: false, controlCenter: false, missionControl: false })
  },

  wake() {
    if (get().wasRunning) useKernel.getState().send({ type: 'resume' })
    // Al despertar siempre se pide la contraseña.
    useUi.getState().set({ power: get().user ? 'locked' : 'login' })
  },

  restart() {
    useUi
      .getState()
      .set({ power: 'restarting', spotlight: false, controlCenter: false, missionControl: false })
  },

  shutdown() {
    useUi.getState().set({
      power: 'shutting-down',
      spotlight: false,
      controlCenter: false,
      missionControl: false
    })
  },

  async addAccount(name, fullName, password, admin) {
    const bad = validName(name) ?? (password ? validPassword(password) : null)
    if (bad) return bad
    const accounts = get().accounts ?? []
    if (accounts.some((a) => a.name === name)) return `Ya existe la cuenta «${name}»`
    const next = [...accounts, await makeAccount(name, fullName || name, password, admin)]
    persist(next)
    createHome(name)
    set({ accounts: next })
    return null
  },

  removeAccount(name) {
    const { accounts, user } = get()
    if (!accounts) return 'Cuentas no cargadas'
    if (name === user?.name) return 'No puedes eliminar la cuenta con la sesión abierta'
    const target = accounts.find((a) => a.name === name)
    if (!target) return 'No existe esa cuenta'
    if (target.admin && accounts.filter((a) => a.admin).length === 1) {
      return 'Debe quedar al menos una cuenta de administrador'
    }
    const next = accounts.filter((a) => a.name !== name)
    persist(next)
    set({ accounts: next })
    return null
  },

  async setPassword(name, password) {
    const bad = password ? validPassword(password) : null
    if (bad) return bad
    const { accounts, user } = get()
    const old = accounts?.find((a) => a.name === name)
    if (!accounts || !old) return 'No existe esa cuenta'
    const fresh = await makeAccount(name, old.fullName, password, old.admin, old.hint)
    const next = accounts.map((a) => (a.name === name ? fresh : a))
    persist(next)
    set({ accounts: next, user: user?.name === name ? fresh : user })
    return null
  }
}))
