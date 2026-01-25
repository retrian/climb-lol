import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, getSupabaseCookieDomain, getSupabaseCookieNameBase } from './config'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })
  const { url, key } = getSupabaseConfig()
  const host = request.headers.get('host')
  const resolvedHost = host?.split(':')[0] ?? null
  const fallbackDomain = resolvedHost?.endsWith('cwf.lol') ? '.cwf.lol' : null
  const cookieDomain = getSupabaseCookieDomain() ?? fallbackDomain
  const cookieNameBase = getSupabaseCookieNameBase()
  
  console.info('[middleware] host:', host)
  console.info('[middleware] cookieDomain:', cookieDomain ?? '(unset)')
  console.info('[middleware] cookieNameBase:', cookieNameBase ?? '(unset)')
  console.info('[middleware] incoming cookies:', request.cookies.getAll().map((c) => c.name))

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          // Apply the same cookie name transformation as the callback route
          const finalName = cookieNameBase
            ? name.replace(/^sb-[^-]+/, cookieNameBase)
            : name
          
          const resolvedOptions = {
            ...options,
            domain: cookieDomain ?? options?.domain,
            sameSite: 'lax' as const,
            secure: true,
          }
          
          console.info('[middleware] set-cookie:', finalName, resolvedOptions)
          
          request.cookies.set(finalName, value)
          response.cookies.set(finalName, value, resolvedOptions)
        })
      },
    },
  })

  const { data, error } = await supabase.auth.getUser()
  if (error) {
    console.warn('[middleware] getUser error:', error.message)
  } else {
    console.info('[middleware] session user:', data.user?.id ?? '(none)')
  }
  
  return response
}
