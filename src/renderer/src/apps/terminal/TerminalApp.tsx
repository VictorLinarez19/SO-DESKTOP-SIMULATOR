import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useKernel } from '../../store/kernel'
import { useSession } from '../../store/session'
import { useWm } from '../../store/windows'
import { useWindow } from '../../wm/WindowContext'
import { homeOf } from '@shared/accounts'
import { COMMANDS, runCommand } from '@shared/shell'
import { processOf } from '../../lib/process'
import { ProcessBar } from '../../components/ProcessBar'

interface Line {
  text: string
  kind: 'out' | 'in' | 'err'
}

const WELCOME: Line[] = [
  {
    kind: 'out',
    text: 'guiñanOS · Terminal del kernel. Escribe «help» para ver los comandos; «exit» la cierra.'
  },
  {
    kind: 'out',
    text: 'Cada tecla que pulsas es una interrupción de teclado para el proceso Terminal.'
  }
]

/** Terminal: comandos reales que consultan y controlan el kernel simulado. */
export function TerminalApp(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const [lines, setLines] = useState<Line[]>(WELCOME)
  const [input, setInput] = useState('')
  const user = useSession((s) => s.user)
  const win = useWindow()
  const [cwd, setCwd] = useState(user ? homeOf(user.name) : '/')
  const [history, setHistory] = useState<string[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => field.current?.focus(), [])
  useLayoutEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight })
  }, [lines])

  const runAction = (a: NonNullable<Awaited<ReturnType<typeof runCommand>>['action']>): void => {
    const session = useSession.getState()
    if (a === 'exit') useWm.getState().close(win.id)
    else if (a === 'logout') session.logout()
    else if (a === 'lock') session.lock()
    else if (a === 'sleep') session.sleep()
    else if (a === 'reboot') session.restart()
    else session.shutdown()
  }

  const submit = async (): Promise<void> => {
    const line = input.trim()
    setInput('')
    setCursor(null)
    if (!line) return
    setHistory((h) => [...h, line])
    const prompt: Line = { kind: 'in', text: `${cwd} ❯ ${line}` }
    const snap = useKernel.getState().snapshot
    if (!snap) return
    const r = await runCommand(line, {
      snapshot: snap,
      cwd,
      user: user ? { name: user.name, admin: user.admin } : null,
      send: useKernel.getState().send,
      query: (q) => window.os.query(q)
    })
    if (r.cwd) setCwd(r.cwd)
    if (r.action) runAction(r.action)
    setLines((prev) => [
      ...(r.clear ? [] : prev),
      ...(r.clear ? [] : [prompt]),
      ...r.lines.map((text): Line => ({ kind: r.error ? 'err' : 'out', text }))
    ])
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void submit()
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (history.length === 0) return
      const next =
        e.key === 'ArrowUp'
          ? Math.max(0, (cursor ?? history.length) - 1)
          : Math.min(history.length, (cursor ?? history.length) + 1)
      setCursor(next)
      setInput(history[next] ?? '')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const matches = Object.keys(COMMANDS).filter(
        (c) => c.startsWith(input) && !input.includes(' ')
      )
      if (matches.length === 1) setInput(matches[0] + ' ')
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault()
      setLines([])
    }
  }

  return (
    <div className="terminal-app" onClick={() => field.current?.focus()}>
      <ProcessBar p={processOf(snapshot, 'terminal')} programId="terminal" />
      <div className="terminal-screen" ref={scroll}>
        {lines.map((l, i) => (
          <div key={i} className={`t-line ${l.kind}`}>
            {l.text || ' '}
          </div>
        ))}
        <div className="t-prompt">
          <span>{cwd} ❯</span>
          <input
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label="Comando"
          />
        </div>
      </div>
    </div>
  )
}
