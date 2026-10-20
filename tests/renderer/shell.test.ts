import { describe, expect, it } from 'vitest'
import { Kernel } from '@kernel/kernel'
import type { KernelCommand } from '@shared/ipc'
import { resolvePath, runCommand } from '@shared/shell'

function setup() {
  const k = new Kernel()
  for (let i = 0; i < 60; i++) k.tick()
  const sent: KernelCommand[] = []
  const ctx = (
    cwd = '/',
    user: { name: string; admin: boolean } | null | undefined = undefined
  ) => ({
    user,
    snapshot: k.snapshot(),
    send: (c: KernelCommand) => {
      sent.push(c)
      k.command(c)
    },
    query: async (q: never) => k.query(q) as never,
    cwd
  })
  return { k, sent, ctx }
}

describe('Terminal: intérprete de comandos', () => {
  it('ps lista los 15 procesos con su estado', async () => {
    const { ctx } = setup()
    const r = await runCommand('ps', ctx())
    expect(r.lines).toHaveLength(16)
    expect(r.lines.join('\n')).toMatch(/launchd/)
  })

  it('kill, nice y suspend actúan sobre el kernel', async () => {
    const { k, sent, ctx } = setup()
    await runCommand('nice 3 7', ctx())
    expect(k.process(3)!.priority).toBe(7)
    await runCommand('kill 4', ctx())
    expect(k.process(4)!.state).toBe('TERMINATED')
    expect(sent.map((c) => c.type)).toEqual(['setPriority', 'kill'])
    expect((await runCommand('kill 99', ctx())).error).toBe(true)
    expect((await runCommand('nice 3 15', ctx())).error).toBe(true)
  })

  it('ls y cat leen el disco real de guiñanFS', async () => {
    const { ctx } = setup()
    const ls = await runCommand('ls /Usuarios/juan/Documentos', ctx())
    expect(ls.lines.join('\n')).toMatch(/informe\.txt/)
    const cat = await runCommand('cat informe.txt', ctx('/Usuarios/juan/Documentos'))
    expect(cat.lines.join('\n')).toMatch(/Informe de Sistemas de Operación/)
    expect((await runCommand('cat nada.txt', ctx('/'))).error).toBe(true)
  })

  it('cd valida carpetas y resuelve rutas relativas', async () => {
    const { ctx } = setup()
    expect((await runCommand('cd /Usuarios/juan', ctx())).cwd).toBe('/Usuarios/juan')
    expect((await runCommand('cd ../..', ctx('/Usuarios/juan'))).cwd).toBe('/')
    expect((await runCommand('cd /nada', ctx())).error).toBe(true)
    expect(resolvePath('/a/b', '../c/./d')).toBe('/a/c/d')
  })

  it('mkdir/rm, sched, fit, disk y deadlock cambian la configuración', async () => {
    const { k, ctx } = setup()
    await runCommand('mkdir /prueba', ctx())
    expect(k.fs.exists('/prueba')).toBe(true)
    await runCommand('rmdir /prueba', ctx())
    expect(k.fs.exists('/prueba')).toBe(false)
    await runCommand('sched rr', ctx())
    await runCommand('fit best', ctx())
    await runCommand('disk clook', ctx())
    await runCommand('deadlock avoid', ctx())
    await runCommand('aging on', ctx())
    const s = k.snapshot()
    expect(s.config).toMatchObject({ policy: 'RR', aging: true })
    expect(s.memory.policy).toBe('BEST')
    expect(s.disk.arm.policy).toBe('CLOOK')
    expect(s.resources.policy).toBe('AVOID')
  })

  it('mem, sync, res, lsdev, df y top producen salida', async () => {
    const { ctx } = setup()
    for (const c of [
      'mem',
      'sync',
      'res',
      'lsdev',
      'df',
      'top',
      'disk',
      'deadlock',
      'info 1',
      'uptime',
      'help'
    ]) {
      const r = await runCommand(c, ctx())
      expect(r.error, c).toBeFalsy()
      expect(r.lines.length, c).toBeGreaterThan(0)
    }
  })

  it('comando desconocido da error', async () => {
    const { ctx } = setup()
    expect((await runCommand('foobar', ctx())).error).toBe(true)
  })

  it('exit pide cerrar la Terminal y las demás acciones de sesión', async () => {
    const { ctx } = setup()
    expect(await runCommand('exit', ctx())).toMatchObject({ action: 'exit', lines: [] })
    for (const c of ['logout', 'lock', 'sleep', 'reboot', 'shutdown']) {
      expect((await runCommand(c, ctx())).action, c).toBe(c)
    }
  })

  it('rmdir solo borra carpetas vacías', async () => {
    const { k, ctx } = setup()
    await runCommand('mkdir /vacia', ctx())
    await runCommand('mkdir /llena', ctx())
    await runCommand('mkdir /llena/dentro', ctx())
    expect((await runCommand('rmdir /llena', ctx())).error).toBe(true)
    expect((await runCommand('rmdir /Usuarios/juan/Documentos/notas.txt', ctx())).lines[0]).toMatch(
      /no es una carpeta/
    )
    expect((await runCommand('rm /vacia', ctx())).lines[0]).toMatch(/usa rmdir/)
    expect((await runCommand('rmdir /vacia', ctx())).error).toBeFalsy()
    expect(k.fs.exists('/vacia')).toBe(false)
    expect((await runCommand('rmdir /noexiste', ctx())).error).toBe(true)
  })

  it('un usuario estándar no puede modificar fuera de su carpeta', async () => {
    const { k, ctx } = setup()
    const ana = { name: 'ana', admin: false }
    expect((await runCommand('mkdir /Usuarios/ana', ctx('/', ana))).error).toBeFalsy()
    expect((await runCommand('mkdir /Sistema/hack', ctx('/', ana))).lines[0]).toMatch(
      /permiso denegado/
    )
    expect((await runCommand('rm /Usuarios/juan/Documentos/notas.txt', ctx('/', ana))).error).toBe(
      true
    )
    expect(k.fs.exists('/Usuarios/juan/Documentos/notas.txt')).toBe(true)
    const admin = { name: 'juan', admin: true }
    expect((await runCommand('mkdir /Sistema/prueba', ctx('/', admin))).error).toBeFalsy()
    expect((await runCommand('whoami', ctx('/', admin))).lines[0]).toMatch(/juan \(administrador\)/)
  })
})
