'use client'

import { buildAuthCallbackUrl, getSupabaseOAuthProvider, type AuthProvider } from '@/lib/auth/providers'
import { createClient } from '@/lib/supabase/client'
import { isRiotAuthEnabled } from '@/lib/supabase/config'
import type { Provider } from '@supabase/supabase-js'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

export default function SignInPage() {
  const searchParams = useSearchParams()
  const [hashError, setHashError] = useState<string | null>(null)
  const [hashErrorDescription, setHashErrorDescription] = useState<string | null>(null)
  const [loadingProvider, setLoadingProvider] = useState<AuthProvider | null>(null)
  const riotEnabled = isRiotAuthEnabled()
  
  const queryError = searchParams.get('error')
  const queryErrorDescription = searchParams.get('error_description')
  
  const error = useMemo(() => {
    const raw = queryError ?? hashError
    return raw ? decodeURIComponent(raw) : null
  }, [queryError, hashError])
  
  const errorDescription = useMemo(() => {
    const raw = queryErrorDescription ?? hashErrorDescription
    return raw ? decodeURIComponent(raw) : null
  }, [queryErrorDescription, hashErrorDescription])

  const next = searchParams.get('next')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hash = window.location.hash
    console.info('[sign-in] location:', window.location.href)
    if (!hash || !hash.startsWith('#')) return
    const params = new URLSearchParams(hash.slice(1))
    console.info('[sign-in] hash params:', Object.fromEntries(params.entries()))
    setHashError(params.get('error'))
    setHashErrorDescription(params.get('error_description'))
  }, [])

  const signIn = async (provider: AuthProvider) => {
    try {
      setLoadingProvider(provider)
      const supabase = createClient()
      
      // Get the current origin
      const origin = window.location.origin
      const redirectTo = buildAuthCallbackUrl(origin, { next, provider })
      const providerName = getSupabaseOAuthProvider(provider)
      
      console.info('[sign-in] Starting OAuth flow')
      console.info('[sign-in] Provider:', provider)
      console.info('[sign-in] Origin:', origin)
      console.info('[sign-in] Redirect URL:', redirectTo)

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: providerName as Provider,
        options: {
          redirectTo,
          queryParams:
            provider === 'google'
              ? {
                  access_type: 'offline',
                  prompt: 'consent',
                }
              : undefined,
        },
      })

      if (error) {
        console.error('[sign-in] OAuth error:', error)
        setHashError(error.message)
        setLoadingProvider(null)
        return
      }

      console.info('[sign-in] OAuth initiated successfully:', data)
      // The page should redirect automatically, but just in case:
      if (data?.url) {
        console.info('[sign-in] Manually redirecting to:', data.url)
        window.location.href = data.url
      }
    } catch (err) {
      console.error('[sign-in] Unexpected error:', err)
      setHashError('An unexpected error occurred')
      setLoadingProvider(null)
    }
  }

  const isLoadingGoogle = loadingProvider === 'google'
  const isLoadingRiot = loadingProvider === 'riot'
  const isAnyLoading = loadingProvider !== null

  return (
    <main className="flex min-h-screen items-center justify-center px-4 bg-gray-50 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">Sign in</h1>
          <p className="mt-2 text-gray-600 dark:text-slate-300">
            Sign in to create and manage your leaderboard.
          </p>
          
          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-semibold">Sign-in error</div>
              <div>{error}</div>
              {errorDescription ? <div className="mt-1 text-xs">{errorDescription}</div> : null}
            </div>
          ) : null}

          <button
            onClick={() => void signIn('google')}
            disabled={isAnyLoading}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {isLoadingGoogle ? (
              <>
                <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Signing in...
              </>
            ) : (
              <>
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {riotEnabled ? (
            <button
              onClick={() => void signIn('riot')}
              disabled={isAnyLoading}
              className="mt-3 flex w-full items-center justify-center gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 font-medium text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingRiot ? (
                'Connecting to Riot...'
              ) : (
                <>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="6" fill="currentColor" opacity="0.2" />
                    <path d="M7 17V7h5.6c2.2 0 3.8 1.3 3.8 3.3 0 1.4-.8 2.5-2 3l2.3 3.7h-2.5l-2-3.3H9.3V17H7zm2.3-5.1h3.1c1.1 0 1.8-.6 1.8-1.6s-.7-1.6-1.8-1.6H9.3v3.2z" fill="currentColor" />
                  </svg>
                  Continue with Riot
                </>
              )}
            </button>
          ) : null}
        </div>

        <p className="mt-4 text-center text-xs text-gray-500 dark:text-slate-400">
          By signing in, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </main>
  )
}
