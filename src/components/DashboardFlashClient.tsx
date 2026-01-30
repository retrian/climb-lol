'use client'

import { useEffect, useState } from 'react'

type Flash = { kind: string; tone: 'success' | 'error'; message: string }

export default function DashboardFlashClient() {
  const [flash, setFlash] = useState<Flash | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      const raw = document.cookie.split('; ').find((c) => c.startsWith('dashboard_flash='))
      if (!raw) return
      const val = decodeURIComponent(raw.split('=')[1] || '')
      if (!val) return
      const parsed = JSON.parse(val) as Flash
      if (!parsed?.message || !parsed?.tone) return
      setFlash(parsed)
      
      // Use requestAnimationFrame to ensure the browser sees the initial state
      requestAnimationFrame(() => {
        setVisible(true)
        // clear cookie
        document.cookie = `dashboard_flash=; Path=/; Max-Age=0;`;
        const fadeTimer = setTimeout(() => setVisible(false), 3000)
        const clearTimer = setTimeout(() => setFlash(null), 3600)
        return () => {
          clearTimeout(fadeTimer)
          clearTimeout(clearTimer)
        }
      })
    } catch {
      // ignore
    }
  }, [])

  if (!flash) return null

  return (
    <div
      className={`fixed inset-x-0 top-14 z-50 ${
        flash.tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
      }`}
      style={{
        pointerEvents: 'none',
        opacity: visible ? 1 : 0,
        transition: 'opacity 600ms ease-out',
      }}
    >
      <div className="px-4 py-2 text-center text-sm font-semibold">{flash.message}</div>
    </div>
  )
}
