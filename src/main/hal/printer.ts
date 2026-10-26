import { BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KernelEffect } from '@shared/kernelTypes'

const KEEP = 20

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

/**
 * Imprime un trabajo del Spooler: genera un PDF real con el motor de impresión de
 * Chromium y, si CUPS tiene una impresora predeterminada, además lo envía con `lp`.
 */
export async function printJob(
  job: Extract<KernelEffect, { type: 'print' }>,
  dir: string,
  printers: string[]
): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{font:13px/1.5 -apple-system,'Inter',sans-serif;margin:48px;color:#111}
    header{border-bottom:2px solid #7b3fe4;margin-bottom:24px;padding-bottom:8px}
    h1{font-size:20px;margin:0}small{color:#666}pre{white-space:pre-wrap;font:12px/1.5 monospace}
  </style><header><h1>${esc(job.title)}</h1><small>LinarezOS · trabajo #${job.jobId} · enviado por
  ${esc(job.owner)} (PID ${job.pid}) · ${new Date().toLocaleString('es-MX')}</small></header>
  <pre>${esc(job.content)}</pre>`
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true })
    const name = `trabajo_${String(job.jobId).padStart(3, '0')}_${job.title.replace(/[^\p{L}\d._-]/gu, '_')}.pdf`
    const path = join(dir, name)
    writeFileSync(path, pdf)
    rotate(dir)
    if (printers.length > 0) execFile('lp', [path], () => undefined)
    return path
  } finally {
    win.destroy()
  }
}

/** Conserva solo los últimos trabajos impresos. */
function rotate(dir: string): void {
  const files = readdirSync(dir)
    .filter((f) => /^trabajo_\d+_.*\.pdf$/.test(f))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) unlinkSync(join(dir, f))
}
