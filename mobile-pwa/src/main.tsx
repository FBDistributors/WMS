import React from 'react'
import ReactDOM from 'react-dom/client'

import './i18n'
import { App } from './app/App'
import { AppToastProvider } from './feedback/AppToastProvider'
import { AuthProvider } from './rbac/AuthProvider'
import { ThemeProvider } from './theme/ThemeProvider'
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AppToastProvider>
          <App />
        </AppToastProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
)
