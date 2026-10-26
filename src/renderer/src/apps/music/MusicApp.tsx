import { useEffect, useRef, useState } from 'react'
import { useKernel } from '../../store/kernel'
import { processOf } from '../../lib/process'
import { ProcessBar } from '../../components/ProcessBar'

// Melodía pentatónica (Hz) que "decodifica" el proceso Música.
const MELODY = [523, 587, 659, 784, 880, 784, 659, 587, 523, 440, 392, 440, 523, 659, 587, 523]
const NOTE_MS = 260

/**
 * Música: el sonido sale por las bocinas reales solo mientras el dispositivo de audio
 * atiende al proceso Música. Si el proceso no recibe CPU, se suspende o se mata, se calla.
 */
export function MusicApp(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const p = processOf(snapshot, 'musica')
  const audioDev = snapshot?.devices.find((d) => d.id === 'audio')
  const playing = !!p && audioDev?.busyPid === p.pid
  const [enabled, setEnabled] = useState(false)
  const [note, setNote] = useState(0)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!enabled || !playing) return
    ctxRef.current ??= new AudioContext()
    const ctx = ctxRef.current
    let i = 0
    const play = (): void => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = MELODY[i % MELODY.length]
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + NOTE_MS / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + NOTE_MS / 1000)
      setNote(i++)
    }
    play()
    const t = setInterval(play, NOTE_MS)
    return () => clearInterval(t)
  }, [enabled, playing])

  useEffect(() => () => void ctxRef.current?.close(), [])

  const status =
    !p || p.state === 'TERMINATED'
      ? 'Detenido: el proceso terminó.'
      : playing
        ? 'Reproduciendo: el dispositivo de audio atiende al proceso.'
        : p.state === 'READY'
          ? 'En silencio: el proceso está Listo, esperando CPU para decodificar el siguiente bloque.'
          : p.state === 'RUNNING'
            ? 'Decodificando el siguiente bloque…'
            : 'En silencio: el proceso está bloqueado o suspendido.'

  return (
    <div className="music-app">
      <ProcessBar p={p} programId="musica" />
      <div className="music-body">
        <div className={`album${playing && enabled ? ' spinning' : ''}`}>♪</div>
        <div className="track">
          <b>Melodía de LinarezOS</b>
          <span className="muted small">
            Bocinas:{' '}
            {snapshot?.resources.allocation.some((a) => a.resource === 'audio' && a.pid === p?.pid)
              ? `recurso «audio» asignado a PID ${p!.pid}`
              : 'libres'}
          </span>
        </div>
        <div className="eq">
          {Array.from({ length: 16 }, (_, i) => (
            <span
              key={i}
              style={{
                height: playing
                  ? `${20 + ((MELODY[(note + i) % MELODY.length] - 380) / 500) * 60}%`
                  : '6%'
              }}
            />
          ))}
        </div>
        <p className="music-status">{status}</p>
        <label className="switch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="switch-track" />
          <span>Sonido por las bocinas reales</span>
        </label>
      </div>
    </div>
  )
}
