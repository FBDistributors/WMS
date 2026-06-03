import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { FloatingSnackBar, type ToastVariant } from '../components/ui/FloatingSnackBar'

const DEFAULT_DURATION_MS = 3000

export type AppToastOptions = {
  variant?: ToastVariant
  durationMs?: number
}

export type AppToastContextValue = {
  showToast: (message: string, options?: AppToastOptions) => void
  showSuccess: (message: string, durationMs?: number) => void
  showError: (message: string, durationMs?: number) => void
  showWarning: (message: string, durationMs?: number) => void
  showInfo: (message: string, durationMs?: number) => void
  dismiss: () => void
}

const AppToastContext = createContext<AppToastContextValue | null>(null)

type ToastState = {
  message: string
  variant: ToastVariant
  durationMs: number
  key: number
}

export function AppToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)

  const dismiss = useCallback(() => setToast(null), [])

  const showToast = useCallback((message: string, options?: AppToastOptions) => {
    const trimmed = message.trim()
    if (!trimmed) return
    setToast({
      message: trimmed,
      variant: options?.variant ?? 'info',
      durationMs: options?.durationMs ?? DEFAULT_DURATION_MS,
      key: Date.now(),
    })
  }, [])

  const showSuccess = useCallback(
    (message: string, durationMs?: number) => {
      showToast(message, { variant: 'success', durationMs })
    },
    [showToast]
  )

  const showError = useCallback(
    (message: string, durationMs?: number) => {
      showToast(message, { variant: 'error', durationMs })
    },
    [showToast]
  )

  const showWarning = useCallback(
    (message: string, durationMs?: number) => {
      showToast(message, { variant: 'warning', durationMs })
    },
    [showToast]
  )

  const showInfo = useCallback(
    (message: string, durationMs?: number) => {
      showToast(message, { variant: 'info', durationMs })
    },
    [showToast]
  )

  const value = useMemo(
    () => ({
      showToast,
      showSuccess,
      showError,
      showWarning,
      showInfo,
      dismiss,
    }),
    [showToast, showSuccess, showError, showWarning, showInfo, dismiss]
  )

  return (
    <AppToastContext.Provider value={value}>
      {children}
      <FloatingSnackBar
        key={toast?.key}
        message={toast?.message ?? null}
        variant={toast?.variant ?? 'success'}
        durationMs={toast?.durationMs ?? DEFAULT_DURATION_MS}
        onDismiss={dismiss}
      />
    </AppToastContext.Provider>
  )
}

export function useAppToast(): AppToastContextValue {
  const ctx = useContext(AppToastContext)
  if (!ctx) {
    throw new Error('useAppToast must be used within AppToastProvider')
  }
  return ctx
}
