'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function AuthButtons({ signedIn }: { signedIn: boolean }) {
  const router = useRouter()

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.refresh()
  }

  if (!signedIn) {
    return (
      <Link 
        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50" 
        href="/sign-in"
      >
        Sign in
      </Link>
    )
  }

  return (
    <button 
      onClick={signOut} 
      className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
    >
      Sign out
    </button>
  )
}