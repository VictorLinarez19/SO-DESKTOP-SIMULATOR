import { useEffect, useRef, useState } from 'react'
import type { DiskInfo, FileDetails } from '@shared/kernelTypes'
import { useUi } from '../../store/ui'
import { cylinderOf } from '../../lib/files'

const COLS = 128
const CELL = 6

const COLOR = {
  meta: '#8e8e93',
  free: 'rgba(255,255,255,0.06)',
  used: '#0a84ff',
  swapFree: 'rgba(191,90,242,0.14)',
  swapUsed: '#bf5af2',
  file: '#ffd60a',
  index: '#ff9f0a'
}

/** Mapa de bloques del disco (un cuadro por bloque), dibujado en canvas. */
export function BlockMap({ disk }: { disk: DiskInfo }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const selected = useUi((s) => s.selectedFile)
  const [file, setFile] = useState<FileDetails | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const rows = Math.ceil(disk.blockCount / COLS)
  const entry = disk.files.find((f) => f.path === selected)

  useEffect(() => {
    if (!selected) return
    let alive = true
    void window.os.query({ type: 'fileInfo', path: selected }).then((d) => {
      if (alive) setFile(d)
    })
    return () => {
      alive = false
    }
  }, [selected, entry?.mtime, entry?.size])

  const highlight = selected && file?.entry.path === selected ? file : null

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = COLS * CELL * dpr
    canvas.height = rows * CELL * dpr
    ctx.scale(dpr, dpr)
    const fileBlocks = new Set(highlight?.blocks ?? [])
    for (let b = 0; b < disk.blockCount; b++) {
      const used = (parseInt(disk.bitmap.substr((b >> 3) * 2, 2), 16) >> (b & 7)) & 1
      const swap = b >= disk.swapStart
      ctx.fillStyle =
        b === highlight?.indexBlock
          ? COLOR.index
          : fileBlocks.has(b)
            ? COLOR.file
            : b < disk.dataStart
              ? COLOR.meta
              : swap
                ? used
                  ? COLOR.swapUsed
                  : COLOR.swapFree
                : used
                  ? COLOR.used
                  : COLOR.free
      ctx.fillRect((b % COLS) * CELL, Math.floor(b / COLS) * CELL, CELL - 1, CELL - 1)
    }
  }, [disk.bitmap, disk.blockCount, disk.dataStart, disk.swapStart, rows, highlight])

  return (
    <div className="block-map">
      <canvas
        ref={ref}
        style={{ width: COLS * CELL, height: rows * CELL }}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const col = Math.floor((e.clientX - r.left) / CELL)
          const row = Math.floor((e.clientY - r.top) / CELL)
          setHover(row * COLS + col)
        }}
        onMouseLeave={() => setHover(null)}
      />
      <div className="block-map-side">
        <div className="legend">
          {(
            [
              ['meta', 'Superbloque, mapa de bits e i-nodos'],
              ['used', 'Datos ocupados'],
              ['free', 'Libre'],
              ['swapUsed', 'Swap ocupado'],
              ['swapFree', 'Área de intercambio'],
              ['file', 'Archivo seleccionado'],
              ['index', 'Su bloque índice']
            ] as const
          ).map(([k, label]) => (
            <span key={k}>
              <i style={{ background: COLOR[k] }} /> {label}
            </span>
          ))}
        </div>
        <div className="muted small hover-info">
          {hover !== null && hover < disk.blockCount
            ? `Bloque ${hover} · cilindro ${cylinderOf(hover, disk.blockCount, disk.cylinders)} · byte ${(hover * disk.blockSize).toLocaleString('es-MX')}`
            : 'Pasa el puntero sobre un bloque'}
        </div>
        {highlight && (
          <div className="small">
            <b>{highlight.entry.name}</b>: índice en {highlight.indexBlock},{' '}
            {highlight.blocks.length} bloques de datos{' '}
            {highlight.entry.fragments > 1 ? `en ${highlight.entry.fragments} tramos` : 'contiguos'}
            .
          </div>
        )}
      </div>
    </div>
  )
}
