import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, getSupabaseCookieDomain } from './config'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } })
  const { url, key } = getSupabaseConfig()
  const cookieDomain = getSupabaseCookieDomain()
  console.info('[middleware] host:', request.headers.get('host'))
  console.info('[middleware] incoming cookies:', request.cookies.getAll().map((c) => c.name))

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, {
              ...options,
              domain: cookieDomain ?? options?.domain,
            })
          })
        },
      },
    }
  )

  const { data, error } = await supabase.auth.getSession()
  if (error) {
    console.warn('[middleware] getSession error:', error.message)
  } else {
    console.info('[middleware] session user:', data.session?.user?.id ?? '(none)')
  }
  
  return response
}
