import { create } from 'zustand'
import type { HwState } from '@shared/kernelTypes'

/** Estado del hardware real que publica el HAL (~1 vez por segundo). */
export const useHardware = create<{ hw: HwState | null }>(() => ({ hw: null }))

window.os.onHardware((hw) => useHardware.setState({ hw }))
