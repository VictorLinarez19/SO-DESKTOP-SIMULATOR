import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useKernel } from '../store/kernel'
import { useUi } from '../store/ui'
import { resetDesktop, useSession } from '../store/session'
import { LogoIcon } from './icons'
import { LoginScreen } from './LoginScreen'

const BOOT_STEPS = [
  'Cargando guiñan-kernel…',
  'Inicializando el reloj del sistema…',
  'Montando guiñanFS desde disk.img…',
  'Reservando memoria y área de intercambio…',
  'Registrando controladores de dispositivo…',
  'Detectando hardware real: USB, batería, red, teclado…',
  'Iniciando procesos del sistema…'
]

/** Arranque: se monta de nuevo en cada inicio, así que siempre empieza desde el primer paso. */
function BootScreen(): React.JSX.Element {
  const ready = useKernel((s) => s.snapshot !== null)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (step < BOOT_STEPS.length) {
      const t = setTimeout(() => setStep((s) => s + 1), 260)
      return () => clearTimeout(t)
    }
    if (ready) {
      const t = setTimeout(async () => {
        await useSession.getState().load()
        useUi.getState().set({ power: 'login' })
      }, 250)
      return () => clearTimeout(t)
    }
  }, [step, ready])

  return (
    <>
      <div className="boot-bar">
        <motion.span
          animate={{ width: `${Math.min(100, ((step + 1) / (BOOT_STEPS.length + 1)) * 100)}%` }}
          transition={{ duration: 0.25 }}
        />
      </div>
      <div className="boot-step">{BOOT_STEPS[Math.min(step, BOOT_STEPS.length - 1)]}</div>
    </>
  )
}

/** Apagado y reinicio: guardan el estado y, al terminar, cierran la app o vuelven a arrancar. */
function ShutdownScreen({ restart }: { restart: boolean }): React.JSX.Element {
  useEffect(() => {
    const t = setTimeout(() => {
      if (!restart) {
        void window.os.system.quit()
        return
      }
      // Reinicio: el kernel arranca de cero (el disco conserva los archivos y las cuentas).
      resetDesktop()
      useKernel.getState().send({ type: 'reset' })
      useSession.setState({ user: null })
      useUi.getState().set({ power: 'booting' })
    }, 1700)
    return () => clearTimeout(t)
  }, [restart])
  return (
    <div className="boot-step">
      {restart
        ? 'Reiniciando… se guardan los datos en disk.img'
        : 'Apagando… se guardan los datos en disk.img'}
    </div>
  )
}

/** Pantalla en reposo: el kernel está en pausa hasta que se pulse una tecla o el ratón. */
function SleepScreen(): React.JSX.Element {
  useEffect(() => {
    let done = false
    const off = (): void => {
      window.removeEventListener('keydown', wake, true)
      window.removeEventListener('pointerdown', wake, true)
    }
    // Despierta una sola vez, venga de una tecla o de un clic.
    function wake(e: Event): void {
      if (done) return
      done = true
      off()
      // Se consume el evento: si no, el clic desenfocaría el campo de contraseña recién creado.
      e.preventDefault()
      e.stopPropagation()
      useSession.getState().wake()
    }
    // Pequeña espera para que el clic que suspendió el equipo no lo despierte.
    const t = setTimeout(() => {
      window.addEventListener('keydown', wake, true)
      window.addEventListener('pointerdown', wake, true)
    }, 600)
    return () => {
      clearTimeout(t)
      off()
    }
  }, [])
  return (
    <motion.div
      className="sleep-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <span>Kernel en pausa · pulsa una tecla o haz clic para despertar</span>
    </motion.div>
  )
}

/** Capas a pantalla completa según la fase del equipo. */
export function PowerScreens(): React.JSX.Element {
  const power = useUi((s) => s.power)
  const loginPhase = power === 'login' || power === 'locked'
  const cover = power === 'booting' || power === 'shutting-down' || power === 'restarting'

  return (
    <>
      <AnimatePresence>
        {cover && (
          <motion.div
            key="cover"
            className="power-screen"
            initial={{ opacity: power === 'booting' ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5 } }}
          >
            <div className="power-logo">
              <LogoIcon />
            </div>
            <h1>guiñanOS</h1>
            {power === 'booting' ? (
              <BootScreen />
            ) : (
              <ShutdownScreen restart={power === 'restarting'} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{loginPhase && <LoginScreen key="login" />}</AnimatePresence>
      <AnimatePresence>{power === 'sleeping' && <SleepScreen key="sleep" />}</AnimatePresence>
    </>
  )
}
