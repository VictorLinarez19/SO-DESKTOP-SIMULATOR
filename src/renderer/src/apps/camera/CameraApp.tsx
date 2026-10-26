import { useEffect, useRef, useState } from 'react'
import { useKernel } from '../../store/kernel'
import { isSuspended, processOf } from '../../lib/process'
import { ProcessBar } from '../../components/ProcessBar'

/**
 * Cámara: la webcam real solo se enciende mientras el proceso Cámara tiene asignado el
 * recurso «camara» y no está suspendido. Si se mata o se suspende el proceso, se apaga.
 */
export function CameraApp(): React.JSX.Element {
  const snapshot = useKernel((s) => s.snapshot)
  const send = useKernel((s) => s.send)
  const p = processOf(snapshot, 'camara')
  const owns = !!p && p.state !== 'TERMINATED' && !isSuspended(p) && (p.resources.camara ?? 0) > 0
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    if (!owns) return
    let stream: MediaStream | null = null
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [owns])

  const takePhoto = (): void => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')!
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    const base64 = canvas.toDataURL('image/png').split(',')[1]
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '_')
    const path = `/Usuarios/victor/Imágenes/foto_${stamp}.png`
    send({ type: 'fsWriteBinary', path, base64 })
    setSaved(path)
    setFlash((n) => n + 1)
  }

  const holder = snapshot?.resources.allocation.find((a) => a.resource === 'camara')
  return (
    <div className="camera-app">
      <ProcessBar p={p} programId="camara" />
      <div className="camera-view">
        {owns && !error ? (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
            <div key={flash} className={flash ? 'camera-flash' : undefined} />
            <span className="rec">● En uso por PID {p!.pid}</span>
          </>
        ) : (
          <div className="camera-off">
            <div className="camera-off-icon">📷</div>
            {error ? (
              <p>No se pudo abrir la cámara: {error}</p>
            ) : (
              <p>
                Cámara apagada.{' '}
                {!p || p.state === 'TERMINATED'
                  ? 'El proceso Cámara terminó y liberó el recurso.'
                  : isSuspended(p)
                    ? 'El proceso Cámara está suspendido.'
                    : holder
                      ? `El recurso lo tiene PID ${holder.pid}.`
                      : 'El proceso aún no obtiene el recurso «camara».'}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="camera-controls">
        <span className="muted small">
          {saved
            ? `Foto guardada en disk.img: ${saved}`
            : 'La foto se guarda como PNG en el disco de LinarezOS.'}
        </span>
        <button
          className="shutter"
          disabled={!owns || !!error}
          onClick={takePhoto}
          aria-label="Tomar foto"
        />
      </div>
    </div>
  )
}
