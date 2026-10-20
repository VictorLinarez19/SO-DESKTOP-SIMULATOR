import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  openSync,
  readSync,
  writeSync
} from 'node:fs'
import { BLOCK_SIZE, DEFAULT_BLOCKS, type BlockDevice } from '@kernel/disk/blockDevice'

/**
 * Disco respaldado por un archivo real (`disk.img`). Cada bloque se lee y escribe
 * directamente en su posición del archivo (desplazamiento = bloque × tamaño de bloque).
 */
export class FileBlockDevice implements BlockDevice {
  readonly blockSize = BLOCK_SIZE
  private readonly fd: number

  constructor(
    readonly path: string,
    readonly blockCount = DEFAULT_BLOCKS
  ) {
    const created = !existsSync(path)
    this.fd = openSync(path, created ? 'w+' : 'r+')
    const size = blockCount * BLOCK_SIZE
    // Archivo disperso: ocupa espacio real solo en los bloques escritos.
    if (created || fstatSync(this.fd).size !== size) ftruncateSync(this.fd, size)
  }

  read(block: number): Uint8Array {
    this.check(block)
    const buf = new Uint8Array(this.blockSize)
    readSync(this.fd, buf, 0, this.blockSize, block * this.blockSize)
    return buf
  }

  write(block: number, data: Uint8Array): void {
    this.check(block)
    const buf = new Uint8Array(this.blockSize)
    buf.set(data.subarray(0, this.blockSize))
    writeSync(this.fd, buf, 0, this.blockSize, block * this.blockSize)
  }

  close(): void {
    closeSync(this.fd)
  }

  private check(block: number): void {
    if (!Number.isInteger(block) || block < 0 || block >= this.blockCount) {
      throw new RangeError(`Bloque fuera del disco: ${block}`)
    }
  }
}
