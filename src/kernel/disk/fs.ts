import type { BlockDevice } from './blockDevice'

/**
 * LinarezFS: sistema de archivos con asignación indexada.
 *
 * Distribución del disco:
 *   bloque 0                superbloque
 *   bloque 1                mapa de bits de bloques libres/ocupados
 *   bloques 2–9             tabla de i-nodos (256 × 128 B)
 *   bloques 16 … swapStart  datos (archivos, directorios y bloques índice)
 *   último octavo (≤ 4 MB)  área de intercambio (swap), no persistente
 *
 * Cada archivo tiene un bloque índice con la lista de sus bloques de datos.
 * Un directorio es un archivo cuyo contenido son entradas de 64 B (i-nodo + nombre).
 */

const MAGIC = 'LINAR-FS'
const VERSION = 1
const INODE_SIZE = 128
const INODE_COUNT = 256
const DIRENT_SIZE = 64
const NAME_MAX = 59
const ROOT = 0
/** Área de intercambio: un octavo del disco, hasta 1024 bloques (4 MB). */
const swapSize = (blocks: number): number => Math.min(1024, Math.floor(blocks / 8))
const DATA_START = 16

export type FileType = 'file' | 'dir'

interface Inode {
  used: boolean
  type: FileType
  size: number
  indexBlock: number
  ctime: number
  mtime: number
  blocks: number[]
  parent: number
}

export interface FsEntry {
  path: string
  name: string
  type: FileType
  size: number
  inode: number
  parent: number
  indexBlock: number
  /** Bloques de datos (sin contar el bloque índice). */
  blockCount: number
  firstBlock: number | null
  /** Tramos contiguos: 1 = archivo contiguo; más = archivo disperso en el disco. */
  fragments: number
  mtime: number
}

export interface FsUsage {
  dataBlocks: number
  usedBlocks: number
  freeBlocks: number
  swapBlocks: number
  swapUsed: number
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export class FsError extends Error {}

export class LinarezFS {
  readonly blockSize: number
  readonly blockCount: number
  readonly dataStart = DATA_START
  readonly swapStart: number
  private bitmap: Uint8Array
  private inodes: Inode[] = []
  private dirs = new Map<number, Map<string, number>>()
  private readonly swapOwner = new Map<number, number>() // bloque → pid
  formattedAt = 0
  mountCount = 0

  private constructor(private readonly dev: BlockDevice) {
    this.blockSize = dev.blockSize
    this.blockCount = dev.blockCount
    this.swapStart = dev.blockCount - swapSize(dev.blockCount)
    this.bitmap = new Uint8Array(Math.ceil(dev.blockCount / 8))
  }

  get devicePath(): string | null {
    return this.dev.path
  }

  // ───────────────────────── formato y montaje ─────────────────────────

  static format(dev: BlockDevice, now = Math.floor(Date.now() / 1000)): LinarezFS {
    const fs = new LinarezFS(dev)
    fs.formattedAt = now
    for (let b = 0; b < DATA_START; b++) fs.setUsed(b, true)
    for (let i = 0; i < INODE_COUNT; i++) {
      fs.inodes.push({
        used: false,
        type: 'file',
        size: 0,
        indexBlock: 0,
        ctime: 0,
        mtime: 0,
        blocks: [],
        parent: 0
      })
    }
    fs.inodes[ROOT] = {
      used: true,
      type: 'dir',
      size: 0,
      indexBlock: 0,
      ctime: now,
      mtime: now,
      blocks: [],
      parent: ROOT
    }
    fs.dirs.set(ROOT, new Map())
    for (let i = 0; i < INODE_COUNT; i++) fs.writeInode(i)
    fs.writeBitmap()
    fs.writeSuper()
    return fs
  }

  /** Monta el sistema de archivos si el disco ya tiene uno; si no, devuelve null. */
  static mount(dev: BlockDevice): LinarezFS | null {
    const sb = dev.read(0)
    if (dec.decode(sb.subarray(0, 8)) !== MAGIC) return null
    const v = new DataView(sb.buffer, sb.byteOffset)
    if (v.getUint32(8, true) !== VERSION || v.getUint32(12, true) !== dev.blockCount) return null
    const fs = new LinarezFS(dev)
    fs.formattedAt = v.getUint32(16, true)
    fs.mountCount = v.getUint32(20, true) + 1
    fs.bitmap = dev.read(1).slice(0, fs.bitmap.length)
    for (let i = 0; i < INODE_COUNT; i++) fs.inodes.push(fs.readInode(i))
    for (let i = 0; i < INODE_COUNT; i++) {
      if (fs.inodes[i].used && fs.inodes[i].type === 'dir') fs.dirs.set(i, fs.readDir(i))
    }
    // El área de intercambio no se conserva entre arranques.
    for (let b = fs.swapStart; b < fs.blockCount; b++) fs.setUsed(b, false)
    fs.writeBitmap()
    fs.writeSuper()
    return fs
  }

  // ───────────────────────── operaciones con rutas ─────────────────────────

  lookup(path: string): number | null {
    let ino = ROOT
    for (const part of split(path)) {
      const dir = this.dirs.get(ino)
      const next = dir?.get(part)
      if (next === undefined) return null
      ino = next
    }
    return ino
  }

  exists(path: string): boolean {
    return this.lookup(path) !== null
  }

  mkdir(path: string, now: number): number {
    const existing = this.lookup(path)
    if (existing !== null) {
      if (this.inodes[existing].type !== 'dir')
        throw new FsError(`${path} ya existe y no es un directorio`)
      return existing
    }
    const { parent, name } = this.parentOf(path, now)
    const ino = this.allocInode('dir', parent, now)
    this.dirs.set(ino, new Map())
    this.addEntry(parent, name, ino, now)
    this.writeInode(ino)
    return ino
  }

  /** Escribe (sobrescribe) un archivo completo. Devuelve los bloques tocados. */
  writeFile(path: string, data: Uint8Array | { size: number }, now: number): number[] {
    let ino = this.lookup(path)
    if (ino !== null && this.inodes[ino].type === 'dir')
      throw new FsError(`${path} es un directorio`)
    if (ino === null) {
      const { parent, name } = this.parentOf(path, now)
      ino = this.allocInode('file', parent, now)
      this.addEntry(parent, name, ino, now)
    }
    const size = data instanceof Uint8Array ? data.length : data.size
    this.setContent(ino, size, data instanceof Uint8Array ? data : null, now)
    return this.touchedBlocks(ino)
  }

  /** Lee hasta `maxBytes` del archivo (datos reales del disco). */
  readFile(path: string, maxBytes = Infinity): { bytes: Uint8Array; blocks: number[] } {
    const ino = this.lookup(path)
    if (ino === null) throw new FsError(`No existe ${path}`)
    const node = this.inodes[ino]
    const size = Math.min(node.size, maxBytes)
    const count = Math.ceil(size / this.blockSize)
    const bytes = new Uint8Array(size)
    for (let i = 0; i < count; i++) {
      const block = this.dev.read(node.blocks[i])
      bytes.set(
        block.subarray(0, Math.min(this.blockSize, size - i * this.blockSize)),
        i * this.blockSize
      )
    }
    return {
      bytes,
      blocks: [...(node.indexBlock ? [node.indexBlock] : []), ...node.blocks.slice(0, count)]
    }
  }

  remove(path: string, now: number): void {
    const ino = this.lookup(path)
    if (ino === null) throw new FsError(`No existe ${path}`)
    if (ino === ROOT) throw new FsError('No se puede borrar la raíz')
    const node = this.inodes[ino]
    if (node.type === 'dir' && (this.dirs.get(ino)?.size ?? 0) > 0) {
      throw new FsError(`${path} no está vacío`)
    }
    this.freeBlocks(node)
    this.removeEntry(node.parent, basename(path), now)
    this.dirs.delete(ino)
    this.inodes[ino] = { ...node, used: false, size: 0, blocks: [], indexBlock: 0 }
    this.writeInode(ino)
    this.writeBitmap()
  }

  list(path: string): FsEntry[] {
    const ino = this.lookup(path)
    if (ino === null || this.inodes[ino].type !== 'dir')
      throw new FsError(`${path} no es un directorio`)
    const base = path === '/' ? '' : normalize(path)
    return [...this.dirs.get(ino)!].map(([name, child]) =>
      this.entry(`${base}/${name}`, name, child)
    )
  }

  /** Todo el árbol, en orden de recorrido. */
  tree(): FsEntry[] {
    const out: FsEntry[] = [this.entry('/', '/', ROOT)]
    const walk = (ino: number, prefix: string): void => {
      const children = [...this.dirs.get(ino)!].sort(([a], [b]) => a.localeCompare(b))
      for (const [name, child] of children) {
        const path = `${prefix}/${name}`
        out.push(this.entry(path, name, child))
        if (this.inodes[child].type === 'dir') walk(child, path)
      }
    }
    walk(ROOT, '')
    return out
  }

  /** Archivos regulares (para el escaneo del antivirus). */
  files(): FsEntry[] {
    return this.tree().filter((e) => e.type === 'file')
  }

  stat(path: string): FsEntry | null {
    const ino = this.lookup(path)
    return ino === null ? null : this.entry(normalize(path), basename(path) || '/', ino)
  }

  blocksOf(path: string): { indexBlock: number; blocks: number[] } | null {
    const ino = this.lookup(path)
    if (ino === null) return null
    return { indexBlock: this.inodes[ino].indexBlock, blocks: [...this.inodes[ino].blocks] }
  }

  usage(): FsUsage {
    let used = 0
    for (let b = this.dataStart; b < this.swapStart; b++) if (this.isUsed(b)) used++
    const dataBlocks = this.swapStart - this.dataStart
    return {
      dataBlocks,
      usedBlocks: used,
      freeBlocks: dataBlocks - used,
      swapBlocks: this.blockCount - this.swapStart,
      swapUsed: this.swapOwner.size
    }
  }

  /** Mapa de bits en hexadecimal (bit = bloque ocupado), para la interfaz. */
  bitmapHex(): string {
    return Array.from(this.bitmap, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  // ───────────────────────── área de intercambio ─────────────────────────

  /** Reserva bloques del área de intercambio para la imagen de un proceso y la escribe. */
  swapOut(pid: number, bytes: Uint8Array): number[] | null {
    this.swapFree(pid)
    const need = Math.max(1, Math.ceil(bytes.length / this.blockSize))
    const blocks: number[] = []
    for (let b = this.swapStart; b < this.blockCount && blocks.length < need; b++) {
      if (!this.swapOwner.has(b)) blocks.push(b)
    }
    if (blocks.length < need) return null
    blocks.forEach((b, i) => {
      this.swapOwner.set(b, pid)
      this.setUsed(b, true)
      this.dev.write(b, bytes.subarray(i * this.blockSize, (i + 1) * this.blockSize))
    })
    return blocks
  }

  swapBlocks(pid: number): number[] {
    return [...this.swapOwner].filter(([, p]) => p === pid).map(([b]) => b)
  }

  /** Lee de vuelta la imagen del proceso (bytes reales) y libera sus bloques. */
  swapIn(pid: number): { blocks: number[]; bytes: number } {
    const blocks = this.swapBlocks(pid)
    let bytes = 0
    for (const b of blocks) bytes += this.dev.read(b).length
    this.swapFree(pid)
    return { blocks, bytes }
  }

  swapFree(pid: number): void {
    for (const b of this.swapBlocks(pid)) {
      this.swapOwner.delete(b)
      this.setUsed(b, false)
    }
  }

  // ───────────────────────── internos ─────────────────────────

  private entry(path: string, name: string, ino: number): FsEntry {
    const n = this.inodes[ino]
    return {
      path,
      name,
      type: n.type,
      size: n.size,
      inode: ino,
      parent: n.parent,
      indexBlock: n.indexBlock,
      blockCount: n.blocks.length,
      firstBlock: n.blocks[0] ?? null,
      fragments: countRuns(n.blocks),
      mtime: n.mtime
    }
  }

  private parentOf(path: string, now: number): { parent: number; name: string } {
    const parts = split(path)
    const name = parts.pop()
    if (!name) throw new FsError('Ruta vacía')
    if (enc.encode(name).length > NAME_MAX) throw new FsError(`Nombre demasiado largo: ${name}`)
    let parent = ROOT
    parts.forEach((p, i) => {
      const next = this.dirs.get(parent)?.get(p)
      parent = next ?? this.mkdir('/' + parts.slice(0, i + 1).join('/'), now)
      if (this.inodes[parent].type !== 'dir') throw new FsError(`${p} no es un directorio`)
    })
    return { parent, name }
  }

  private allocInode(type: FileType, parent: number, now: number): number {
    const ino = this.inodes.findIndex((n) => !n.used)
    if (ino < 0) throw new FsError('No quedan i-nodos libres')
    this.inodes[ino] = {
      used: true,
      type,
      size: 0,
      indexBlock: 0,
      ctime: now,
      mtime: now,
      blocks: [],
      parent
    }
    return ino
  }

  private addEntry(dir: number, name: string, ino: number, now: number): void {
    this.dirs.get(dir)!.set(name, ino)
    this.writeDir(dir, now)
  }

  private removeEntry(dir: number, name: string, now: number): void {
    this.dirs.get(dir)!.delete(name)
    this.writeDir(dir, now)
  }

  private writeDir(dir: number, now: number): void {
    const entries = [...this.dirs.get(dir)!]
    const data = new Uint8Array(entries.length * DIRENT_SIZE)
    const v = new DataView(data.buffer)
    entries.forEach(([name, ino], i) => {
      const nb = enc.encode(name)
      v.setUint32(i * DIRENT_SIZE, ino + 1, true)
      v.setUint8(i * DIRENT_SIZE + 4, nb.length)
      data.set(nb, i * DIRENT_SIZE + 5)
    })
    this.setContent(dir, data.length, data, now)
  }

  private readDir(dir: number): Map<string, number> {
    const node = this.inodes[dir]
    const map = new Map<string, number>()
    const data = new Uint8Array(node.blocks.length * this.blockSize)
    node.blocks.forEach((b, i) => data.set(this.dev.read(b), i * this.blockSize))
    const v = new DataView(data.buffer)
    for (let off = 0; off + DIRENT_SIZE <= node.size; off += DIRENT_SIZE) {
      const ino = v.getUint32(off, true)
      if (ino === 0) continue
      const len = v.getUint8(off + 4)
      map.set(dec.decode(data.subarray(off + 5, off + 5 + len)), ino - 1)
    }
    return map
  }

  /** Reemplaza el contenido de un i-nodo: libera sus bloques y asigna los nuevos. */
  private setContent(ino: number, size: number, data: Uint8Array | null, now: number): void {
    const node = this.inodes[ino]
    this.freeBlocks(node)
    const count = Math.ceil(size / this.blockSize)
    if (count > this.blockSize / 4)
      throw new FsError('Archivo demasiado grande para un bloque índice')
    if (count > 0) {
      const all = this.allocBlocks(count + 1)
      node.indexBlock = all[0]
      node.blocks = all.slice(1)
      const index = new Uint8Array(this.blockSize)
      const iv = new DataView(index.buffer)
      node.blocks.forEach((b, i) => iv.setUint32(i * 4, b, true))
      this.dev.write(node.indexBlock, index)
      if (data) {
        node.blocks.forEach((b, i) =>
          this.dev.write(b, data.subarray(i * this.blockSize, (i + 1) * this.blockSize))
        )
      }
    }
    node.size = size
    node.mtime = now
    this.writeInode(ino)
    this.writeBitmap()
  }

  /** Bloques que se escribieron: el índice y los de datos. */
  private touchedBlocks(ino: number): number[] {
    const n = this.inodes[ino]
    return [...(n.indexBlock ? [n.indexBlock] : []), ...n.blocks]
  }

  private freeBlocks(node: Inode): void {
    for (const b of node.blocks) this.setUsed(b, false)
    if (node.indexBlock) this.setUsed(node.indexBlock, false)
    node.blocks = []
    node.indexBlock = 0
  }

  /** Primer tramo contiguo que alcance; si no hay, los primeros bloques libres (archivo disperso). */
  private allocBlocks(count: number): number[] {
    let runStart = -1
    for (let b = this.dataStart; b < this.swapStart; b++) {
      if (this.isUsed(b)) {
        runStart = -1
        continue
      }
      if (runStart < 0) runStart = b
      if (b - runStart + 1 === count) {
        const run = Array.from({ length: count }, (_, i) => runStart + i)
        run.forEach((x) => this.setUsed(x, true))
        return run
      }
    }
    const scattered: number[] = []
    for (let b = this.dataStart; b < this.swapStart && scattered.length < count; b++) {
      if (!this.isUsed(b)) scattered.push(b)
    }
    if (scattered.length < count) throw new FsError('Disco lleno')
    scattered.forEach((x) => this.setUsed(x, true))
    return scattered
  }

  isUsed(b: number): boolean {
    return (this.bitmap[b >> 3] & (1 << (b & 7))) !== 0
  }

  private setUsed(b: number, used: boolean): void {
    if (used) this.bitmap[b >> 3] |= 1 << (b & 7)
    else this.bitmap[b >> 3] &= ~(1 << (b & 7))
  }

  private writeBitmap(): void {
    this.dev.write(1, this.bitmap)
  }

  private writeSuper(): void {
    const sb = new Uint8Array(this.blockSize)
    sb.set(enc.encode(MAGIC))
    const v = new DataView(sb.buffer)
    v.setUint32(8, VERSION, true)
    v.setUint32(12, this.blockCount, true)
    v.setUint32(16, this.formattedAt, true)
    v.setUint32(20, this.mountCount, true)
    v.setUint32(24, INODE_COUNT, true)
    v.setUint32(28, this.dataStart, true)
    v.setUint32(32, this.swapStart, true)
    this.dev.write(0, sb)
  }

  private inodeLocation(ino: number): { block: number; offset: number } {
    const perBlock = this.blockSize / INODE_SIZE
    return { block: 2 + Math.floor(ino / perBlock), offset: (ino % perBlock) * INODE_SIZE }
  }

  private writeInode(ino: number): void {
    const { block, offset } = this.inodeLocation(ino)
    const buf = this.dev.read(block)
    const v = new DataView(buf.buffer, buf.byteOffset)
    const n = this.inodes[ino]
    buf.fill(0, offset, offset + INODE_SIZE)
    v.setUint8(offset, n.used ? 1 : 0)
    v.setUint8(offset + 1, n.type === 'dir' ? 2 : 1)
    v.setUint32(offset + 4, n.size, true)
    v.setUint32(offset + 8, n.indexBlock, true)
    v.setUint32(offset + 12, n.ctime, true)
    v.setUint32(offset + 16, n.mtime, true)
    v.setUint32(offset + 20, n.blocks.length, true)
    v.setUint32(offset + 24, n.parent, true)
    this.dev.write(block, buf)
  }

  private readInode(ino: number): Inode {
    const { block, offset } = this.inodeLocation(ino)
    const buf = this.dev.read(block)
    const v = new DataView(buf.buffer, buf.byteOffset)
    const used = v.getUint8(offset) === 1
    const indexBlock = v.getUint32(offset + 8, true)
    const count = v.getUint32(offset + 20, true)
    const blocks: number[] = []
    if (used && indexBlock) {
      const iv = new DataView(this.dev.read(indexBlock).buffer)
      for (let i = 0; i < count; i++) blocks.push(iv.getUint32(i * 4, true))
    }
    return {
      used,
      type: v.getUint8(offset + 1) === 2 ? 'dir' : 'file',
      size: v.getUint32(offset + 4, true),
      indexBlock,
      ctime: v.getUint32(offset + 12, true),
      mtime: v.getUint32(offset + 16, true),
      blocks,
      parent: v.getUint32(offset + 24, true)
    }
  }
}

export function split(path: string): string[] {
  return path.split('/').filter((p) => p && p !== '.')
}

export function normalize(path: string): string {
  return '/' + split(path).join('/')
}

export function basename(path: string): string {
  return split(path).at(-1) ?? ''
}

export function dirname(path: string): string {
  return '/' + split(path).slice(0, -1).join('/')
}

function countRuns(blocks: number[]): number {
  let runs = 0
  for (let i = 0; i < blocks.length; i++) if (i === 0 || blocks[i] !== blocks[i - 1] + 1) runs++
  return runs
}
