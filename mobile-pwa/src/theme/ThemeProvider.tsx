import { createContext, useContext, useEffect, useMemo, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = 'wms_theme'

function applyTheme(theme: ThemeMode) {
  if (typeof window === 'undefined') return
  const root = window.document.documentElement
  root.classList.remove('dark')
  if (theme === 'dark') {
    root.classList.add('dark')
    return
  }
  if (theme === 'system') {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
    if (prefersDark) {
      root.classList.add('dark')
    }
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'system'
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  })

  useEffect(() => {
    applyTheme(theme)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, theme)
    }
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia) return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'system') {
        applyTheme('system')
      }
    }
    media.addEventListener?.('change', handler)
    return () => media.removeEventListener?.('change', handler)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeState,
    }),
    [theme]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return ctx
}
