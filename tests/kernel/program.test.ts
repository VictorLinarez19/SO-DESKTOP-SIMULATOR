import { describe, expect, it } from 'vitest'
import { formatInstr, parseProgram, ProgramError } from '@kernel/process/program'
import { BOOT_PROGRAMS } from '@kernel/process/programs'

describe('Intérprete de programas', () => {
  it('resuelve etiquetas en la misma línea o solas', () => {
    const code = parseProgram(`
      # comentario
      inicio: CPU 2
      IO disco 3
      fin:
      LOOP inicio 4
    `)
    expect(code).toEqual([
      { op: 'CPU', ticks: 2 },
      { op: 'IO', device: 'disco', ticks: 3 },
      { op: 'LOOP', label: 'inicio', target: 0, times: 4 }
    ])
    expect(formatInstr(code[2])).toBe('LOOP inicio 4')
  })

  it.each([
    ['FOO 3', /desconocida/],
    ['CPU 0', /inválido/],
    ['IO floppy 2', /Dispositivo desconocido/],
    ['LOOP nada', /no definida/],
    ['a: CPU 1\na: CPU 1', /duplicada/],
    ['', /vacío/]
  ])('rechaza "%s"', (src, msg) => {
    expect(() => parseProgram(src)).toThrow(ProgramError)
    expect(() => parseProgram(src)).toThrow(msg)
  })

  it('los 15 programas del sistema son válidos y con PID/ids únicos', () => {
    expect(BOOT_PROGRAMS).toHaveLength(15)
    expect(new Set(BOOT_PROGRAMS.map((p) => p.id)).size).toBe(15)
    for (const p of BOOT_PROGRAMS) expect(() => parseProgram(p.source)).not.toThrow()
  })
})
