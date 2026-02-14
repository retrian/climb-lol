export const AUTH_PROVIDERS = ['google', 'riot'] as const

export type AuthProvider = (typeof AUTH_PROVIDERS)[number]

export const DEFAULT_AUTH_PROVIDER: AuthProvider = 'google'

export function isAuthProvider(value: string | null | undefined): value is AuthProvider {
  return value === 'google' || value === 'riot'
}

export function parseAuthProvider(value: string | null | undefined): AuthProvider {
  if (!value) return DEFAULT_AUTH_PROVIDER
  return isAuthProvider(value) ? value : DEFAULT_AUTH_PROVIDER
}

export function isSafeNextPath(nextValue: unknown): nextValue is string {
  if (typeof nextValue !== 'string') return false
  if (!nextValue) return false
  if (!nextValue.startsWith('/')) return false
  if (nextValue.startsWith('//')) return false
  return true
}

export function resolveSafeRedirectTarget(nextValue: string | null | undefined, fallback = '/dashboard'): string {
  if (isSafeNextPath(nextValue)) return nextValue
  return fallback
}

export function buildAuthCallbackUrl(origin: string, opts?: { next?: string | null; provider?: AuthProvider }): string {
  const url = new URL('/auth/callback', origin)

  const next = opts?.next
  if (isSafeNextPath(next)) {
    url.searchParams.set('next', next)
  }

  if (opts?.provider && opts.provider !== DEFAULT_AUTH_PROVIDER) {
    url.searchParams.set('provider', opts.provider)
  }

  return url.toString()
}

export function getSupabaseOAuthProvider(provider: AuthProvider): string {
  if (provider === 'riot') {
    return process.env.NEXT_PUBLIC_RIOT_SUPABASE_PROVIDER?.trim() || 'riot'
  }

  return provider
}
