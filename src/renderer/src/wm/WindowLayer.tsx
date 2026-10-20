import { AnimatePresence, motion } from 'framer-motion'
import { useWm } from '../store/windows'
import { APP_COMPONENTS } from '../apps/registry'
import { snapBounds } from './geometry'
import { Window } from './Window'

export function WindowLayer(): React.JSX.Element {
  const windows = useWm((s) => s.windows)
  const focusedId = useWm((s) => s.focusedId)
  const preview = useWm((s) => s.snapPreview)
  const previewBounds = preview ? snapBounds(preview) : null

  return (
    <div className="window-layer">
      <AnimatePresence>
        {previewBounds && (
          <motion.div
            key="snap-preview"
            className="snap-preview"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{
              opacity: 1,
              scale: 1,
              x: previewBounds.x,
              y: previewBounds.y,
              width: previewBounds.w,
              height: previewBounds.h
            }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {windows.map((win) => {
          const App = APP_COMPONENTS[win.appId]
          return (
            <Window key={win.id} win={win} focused={win.id === focusedId}>
              <App />
            </Window>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
