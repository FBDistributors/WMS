import { useEffect, useRef, useState } from 'react'

type CameraScannerProps = {
  onDetected: (code: string) => void
  onError?: (message: string) => void
  active: boolean
}

export default function CameraScanner({ onDetected, onError, active }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active) return
    let isCancelled = false
    let reader: { reset: () => void } | null = null

    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (isCancelled) return
        reader = new BrowserMultiFormatReader()
        await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
          if (!result) return
          const text = result.getText()
          if (!text) return
          onDetected(text)
          reader?.reset()
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Camera error'
        setError(message)
        onError?.(message)
      }
    }

    void start()

    return () => {
      isCancelled = true
      reader?.reset()
    }
  }, [active, onDetected, onError])

  if (!active) return null

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="text-xs uppercase text-slate-500">Camera scan</div>
      <div className="mt-3 overflow-hidden rounded-xl bg-slate-100">
        <video ref={videoRef} className="h-56 w-full object-cover" />
      </div>
      {error ? <div className="mt-2 text-xs text-red-600">{error}</div> : null}
    </div>
  )
}
