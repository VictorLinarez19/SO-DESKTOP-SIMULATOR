import { useEffect, useState } from 'react'
import type { FileDetails, FsEntryInfo } from '@shared/kernelTypes'
import { useKernel } from '../../store/kernel'
import { useUi } from '../../store/ui'
import { useSession } from '../../store/session'
import { canWrite, homeOf } from '@shared/accounts'
import { useWm } from '../../store/windows'
import { WindowToolbar } from '../../wm/WindowContext'
import { cylinderOf, fmtDate, fmtSize, joinPath, parentOf } from '../../lib/files'
import { FileIcon } from './FileIcon'

const favoritesOf = (home: string): [string, string][] => [
  ['Mi carpeta', home],
  ['Documentos', `${home}/Documentos`],
  ['Descargas', `${home}/Descargas`],
  ['Imágenes', `${home}/Imágenes`],
  ['Música', `${home}/Música`]
]
const LOCATIONS: [string, string][] = [
  ['Macintosh HD', '/'],
  ['Aplicaciones', '/Aplicaciones'],
  ['Sistema', '/Sistema'],
  ['Respaldos', '/Respaldos']
]

export function Finder(): React.JSX.Element {
  const disk = useKernel((s) => s.snapshot?.disk)
  const send = useKernel((s) => s.send)
  const selected = useUi((s) => s.selectedFile)
  const selectFile = useUi((s) => s.selectFile)
  const user = useSession((s) => s.user)
  const favorites = favoritesOf(homeOf(user?.name ?? 'invitado'))
  const cwd = useUi((s) => s.finderPath)
  const setCwd = useUi((s) => s.setFinderPath)
  const [history, setHistory] = useState<string[]>([])

  if (!disk) return <div className="empty">Conectando con el kernel…</div>
  const exists = disk.files.some((f) => f.path === cwd && f.type === 'dir')
  const dir = exists ? cwd : '/'
  const current = disk.files.find((f) => f.path === dir)!
  const items = disk.files
    .filter((f) => f.path !== '/' && parentOf(f.path) === dir)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  const sel = items.find((f) => f.path === selected) ?? null

  const go = (path: string): void => {
    setHistory((h) => [...h, dir])
    setCwd(path)
    selectFile(null)
  }
  const back = (): void => {
    const prev = history.at(-1)
    if (!prev) return
    setHistory((h) => h.slice(0, -1))
    setCwd(prev)
    selectFile(null)
  }
  const newName = (base: string, ext = ''): string => {
    let n = 1
    while (items.some((f) => f.name === `${base}${n > 1 ? ` ${n}` : ''}${ext}`)) n++
    return `${base}${n > 1 ? ` ${n}` : ''}${ext}`
  }

  return (
    <div className="finder">
      <WindowToolbar>
        <div className="finder-nav" data-nodrag>
          <button
            className="nav-btn"
            disabled={history.length === 0}
            onClick={back}
            aria-label="Atrás"
          >
            ‹
          </button>
          <button
            className="nav-btn"
            disabled={dir === '/'}
            onClick={() => go(parentOf(dir))}
            aria-label="Subir"
          >
            ⌃
          </button>
        </div>
        <span className="finder-title">{dir === '/' ? 'Macintosh HD' : current.name}</span>
        <span className="toolbar-spacer" />
        <div className="toolbar-controls" data-nodrag>
          <button
            disabled={!canWrite(user, dir)}
            title={
              canWrite(user, dir) ? undefined : 'No tienes permiso para escribir en esta carpeta'
            }
            onClick={() =>
              send({ type: 'fsMkdir', path: joinPath(dir, newName('carpeta sin título')) })
            }
          >
            Nueva carpeta
          </button>
          <button
            disabled={!canWrite(user, dir)}
            onClick={() => {
              const path = joinPath(dir, newName('Documento', '.txt'))
              send({
                type: 'fsWriteText',
                path,
                text: `Documento creado en guiñanOS el ${new Date().toLocaleString('es-MX')}.\n`
              })
              selectFile(path)
            }}
          >
            Nuevo documento
          </button>
          <button
            className="danger"
            disabled={!sel || !canWrite(user, sel.path)}
            onClick={() => {
              if (sel) send({ type: 'fsDelete', path: sel.path })
              selectFile(null)
            }}
          >
            Eliminar
          </button>
        </div>
      </WindowToolbar>
      <div className="finder-body">
        <nav className="finder-sidebar">
          <div className="sidebar-title">Favoritos</div>
          {favorites.map(([label, path]) => (
            <SidebarItem key={path} label={label} active={dir === path} onClick={() => go(path)} />
          ))}
          <div className="sidebar-title">Ubicaciones</div>
          {LOCATIONS.map(([label, path]) => (
            <SidebarItem
              key={path}
              label={label}
              active={dir === path}
              onClick={() => go(path)}
              disk={path === '/'}
            />
          ))}
        </nav>
        <div className="finder-list">
          <table className="proc-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th className="num">Tamaño</th>
                <th className="num">Bloques</th>
                <th className="num" title="Tramos contiguos del archivo en el disco">
                  Fragmentos
                </th>
                <th>Modificado</th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr
                  key={f.path}
                  className={f.path === selected ? 'selected' : undefined}
                  onClick={() => selectFile(f.path)}
                  onDoubleClick={() => f.type === 'dir' && go(f.path)}
                >
                  <td className="name-cell">
                    <FileIcon name={f.name} dir={f.type === 'dir'} />
                    {f.name}
                  </td>
                  <td className="num">{f.type === 'dir' ? '—' : fmtSize(f.size)}</td>
                  <td className="num">{f.blockCount + (f.indexBlock ? 1 : 0)}</td>
                  <td className={`num${f.fragments > 1 ? ' scattered' : ''}`}>
                    {f.fragments || '—'}
                  </td>
                  <td className="muted">{fmtDate(f.mtime)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted empty-row">
                    Carpeta vacía
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="finder-path muted small">
            {dir} · {items.length} elementos · {fmtSize(disk.usage.freeBlocks * disk.blockSize)}{' '}
            disponibles
          </div>
        </div>
        {sel && <InfoPanel entry={sel} blockCount={disk.blockCount} cylinders={disk.cylinders} />}
      </div>
    </div>
  )
}

function SidebarItem({
  label,
  active,
  onClick,
  disk
}: {
  label: string
  active: boolean
  onClick: () => void
  disk?: boolean
}): React.JSX.Element {
  return (
    <button className={`sidebar-item${active ? ' active' : ''}`} onClick={onClick}>
      {disk ? (
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden>
          <rect x="3" y="7" width="18" height="10" rx="2" fill="#aeaeb2" />
          <circle cx="17" cy="12" r="1.3" fill="#30d158" />
        </svg>
      ) : (
        <FileIcon name="" dir size={16} />
      )}
      {label}
    </button>
  )
}

/** Panel "Obtener información": i-nodo, bloque índice, bloques de datos y vista previa real. */
function InfoPanel({
  entry,
  blockCount,
  cylinders
}: {
  entry: FsEntryInfo
  blockCount: number
  cylinders: number
}): React.JSX.Element {
  const [details, setDetails] = useState<FileDetails | null>(null)
  useEffect(() => {
    let alive = true
    void window.os.query({ type: 'fileInfo', path: entry.path }).then((d) => {
      if (alive) setDetails(d)
    })
    return () => {
      alive = false
    }
  }, [entry.path, entry.mtime, entry.size])

  const d = details?.entry.path === entry.path ? details : null
  return (
    <aside className="finder-info">
      <div className="info-head">
        <FileIcon name={entry.name} dir={entry.type === 'dir'} size={48} />
        <div>
          <div className="info-name">{entry.name}</div>
          <div className="muted small">
            {entry.type === 'dir' ? 'Carpeta' : fmtSize(entry.size)}
          </div>
        </div>
      </div>
      <dl className="pcb-grid">
        <div>
          <dt>i-nodo</dt>
          <dd>#{entry.inode}</dd>
        </div>
        <div>
          <dt>Bloque índice</dt>
          <dd>
            {entry.indexBlock
              ? `${entry.indexBlock} (cil. ${cylinderOf(entry.indexBlock, blockCount, cylinders)})`
              : '—'}
          </dd>
        </div>
        <div>
          <dt>Bloques de datos</dt>
          <dd>{entry.blockCount}</dd>
        </div>
        <div>
          <dt>Asignación</dt>
          <dd>{entry.fragments <= 1 ? 'contigua' : `dispersa en ${entry.fragments} tramos`}</dd>
        </div>
        <div>
          <dt>Modificado</dt>
          <dd>{fmtDate(entry.mtime)}</dd>
        </div>
      </dl>
      {d && d.blocks.length > 0 && (
        <>
          <div className="section-title">Bloque índice → bloques de datos</div>
          <div className="block-chips">
            {d.blocks.slice(0, 48).map((b, i) => (
              <span
                key={i}
                className="block-chip"
                title={`Bloque ${b} · cilindro ${cylinderOf(b, blockCount, cylinders)}`}
              >
                {b}
              </span>
            ))}
            {d.blocks.length > 48 && (
              <span className="muted small">… {d.blocks.length - 48} más</span>
            )}
          </div>
        </>
      )}
      {d?.preview && (
        <>
          <div className="section-title">Vista previa (leída de disk.img)</div>
          <pre className="preview">{d.preview}</pre>
        </>
      )}
      <button className="info-open-disk" onClick={() => useWm.getState().activateApp('disk')}>
        Ver bloques en Utilidad de Discos
      </button>
    </aside>
  )
}
