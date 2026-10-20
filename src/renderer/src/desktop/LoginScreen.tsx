import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Account } from '@shared/accounts'
import { useUi } from '../store/ui'
import { useSession } from '../store/session'

const timeFmt = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })

function Avatar({ a, size = 84 }: { a: Account; size?: number }): React.JSX.Element {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: a.color }}
      aria-hidden
    >
      {a.fullName.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** Inicio de sesión y pantalla bloqueada: el sistema nunca entra solo al escritorio. */
export function LoginScreen(): React.JSX.Element {
  const power = useUi((s) => s.power)
  const wallpaper = useUi((s) => s.wallpaper)
  const accounts = useSession((s) => s.accounts)
  const current = useSession((s) => s.user)
  const locked = power === 'locked' && current !== null
  const [picked, setPicked] = useState<string | null>(locked ? current.name : null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!picked) return
    field.current?.focus()
    // Refuerzo: algunos clics (p. ej. el que despierta el equipo) quitan el foco justo después.
    const t = setTimeout(() => field.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [picked])

  const account = accounts?.find((a) => a.name === picked) ?? null

  const submit = async (name: string, pw: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    const ok = await useSession.getState().login(name, pw)
    setBusy(false)
    if (!ok) {
      setError(true)
      setPassword('')
      setTimeout(() => setError(false), 600)
    }
  }

  const choose = (a: Account): void => {
    if (!a.hash) void submit(a.name, '')
    else {
      setPicked(a.name)
      setPassword('')
    }
  }

  const visible = locked
    ? (accounts ?? []).filter((a) => a.name === current.name)
    : (accounts ?? [])

  return (
    <motion.div
      className="login-screen"
      data-wallpaper={wallpaper}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
    >
      <div className="login-wallpaper" />
      <div className="login-clock">
        <div className="login-time">{timeFmt.format(now)}</div>
        <div className="login-date">{dateFmt.format(now)}</div>
      </div>

      <div className="login-center">
        {!account ? (
          <>
            <div className="login-users">
              {visible.map((a) => (
                <button key={a.name} className="login-user" onClick={() => choose(a)}>
                  <Avatar a={a} />
                  <span>{a.fullName}</span>
                  <span className="muted small">
                    {a.admin ? 'Administrador' : a.hash ? 'Estándar' : 'Sin contraseña'}
                  </span>
                </button>
              ))}
              {accounts === null && <span className="muted">Leyendo cuentas de disk.img…</span>}
            </div>
            <div className="login-hint">Elige una cuenta para iniciar sesión</div>
          </>
        ) : (
          <motion.form
            className="login-form"
            animate={error ? { x: [0, -12, 12, -8, 8, 0] } : { x: 0 }}
            transition={{ duration: 0.4 }}
            onSubmit={(e) => {
              e.preventDefault()
              void submit(account.name, password)
            }}
          >
            <Avatar a={account} size={110} />
            <div className="login-name">{account.fullName}</div>
            <div className="login-field">
              <input
                ref={field}
                type="password"
                value={password}
                placeholder="Contraseña"
                autoComplete="off"
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Contraseña"
              />
              <button type="submit" disabled={busy} aria-label="Entrar">
                →
              </button>
            </div>
            {error && <div className="login-error">Contraseña incorrecta</div>}
            {!error && account.hint && <div className="login-hint">Pista: {account.hint}</div>}
            <button
              type="button"
              className="login-link"
              onClick={() => {
                if (locked) useSession.getState().logout()
                setPicked(null)
              }}
            >
              {locked ? 'Cambiar de usuario (cierra la sesión)' : 'Elegir otra cuenta'}
            </button>
          </motion.form>
        )}
      </div>

      <div className="login-power">
        {[
          ['Suspender', () => useSession.getState().sleep()],
          ['Reiniciar', () => useSession.getState().restart()],
          ['Apagar', () => useSession.getState().shutdown()]
        ].map(([label, run]) => (
          <button key={label as string} onClick={run as () => void}>
            {label as string}
          </button>
        ))}
      </div>
    </motion.div>
  )
}
