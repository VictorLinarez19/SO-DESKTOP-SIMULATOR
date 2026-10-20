import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import { App } from './App'
import './styles/global.css'
import './styles/desktop.css'
import './styles/window.css'
import './styles/apps.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
