'use client'

import { ReactNode, useState } from 'react'
import { useTransition } from 'react'

type PlayerFormAction = (formData: FormData) => Promise<{ success: boolean; message: string }>

export function PlayerFormWrapper({
  action,
  children,
  onSuccess,
}: {
  action: PlayerFormAction
  children: ReactNode
  onSuccess?: () => void
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
        
        // Handle the result
        if (result && typeof result === 'object' && 'success' in result && 'message' in result) {
          setToast({
            message: result.message,
            tone: result.success ? 'success' : 'error',
          })
          setToastVisible(true)
          if (result.success) {
            onSuccess?.()
            // Clear form
            form.reset()
            // Fade out after 3s, clear after 3.6s
            console.log('Success - scheduling fade at 3000ms')
            setTimeout(() => {
              console.log('Setting toastVisible to false')
              setToastVisible(false)
            }, 3000)
            setTimeout(() => {
              console.log('Clearing toast')
              setToast(null)
            }, 3600)
          } else {
            // Error case - also fade out
            console.log('Error result - scheduling fade at 3000ms')
            setTimeout(() => {
              console.log('Setting toastVisible to false')
              setToastVisible(false)
            }, 3000)
            setTimeout(() => {
              console.log('Clearing toast')
              setToast(null)
            }, 3600)
          }
        } else {
          // Unexpected result format
          console.error('Unexpected result format:', result)
          setToast({
            message: 'Action completed',
            tone: 'success',
          })
          setToastVisible(true)
          form.reset()
          setTimeout(() => setToastVisible(false), 3000)
          setTimeout(() => setToast(null), 3600)
        }
      } catch (err) {
        console.error('Action error:', err)
        setToast({
          message: 'An error occurred',
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

      <form onSubmit={handleSubmit}>
        {children}
      </form>
    </>
  )
}

