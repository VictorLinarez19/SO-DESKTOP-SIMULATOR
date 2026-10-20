import { describe, expect, it } from 'vitest'
import { MemoryBlockDevice } from '@kernel/disk/blockDevice'
import { GuinanFS } from '@kernel/disk/fs'
import { seedFileSystem } from '@kernel/disk/seed'

const enc = new TextEncoder()
const dec = new TextDecoder()

describe('guiñanFS', () => {
  it('escribe y lee datos reales con asignación indexada', () => {
    const dev = new MemoryBlockDevice(1024)
    const fs = GuinanFS.format(dev, 1)
    const data = enc.encode('hola '.repeat(2000)) // ~10 KB → 3 bloques
    fs.writeFile('/docs/a.txt', data, 2)
    const st = fs.stat('/docs/a.txt')!
    expect(st).toMatchObject({ type: 'file', size: data.length, blockCount: 3 })
    expect(st.indexBlock).toBeGreaterThan(0)
    expect(dec.decode(fs.readFile('/docs/a.txt').bytes)).toBe('hola '.repeat(2000))
    // El bloque índice contiene la lista de bloques de datos.
    const idx = new DataView(dev.read(st.indexBlock).buffer)
    expect([0, 1, 2].map((i) => idx.getUint32(i * 4, true))).toEqual(
      fs.blocksOf('/docs/a.txt')!.blocks
    )
  })

  it('persiste: al volver a montar el disco se recupera todo', () => {
    const dev = new MemoryBlockDevice(1024)
    const fs = GuinanFS.format(dev, 1)
    fs.writeFile('/Usuarios/juan/nota.txt', enc.encode('persistente'), 5)
    fs.mkdir('/vacio', 5)
    const again = GuinanFS.mount(dev)!
    expect(again).not.toBeNull()
    expect(again.mountCount).toBe(1)
    expect(dec.decode(again.readFile('/Usuarios/juan/nota.txt').bytes)).toBe('persistente')
    expect(
      again
        .list('/')
        .map((e) => e.name)
        .sort()
    ).toEqual(['Usuarios', 'vacio'])
    expect(again.bitmapHex()).toBe(fs.bitmapHex())
  })

  it('un disco sin formato no se monta', () => {
    expect(GuinanFS.mount(new MemoryBlockDevice(1024))).toBeNull()
  })

  it('borrar libera los bloques en el mapa de bits', () => {
    const fs = GuinanFS.format(new MemoryBlockDevice(1024), 1)
    const before = fs.usage().usedBlocks
    fs.writeFile('/x.bin', { size: 40 * 1024 }, 1)
    expect(fs.usage().usedBlocks).toBeGreaterThanOrEqual(before + 11) // 10 datos + 1 índice
    fs.remove('/x.bin', 1)
    expect(fs.usage().usedBlocks).toBe(before)
    expect(fs.exists('/x.bin')).toBe(false)
  })

  it('si no hay un tramo contiguo, el archivo queda disperso (y se puede leer)', () => {
    const fs = GuinanFS.format(new MemoryBlockDevice(256), 1)
    for (let i = 0; i < 10; i++) fs.writeFile(`/f${i}`, { size: 4096 * 3 }, 1)
    // Se ocupa el resto del disco para que solo queden los huecos que se abren a continuación.
    fs.writeFile('/relleno', { size: 4096 * (fs.usage().freeBlocks - 4) }, 1)
    for (let i = 0; i < 10; i += 2) fs.remove(`/f${i}`, 1)
    const data = enc.encode('z'.repeat(4096 * 6))
    fs.writeFile('/disperso', data, 1)
    expect(fs.stat('/disperso')!.fragments).toBeGreaterThan(1)
    expect(fs.readFile('/disperso').bytes).toEqual(data)
  })

  it('no permite borrar un directorio con contenido', () => {
    const fs = GuinanFS.format(new MemoryBlockDevice(256), 1)
    fs.writeFile('/d/a', enc.encode('a'), 1)
    expect(() => fs.remove('/d', 1)).toThrow(/no está vacío/)
  })

  it('el contenido inicial reparte los archivos por el disco y deja huecos', () => {
    const fs = GuinanFS.format(new MemoryBlockDevice(), 1)
    seedFileSystem(fs, 1)
    const notas = fs.stat('/Usuarios/juan/Documentos/notas.txt')!
    const ovl = fs.stat('/Sistema/compilador/lexico.ovl')!
    expect(notas.size).toBe(8 * 1024)
    expect(Math.abs(notas.firstBlock! - ovl.firstBlock!)).toBeGreaterThan(200)
    expect(fs.exists('/.relleno')).toBe(false)
    expect(fs.usage().freeBlocks).toBeGreaterThan(2000)
  })

  it('el área de intercambio guarda imágenes reales de procesos', () => {
    const fs = GuinanFS.format(new MemoryBlockDevice(), 1)
    const blocks = fs.swapOut(7, new Uint8Array(64 * 1024).fill(7))!
    expect(blocks).toHaveLength(16)
    expect(blocks.every((b) => b >= fs.swapStart)).toBe(true)
    expect(fs.usage().swapUsed).toBe(16)
    expect(fs.swapIn(7).blocks).toEqual(blocks)
    expect(fs.usage().swapUsed).toBe(0)
  })
})
