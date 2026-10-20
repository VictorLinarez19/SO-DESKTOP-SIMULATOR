import { useEffect, useRef, useState } from 'react'
import { useKernel } from '../../store/kernel'
import { processOf } from '../../lib/process'
import { ProcessBar } from '../../components/ProcessBar'
import { fmtDate } from '../../lib/files'

const DOC = '/Usuarios/juan/Documentos/notas.txt'

/**
 * Editor de texto: cada tecla es una interrupción del teclado real que despierta al
 * proceso Editor; en su siguiente FWRITE el proceso guarda este texto en disk.img.
 */
export function TextEdit(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const send = useKernel((s) => s.send)
  const p = processOf(snapshot, 'editor')
  const file = snapshot?.disk.files.find((f) => f.path === DOC)
  const [text, setText] = useState<string | null>(null)
  const [editedAt, setEditedAt] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Carga el documento real desde el disco de guiñanOS.
  useEffect(() => {
    let alive = true
    void window.os.query({ type: 'fileInfo', path: DOC }).then((d) => {
      if (alive) setText(d?.preview ?? '')
    })
    return () => {
      alive = false
      void window.os.command({ type: 'docUpdate', path: DOC, text: null })
    }
  }, [])

  const onChange = (value: string): void => {
    setText(value)
    setEditedAt(Date.now())
    clearTimeout(timer.current)
    timer.current = setTimeout(() => send({ type: 'docUpdate', path: DOC, text: value }), 200)
  }

  const pending = file ? editedAt > file.mtime * 1000 : false
  const keyboard = snapshot?.devices.find((d) => d.id === 'teclado')
  return (
    <div className="textedit">
      <ProcessBar p={p} programId="editor" />
      <div className="textedit-file small">
        <span>📄 notas.txt</span>
        <span className="muted">· {DOC}</span>
      </div>
      {text === null ? (
        <div className="empty">Leyendo notas.txt del disco…</div>
      ) : (
        <textarea
          className="textedit-area"
          value={text}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Escribe aquí…"
        />
      )}
      <div className="textedit-status small">
        <span className={pending ? 'pending' : 'saved'}>
          {pending
            ? 'Cambios pendientes: el proceso Editor los guardará en su próximo FWRITE'
            : `Guardado en disk.img por el proceso Editor · ${file ? fmtDate(file.mtime) : '—'}`}
        </span>
        <span className="muted">
          IRQ de teclado reales: {keyboard?.irqs ?? 0}
          {keyboard?.mode !== 'event' && ' (teclado simulado)'}
        </span>
      </div>
    </div>
  )
}
