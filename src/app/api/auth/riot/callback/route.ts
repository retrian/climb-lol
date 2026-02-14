import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code) {
      return NextResponse.json({ error: 'Missing code' }, { status: 400 })
    }

    const cookieHeader = req.headers.get('cookie') || ''
    const stateMatch = cookieHeader.match(/(?:^|;\s*)riot_oauth_state=([^;]+)/)
    const expectedState = stateMatch?.[1]

    if (!state || !expectedState || state !== expectedState) {
      return NextResponse.json({ error: 'Invalid state' }, { status: 400 })
    }

    const redirectUri = requiredEnv('RIOT_REDIRECT_URI')
    const clientId = requiredEnv('RIOT_CLIENT_ID')
    const clientSecret = requiredEnv('RIOT_CLIENT_SECRET')
    const tokenEndpoint = process.env.RIOT_TOKEN_URL?.trim() || 'https://auth.riotgames.com/token'
    const userInfoEndpoint = process.env.RIOT_USERINFO_URL?.trim() || 'https://auth.riotgames.com/userinfo'

    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
    })

    if (!tokenRes.ok) {
      const details = await tokenRes.text()
      return NextResponse.json({ error: 'Token exchange failed', details }, { status: 400 })
    }

    const tokens = await tokenRes.json()
    const accessToken = tokens.access_token as string | undefined
    if (!accessToken) {
      return NextResponse.json({ error: 'No access_token returned' }, { status: 400 })
    }

    const userRes = await fetch(userInfoEndpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })

    if (!userRes.ok) {
      const details = await userRes.text()
      return NextResponse.json({ error: 'Userinfo failed', details }, { status: 400 })
    }

    const riotUser = await userRes.json()
    const riotSub = riotUser.sub as string | undefined
    if (!riotSub) {
      return NextResponse.json({ error: 'No riot sub in userinfo' }, { status: 400 })
    }

    const email = (riotUser.email as string | undefined) ?? `${riotSub}@riot.local`

    const supabaseAdmin = createServiceClient()

    const listed = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listed.error) {
      return NextResponse.json({ error: 'List users failed', details: listed.error.message }, { status: 400 })
    }

    const found = listed.data.users.find((u) => u.email === email)

    if (!found) {
      const created = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: {
          riot_sub: riotSub,
        },
      })

      if (created.error) {
        return NextResponse.json({ error: 'Create user failed', details: created.error.message }, { status: 400 })
      }
    }

    const postLogin = process.env.APP_POST_LOGIN_REDIRECT?.trim() || 'https://cwf.lol/dashboard'
    const nextCookie = cookieHeader.match(/(?:^|;\s*)riot_oauth_next=([^;]+)/)?.[1]
    let redirectTo = postLogin
    if (nextCookie) {
      const decoded = decodeURIComponent(nextCookie)
      if (decoded.startsWith('/')) {
        const origin = new URL(postLogin).origin
        redirectTo = new URL(decoded, origin).toString()
      }
    }
    const link = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo },
    })

    const actionLink = link.data?.properties?.action_link
    if (!actionLink) {
      return NextResponse.json(
        { error: 'Magic link generation failed', details: link.error?.message ?? 'missing_action_link' },
        { status: 400 }
      )
    }

    const response = NextResponse.redirect(actionLink)
    response.cookies.set('riot_oauth_state', '', { path: '/', maxAge: 0 })
    response.cookies.set('riot_oauth_next', '', { path: '/', maxAge: 0 })
    return response
  } catch (error) {
    return NextResponse.json(
      { error: 'Riot callback failed', details: error instanceof Error ? error.message : 'unknown_error' },
      { status: 500 }
    )
  }
}
