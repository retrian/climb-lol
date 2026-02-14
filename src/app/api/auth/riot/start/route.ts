import { NextResponse } from 'next/server'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export async function GET(req: Request) {
  try {
    const requestUrl = new URL(req.url)
    const next = requestUrl.searchParams.get('next')
    const clientId = requiredEnv('RIOT_CLIENT_ID')
    const redirectUri = requiredEnv('RIOT_REDIRECT_URI')
    const scopes = process.env.RIOT_SCOPES?.trim() || 'openid'
    const authorizeUrl = new URL(process.env.RIOT_AUTHORIZE_URL?.trim() || 'https://auth.riotgames.com/authorize')

    const state = crypto.randomUUID()
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', scopes)
    authorizeUrl.searchParams.set('state', state)

    const response = NextResponse.redirect(authorizeUrl.toString())
    response.cookies.set('riot_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    })

    if (next && next.startsWith('/')) {
      response.cookies.set('riot_oauth_next', next, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 10,
      })
    }

    return response
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : 'riot_start_failed')
    return NextResponse.redirect(`/sign-in?error=${message}`)
  }
}
