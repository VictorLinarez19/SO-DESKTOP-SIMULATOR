export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' })

export function fmtDate(secs: number): string {
  return secs ? dateFmt.format(new Date(secs * 1000)) : '—'
}

export function parentOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return '/' + parts.slice(0, -1).join('/')
}

export function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`
}

export function cylinderOf(block: number, blockCount: number, cylinders: number): number {
  return Math.min(cylinders - 1, Math.floor((block * cylinders) / blockCount))
}
