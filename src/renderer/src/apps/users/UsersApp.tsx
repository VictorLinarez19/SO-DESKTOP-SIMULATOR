import { useState } from 'react'
import { homeOf } from '@shared/accounts'
import { useSession } from '../../store/session'

/** Usuarios y contraseñas: los administradores crean y eliminan cuentas; todos cambian la suya. */
export function UsersApp(): React.JSX.Element {
  const accounts = useSession((s) => s.accounts)
  const me = useSession((s) => s.user)
  const [selected, setSelected] = useState<string | null>(me?.name ?? null)
  const [msg, setMsg] = useState<{ text: string; bad: boolean } | null>(null)
  const [pw, setPw] = useState('')
  const [form, setForm] = useState({ name: '', fullName: '', password: '', admin: false })

  const report = (error: string | null, ok: string): void =>
    setMsg(error ? { text: error, bad: true } : { text: ok, bad: false })
  const target = accounts?.find((a) => a.name === selected) ?? null
  const canEdit = !!me && !!target && (me.admin || me.name === target.name)

  return (
    <div className="users-app">
      <aside className="users-list">
        <div className="section-title">Cuentas</div>
        {accounts?.map((a) => (
          <button
            key={a.name}
            className={`user-row${a.name === selected ? ' active' : ''}`}
            onClick={() => {
              setSelected(a.name)
              setMsg(null)
            }}
          >
            <span
              className="avatar"
              style={{ background: a.color, width: 30, height: 30, fontSize: 13 }}
            >
              {a.fullName.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <b>{a.fullName}</b>
              <span className="muted small">
                {' '}
                {a.admin ? 'administrador' : 'estándar'}
                {a.name === me?.name ? ' · sesión actual' : ''}
              </span>
            </span>
          </button>
        ))}
      </aside>
      <section className="users-detail">
        {target && (
          <>
            <h2>{target.fullName}</h2>
            <dl className="pcb-grid">
              <div>
                <dt>Cuenta</dt>
                <dd>{target.name}</dd>
              </div>
              <div>
                <dt>Tipo</dt>
                <dd>{target.admin ? 'Administrador' : 'Estándar (solo escribe en su carpeta)'}</dd>
              </div>
              <div>
                <dt>Carpeta personal</dt>
                <dd>{homeOf(target.name)}</dd>
              </div>
              <div>
                <dt>Contraseña</dt>
                <dd>{target.hash ? 'protegida con sal + SHA-256' : 'sin contraseña'}</dd>
              </div>
            </dl>
            {canEdit && (
              <div className="users-row">
                <input
                  type="password"
                  placeholder="Nueva contraseña"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
                <button
                  onClick={async () => {
                    report(
                      await useSession.getState().setPassword(target.name, pw),
                      'Contraseña actualizada'
                    )
                    setPw('')
                  }}
                >
                  Cambiar contraseña
                </button>
                {me?.admin && (
                  <button
                    className="danger"
                    onClick={() =>
                      report(
                        useSession.getState().removeAccount(target.name),
                        `Cuenta «${target.name}» eliminada`
                      )
                    }
                  >
                    Eliminar cuenta
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {me?.admin ? (
          <form
            className="users-new"
            onSubmit={async (e) => {
              e.preventDefault()
              const err = await useSession
                .getState()
                .addAccount(form.name.trim(), form.fullName.trim(), form.password, form.admin)
              report(err, `Cuenta «${form.name}» creada con su carpeta personal`)
              if (!err) setForm({ name: '', fullName: '', password: '', admin: false })
            }}
          >
            <div className="section-title">Nueva cuenta</div>
            <input
              placeholder="Nombre de cuenta (ej. ana)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              placeholder="Nombre completo"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <input
              type="password"
              placeholder="Contraseña (vacía = sin contraseña)"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <label className="switch">
              <input
                type="checkbox"
                checked={form.admin}
                onChange={(e) => setForm({ ...form, admin: e.target.checked })}
              />
              <span className="switch-track" />
              <span>Administrador</span>
            </label>
            <button type="submit">Crear cuenta</button>
          </form>
        ) : (
          <p className="muted small note">Solo un administrador puede crear o eliminar cuentas.</p>
        )}
        {msg && <div className={`users-msg${msg.bad ? ' bad' : ''}`}>{msg.text}</div>}
      </section>
    </div>
  )
}
