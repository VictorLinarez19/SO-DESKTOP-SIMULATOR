import { describe, expect, it } from 'vitest'
import {
  canWrite,
  defaultAccounts,
  hashPassword,
  makeAccount,
  parseAccounts,
  serializeAccounts,
  validName,
  validPassword,
  verifyPassword
} from '@shared/accounts'

describe('Cuentas de usuario', () => {
  it('la contraseña se guarda con sal + hash y se verifica', async () => {
    const a = await makeAccount('ana', 'Ana', 'secreta', false)
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hash).not.toContain('secreta')
    expect(await verifyPassword(a, 'secreta')).toBe(true)
    expect(await verifyPassword(a, 'otra')).toBe(false)
    const b = await makeAccount('ana', 'Ana', 'secreta', false)
    expect(b.salt).not.toBe(a.salt) // la sal cambia el hash
    expect(b.hash).not.toBe(a.hash)
  })

  it('el invitado entra sin contraseña', async () => {
    const [, guest] = await defaultAccounts()
    expect(guest).toMatchObject({ name: 'invitado', admin: false, hash: '' })
    expect(await verifyPassword(guest, '')).toBe(true)
  })

  it('serializa y vuelve a leer las cuentas, sin guardar texto claro', async () => {
    const accounts = await defaultAccounts()
    const text = serializeAccounts(accounts)
    expect(text).not.toContain('|victor|')
    expect(parseAccounts(text)).toEqual(accounts)
  })

  it('valida nombres y contraseñas', () => {
    expect(validName('victor')).toBeNull()
    expect(validName('Victor')).not.toBeNull()
    expect(validName('a')).not.toBeNull()
    expect(validName('../etc')).not.toBeNull()
    expect(validPassword('abc')).not.toBeNull()
    expect(validPassword('abcd')).toBeNull()
  })

  it('un usuario sin privilegios solo escribe en su carpeta personal', () => {
    const user = { name: 'ana', admin: false }
    expect(canWrite(user, '/Usuarios/ana/Documentos/x.txt')).toBe(true)
    expect(canWrite(user, '/Usuarios/ana')).toBe(true)
    expect(canWrite(user, '/Usuarios/anabel/x')).toBe(false)
    expect(canWrite(user, '/Sistema/kernel.img')).toBe(false)
    expect(canWrite({ name: 'victor', admin: true }, '/Sistema/kernel.img')).toBe(true)
    expect(canWrite(null, '/')).toBe(false)
  })

  it('hash estable para la misma sal y contraseña', async () => {
    expect(await hashPassword('x', 's')).toBe(await hashPassword('x', 's'))
  })
})
