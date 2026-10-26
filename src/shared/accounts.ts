// Cuentas de usuario de LinarezOS. Se guardan en /Sistema/cuentas.txt dentro de disk.img,
// con la contraseña protegida por sal + SHA-256 (nunca en texto claro).

export const ACCOUNTS_PATH = '/Sistema/cuentas.txt'

export interface Account {
  /** Nombre corto: también es la carpeta personal /Usuarios/<nombre>. */
  name: string
  fullName: string
  admin: boolean
  /** Color del avatar. */
  color: string
  /** Vacíos = cuenta sin contraseña (invitado). */
  salt: string
  hash: string
  /** Pista que se muestra en la pantalla de inicio. */
  hint: string
}

const COLORS = ['#ff6a3d', '#0a84ff', '#30d158', '#bf5af2', '#ff9f0a', '#ff375f', '#64d2ff']

export function colorFor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}

export function homeOf(name: string): string {
  return `/Usuarios/${name}`
}

/** Nombre de cuenta válido: letras minúsculas, dígitos, guion y guion bajo. */
export function validName(name: string): string | null {
  if (!/^[a-z][a-z0-9_-]{1,19}$/.test(name)) {
    return 'El nombre debe empezar con una letra minúscula y tener de 2 a 20 letras, números, - o _'
  }
  return null
}

export function validPassword(pw: string): string | null {
  return pw.length >= 4 ? null : 'La contraseña debe tener al menos 4 caracteres'
}

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(8)).buffer as ArrayBuffer)
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`)
  return toHex(await crypto.subtle.digest('SHA-256', data))
}

export async function makeAccount(
  name: string,
  fullName: string,
  password: string,
  admin: boolean,
  hint = ''
): Promise<Account> {
  const salt = password ? newSalt() : ''
  return {
    name,
    fullName,
    admin,
    color: colorFor(name),
    salt,
    hash: password ? await hashPassword(password, salt) : '',
    hint
  }
}

export async function verifyPassword(account: Account, password: string): Promise<boolean> {
  if (!account.hash) return true
  return (await hashPassword(password, account.salt)) === account.hash
}

/** Cuentas con las que arranca un disco nuevo. */
export async function defaultAccounts(): Promise<Account[]> {
  return [
    await makeAccount('victor', 'Victor', 'victor', true, 'Tu nombre de usuario'),
    await makeAccount('invitado', 'Invitado', '', false)
  ]
}

/** Una cuenta por línea: nombre|nombre completo|admin|color|sal|hash|pista. */
export function serializeAccounts(accounts: Account[]): string {
  const clean = (s: string): string => s.replace(/[|\n]/g, ' ')
  return (
    '# Cuentas de LinarezOS (contraseñas con sal + SHA-256)\n' +
    accounts
      .map((a) =>
        [
          a.name,
          clean(a.fullName),
          a.admin ? '1' : '0',
          a.color,
          a.salt,
          a.hash,
          clean(a.hint)
        ].join('|')
      )
      .join('\n') +
    '\n'
  )
}

export function parseAccounts(text: string): Account[] {
  const out: Account[] = []
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue
    const [name, fullName, admin, color, salt, hash, hint] = line.split('|')
    if (!name || validName(name)) continue
    out.push({
      name,
      fullName: fullName || name,
      admin: admin === '1',
      color: color || colorFor(name),
      salt: salt ?? '',
      hash: hash ?? '',
      hint: hint ?? ''
    })
  }
  return out
}

/** Una carpeta del disco pertenece al usuario si está dentro de su carpeta personal. */
export function canWrite(user: Pick<Account, 'name' | 'admin'> | null, path: string): boolean {
  if (!user) return false
  if (user.admin) return true
  const home = homeOf(user.name)
  return path === home || path.startsWith(home + '/')
}

/** Subcarpetas que se crean con cada cuenta. */
export const HOME_FOLDERS = ['Documentos', 'Descargas', 'Imágenes', 'Música']
