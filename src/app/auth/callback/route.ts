import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=missing_code`)
  }

  // OPTIMIZATION: Use existing server client helper instead of inline creation
  const supabase = await createClient()

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  
  if (error) {
    console.error('[auth/callback] OAuth exchange failed:', error.message)
    return NextResponse.redirect(`${requestUrl.origin}/sign-in?error=oauth_failed`)
  }

  // Optional: Support 'next' parameter for post-auth redirect
  const next = requestUrl.searchParams.get('next') || '/dashboard'
  return NextResponse.redirect(`${requestUrl.origin}${next}`)
}