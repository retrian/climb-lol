'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useRef, useState } from 'react'

export function AuthButtons({ signedIn, username }: { signedIn: boolean; username?: string | null }) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (event: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [menuOpen])

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  if (!signedIn) {
    return (
      <button
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        onClick={() => router.push('/sign-in')}
      >
        Sign in
      </button>
    )
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setMenuOpen(open => !open)}
        className="inline-flex items-center gap-2 rounded-none border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className="max-w-[140px] truncate">{username ?? 'Account'}</span>
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {menuOpen ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 min-w-full overflow-hidden rounded-none border border-gray-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-950"
        >
          <span
            role="menuitem"
            aria-disabled="true"
            className="flex w-full cursor-not-allowed items-center px-4 py-2 text-left text-sm font-medium text-gray-400 dark:text-slate-500"
          >
            Challenges
          </span>
          <button
            role="menuitem"
            onClick={() => {
              setMenuOpen(false)
              router.push('/dashboard')
            }}
            className="flex w-full items-center px-4 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            Dashboard
          </button>
          <button
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center px-4 py-2 text-left text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-900"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}
