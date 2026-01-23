import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, getSupabaseCookieDomain, getSupabaseCookieNameBase } from '@/lib/supabase/config'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  console.info('[auth/callback] Full URL:', request.url)
  console.info('[auth/callback] Code present:', !!code)

  if (!code) {
    console.error('[auth/callback] No code in URL')
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=missing_code`)
  }

  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const redirectUrl = new URL(next, requestUrl.origin)
  
  const host = request.headers.get('host')
  const resolvedHost = host?.split(':')[0] ?? null
  const fallbackDomain = resolvedHost?.endsWith('cwf.lol') ? '.cwf.lol' : null
  const cookieDomain = getSupabaseCookieDomain() ?? fallbackDomain
  const cookieNameBase = getSupabaseCookieNameBase()
  
  console.info('[auth/callback] host:', host)
  console.info('[auth/callback] cookieDomain:', cookieDomain ?? '(unset)')
  console.info('[auth/callback] cookieNameBase:', cookieNameBase ?? '(unset)')
  console.info('[auth/callback] incoming cookies:', request.cookies.getAll().map(c => c.name))

  const response = NextResponse.redirect(redirectUrl)

  const { url, key } = getSupabaseConfig()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        const cookies = request.cookies.getAll()
        console.info('[auth/callback] getAll cookies called, returning:', cookies.map(c => c.name))
        return cookies
      },
      setAll(cookiesToSet) {
        console.info('[auth/callback] setAll called with', cookiesToSet.length, 'cookies')
        
        cookiesToSet.forEach(({ name, value, options }) => {
          const finalName = cookieNameBase
            ? name.replace(/^sb-[^-]+/, cookieNameBase)
            : name
          
          const resolvedOptions = {
            ...options,
            domain: cookieDomain ?? options?.domain,
            sameSite: 'lax' as const,
            secure: true,
          }
          
          console.info('[auth/callback] Setting cookie:', {
            originalName: name,
            finalName,
            valueLength: value?.length || 0,
            maxAge: options?.maxAge,
            ...resolvedOptions
          })
          
          response.cookies.set(finalName, value, resolvedOptions)
        })
      },
    },
  })

  console.info('[auth/callback] Calling exchangeCodeForSession...')
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] OAuth exchange failed:', {
      message: error.message,
      status: error.status,
      name: error.name
    })
    const message = encodeURIComponent(error.message || 'oauth_failed')
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=${message}`)
  }

  console.info('[auth/callback] exchangeCodeForSession SUCCESS')
  console.info('[auth/callback] Session data:', {
    hasSession: !!data.session,
    hasUser: !!data.user,
    userId: data.user?.id,
    expiresAt: data.session?.expires_at
  })
  console.info('[auth/callback] Response cookies after exchange:', response.cookies.getAll().map(c => ({
    name: c.name,
    valueLength: c.value.length,
    maxAge: c.maxAge
  })))

  response.headers.set('cache-control', 'no-store')
  
  return response
}