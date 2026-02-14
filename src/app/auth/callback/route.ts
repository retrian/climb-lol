import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, getSupabaseCookieDomain, getSupabaseCookieNameBase } from '@/lib/supabase/config'
import { parseAuthProvider, resolveSafeRedirectTarget } from '@/lib/auth/providers'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const provider = parseAuthProvider(requestUrl.searchParams.get('provider'))
  const isProduction = process.env.NODE_ENV === 'production'

  if (provider === 'riot') {
    const riotCallback = new URL('/api/auth/riot/callback', requestUrl.origin)
    requestUrl.searchParams.forEach((value, key) => riotCallback.searchParams.set(key, value))
    return NextResponse.redirect(riotCallback)
  }

  console.info('[auth/callback] Full URL:', request.url)
  console.info('[auth/callback] Code present:', !!code)

  if (!code) {
    console.error('[auth/callback] No code in URL')
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=missing_code&provider=${provider}`)
  }

  const next = resolveSafeRedirectTarget(requestUrl.searchParams.get('next'), '/dashboard')
  const redirectUrl = new URL(next, requestUrl.origin)
  
  const host = request.headers.get('host')
  const resolvedHost = host?.split(':')[0] ?? null
  const fallbackDomain = resolvedHost?.endsWith('cwf.lol') ? '.cwf.lol' : null
  const cookieDomain = getSupabaseCookieDomain() ?? fallbackDomain
  const cookieNameBase = getSupabaseCookieNameBase()
  
  console.info('[auth/callback] host:', host)
  console.info('[auth/callback] provider:', provider)
  console.info('[auth/callback] cookieDomain:', cookieDomain ?? '(unset)')
  console.info('[auth/callback] cookieNameBase:', cookieNameBase ?? '(unset)')
  console.info('[auth/callback] incoming cookies:', request.cookies.getAll().map(c => c.name))

  const response = NextResponse.redirect(redirectUrl)

  const { url, key } = getSupabaseConfig()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          const finalName = cookieNameBase
            ? name.replace(/^sb-[^-]+/, cookieNameBase)
            : name
          
          request.cookies.set(name, value)
          response.cookies.set(finalName, value, {
            ...options,
            domain: cookieDomain ?? options?.domain,
            sameSite: 'lax',
            secure: isProduction,
          })
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
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=${message}&provider=${provider}`)
  }

  console.info('[auth/callback] exchangeCodeForSession SUCCESS')
  console.info('[auth/callback] Session data:', {
    hasSession: !!data.session,
    hasUser: !!data.user,
    userId: data.user?.id,
    expiresAt: data.session?.expires_at
  })

  // Manually set session cookies from the session data
  if (data.session) {
    const projectRef = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'unknown'
    
    console.info('[auth/callback] Manually setting session cookies')
    
    // Store the entire session as JSON (chunked if needed)
    const sessionString = JSON.stringify(data.session)
    const chunkSize = 3180 // Max cookie size per chunk
    const chunks = Math.ceil(sessionString.length / chunkSize)
    
    console.info('[auth/callback] Session size:', sessionString.length, 'bytes, chunks:', chunks)
    
    for (let i = 0; i < chunks; i++) {
      const chunk = sessionString.slice(i * chunkSize, (i + 1) * chunkSize)
      const cookieName = `sb-${projectRef}-auth-token${chunks > 1 ? `.${i}` : ''}`
      
      response.cookies.set(cookieName, chunk, {
        path: '/',
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        maxAge: 60 * 60 * 24 * 365, // 1 year
        sameSite: 'lax',
        secure: isProduction,
        httpOnly: false,
      })
      
      console.info('[auth/callback] Set chunk:', cookieName, 'size:', chunk.length)
    }
    
    console.info('[auth/callback] Final cookies:', response.cookies.getAll().map(c => c.name))
  }

  response.headers.set('cache-control', 'no-store')
  
  return response
}
