import React from 'react'
import ReactDOM from 'react-dom/client'

import './i18n'
import { App } from './app/App'
import { AuthProvider } from './rbac/AuthProvider'
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
)
