/** Dispositivo de bloques: lo único que el sistema de archivos sabe del disco. */
export interface BlockDevice {
  readonly blockSize: number
  readonly blockCount: number
  /** Ruta real del archivo de imagen (null si el disco vive en memoria). */
  readonly path: string | null
  read(block: number): Uint8Array
  write(block: number, data: Uint8Array): void
}

export const BLOCK_SIZE = 4096
/** 32 MB. */
export const DEFAULT_BLOCKS = 8192

/** Disco en memoria: para pruebas y para la simulación por consola. */
export class MemoryBlockDevice implements BlockDevice {
  readonly path = null
  private readonly blocks = new Map<number, Uint8Array>()

  constructor(
    readonly blockCount = DEFAULT_BLOCKS,
    readonly blockSize = BLOCK_SIZE
  ) {}

  read(block: number): Uint8Array {
    this.check(block)
    return new Uint8Array(this.blocks.get(block) ?? new Uint8Array(this.blockSize))
  }

  write(block: number, data: Uint8Array): void {
    this.check(block)
    const buf = new Uint8Array(this.blockSize)
    buf.set(data.subarray(0, this.blockSize))
    this.blocks.set(block, buf)
  }

  private check(block: number): void {
    if (!Number.isInteger(block) || block < 0 || block >= this.blockCount) {
      throw new RangeError(`Bloque fuera del disco: ${block}`)
    }
  }
}
