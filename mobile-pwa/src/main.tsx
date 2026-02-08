import React from 'react'
import ReactDOM from 'react-dom/client'

import './i18n'
import { App } from './app/App'
import { AuthProvider } from './rbac/AuthProvider'
import { ThemeProvider } from './theme/ThemeProvider'
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
)
