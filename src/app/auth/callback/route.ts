import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig } from '@/lib/supabase/config'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=missing_code`)
  }

  // Optional: Support 'next' parameter for post-auth redirect
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  const redirectUrl = new URL(next, requestUrl.origin)
  const response = NextResponse.redirect(redirectUrl)

  const { url, key } = getSupabaseConfig()
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
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

  response.headers.set('cache-control', 'no-store')
  return response
}
