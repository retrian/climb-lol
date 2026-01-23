import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, getSupabaseCookieDomain, getSupabaseCookieNameBase } from '@/lib/supabase/config'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=missing_code`)
  }

  // Optional: Support 'next' parameter for post-auth redirect
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

  // Create response object that we'll modify with cookies
  const response = NextResponse.redirect(redirectUrl)

  const { url, key } = getSupabaseConfig()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        const meta = cookiesToSet.map(({ name, options }) => ({
          name,
          finalName: cookieNameBase ? name.replace(/^sb-[^-]+/, cookieNameBase) : name,
          domain: options?.domain,
          path: options?.path,
          sameSite: options?.sameSite,
          secure: options?.secure,
        }))
        console.info('[auth/callback] setAll cookies:', meta)
        
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
          
          console.info('[auth/callback] set-cookie:', finalName, resolvedOptions)
          
          // Set cookies on the response object
          response.cookies.set(finalName, value, resolvedOptions)
        })
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('[auth/callback] OAuth exchange failed:', error.message)
    const message = encodeURIComponent(error.message || 'oauth_failed')
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=${message}`)
  }

  console.info('[auth/callback] exchangeCodeForSession ok')
  console.info('[auth/callback] response cookies:', response.cookies.getAll().map(c => c.name))

  response.headers.set('cache-control', 'no-store')
  
  return response
}