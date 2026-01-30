'use client'

import { ReactNode, useState } from 'react'
import { useTransition } from 'react'

type BannerFormAction = (formData: FormData) => Promise<{ success: boolean; message: string }>

export function BannerFormWrapper({
  action,
  children,
}: {
  action: BannerFormAction
  children: ReactNode
}) {
  const [isPending, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)
  const [toastVisible, setToastVisible] = useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    startTransition(async () => {
      try {
        const result = await action(formData)

        if (result && typeof result === 'object' && 'success' in result && 'message' in result) {
          setToast({
            message: result.message,
            tone: result.success ? 'success' : 'error',
          })
          setToastVisible(true)
          if (result.success) {
            // Fade out after 3s, clear after 3.6s
            setTimeout(() => setToastVisible(false), 3000)
            setTimeout(() => setToast(null), 3600)
          } else {
            setTimeout(() => setToastVisible(false), 3000)
            setTimeout(() => setToast(null), 3600)
          }
        } else {
          setToast({
            message: 'Upload complete',
            tone: 'success',
          })
          setToastVisible(true)
          setTimeout(() => setToastVisible(false), 3000)
          setTimeout(() => setToast(null), 3600)
        }
      } catch (err) {
        console.error('Action error:', err)
        
        let errorMessage = 'An error occurred'
        
        // Check for various error types
        if (err instanceof Error) {
          const errorStr = err.toString()
          if (errorStr.includes('Body exceeded') || errorStr.includes('413')) {
            errorMessage = 'File too large (max 4MB)'
          } else if (err.message) {
            errorMessage = err.message
          }
        } else if (typeof err === 'object' && err !== null) {
          // Check for error object with statusCode
          const errorObj = err as Record<string, any>
          if (errorObj.statusCode === 413 || errorObj.message?.includes('Body exceeded')) {
            errorMessage = 'File too large (max 4MB)'
          } else if (errorObj.message) {
            errorMessage = errorObj.message
          }
        }
        
        setToast({
          message: errorMessage,
          tone: 'error',
        })
        setToastVisible(true)
        setTimeout(() => setToastVisible(false), 3000)
        setTimeout(() => setToast(null), 3600)
      }
    })
  }

  return (
    <>
      {toast && (
        <div
          className={`fixed inset-x-0 top-14 z-50 ${
            toast.tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
          style={{
            pointerEvents: 'none',
            opacity: toastVisible ? 1 : 0,
            transition: 'opacity 600ms ease-out',
          }}
        >
          <div className="px-4 py-2 text-center text-sm font-semibold">{toast.message}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {children}
      </form>
    </>
  )
}
