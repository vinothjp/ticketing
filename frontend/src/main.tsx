import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyPrefs, loadPrefs } from './lib/preferences'

// Paint the saved theme/accent/font before the first render, so a dark-mode
// user never sees a white flash on reload.
applyPrefs(loadPrefs())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
