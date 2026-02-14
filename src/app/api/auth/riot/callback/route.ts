import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/service'
import { getSupabaseConfig, getSupabaseCookieDomain, getSupabaseCookieNameBase } from '@/lib/supabase/config'

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

async function fetchRiotAccountMe(accessToken: string) {
  const endpoint = process.env.RIOT_ACCOUNT_ME_URL?.trim() || 'https://americas.api.riotgames.com/riot/account/v1/accounts/me'
  const res = await fetch(endpoint, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  if (!res.ok) return null
  const data = await res.json()
  const gameName = typeof data?.gameName === 'string' ? data.gameName.trim() : null
  const tagLine = typeof data?.tagLine === 'string' ? data.tagLine.trim() : null
  return { gameName, tagLine }
}

async function fetchRiotSummonerMe(accessToken: string) {
  const configured = process.env.RIOT_SUMMONER_ME_URL?.trim()
  const fallbackHosts = ['na1', 'euw1', 'eun1', 'kr', 'br1', 'jp1', 'la1', 'la2', 'oc1', 'tr1', 'ru']
  const endpoints = configured
    ? [configured]
    : fallbackHosts.map((host) => `https://${host}.api.riotgames.com/lol/summoner/v4/summoners/me`)

  for (const endpoint of endpoints) {
    const res = await fetch(endpoint, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    })
    if (!res.ok) continue

    const data = await res.json()
    const profileIconId = typeof data?.profileIconId === 'number' ? data.profileIconId : null
    const puuid = typeof data?.puuid === 'string' ? data.puuid : null
    return { profileIconId, puuid }
  }

  return null
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

    const accountMe = await fetchRiotAccountMe(accessToken)
    const summonerMe = await fetchRiotSummonerMe(accessToken)
    const riotDisplay =
      (accountMe?.gameName && accountMe?.tagLine ? `${accountMe.gameName}#${accountMe.tagLine}` : undefined) ??
      (riotUser.preferred_username as string | undefined) ??
      (riotUser.game_name && riotUser.tag_line ? `${riotUser.game_name}#${riotUser.tag_line}` : undefined) ??
      null
    const email = (riotUser.email as string | undefined) ?? `${riotSub}@riot.local`

    const supabaseAdmin = createServiceClient()

    const created = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        riot_sub: riotSub,
        ...(accountMe?.gameName ? { riot_game_name: accountMe.gameName } : {}),
        ...(accountMe?.tagLine ? { riot_tag_line: accountMe.tagLine } : {}),
        ...(summonerMe?.puuid ? { riot_puuid: summonerMe.puuid } : {}),
        ...(typeof summonerMe?.profileIconId === 'number' ? { riot_profile_icon_id: summonerMe.profileIconId } : {}),
        ...(riotDisplay ? { full_name: riotDisplay } : {}),
      },
    })

    let userId = created.data.user?.id ?? null
    if (created.error) {
      const alreadyExists = /already been registered|already exists|already registered/i.test(created.error.message || '')
      if (!alreadyExists) {
        return NextResponse.json({ error: 'Create user failed', details: created.error.message }, { status: 400 })
      }

      const listed = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (listed.error) {
        return NextResponse.json({ error: 'List users failed', details: listed.error.message }, { status: 400 })
      }
      userId = listed.data.users.find((u) => u.email === email)?.id ?? null
    }

    if (userId && riotDisplay) {
      await supabaseAdmin
        .from('profiles')
        .upsert({ user_id: userId, username: riotDisplay.slice(0, 24), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          riot_sub: riotSub,
          ...(accountMe?.gameName ? { riot_game_name: accountMe.gameName } : {}),
          ...(accountMe?.tagLine ? { riot_tag_line: accountMe.tagLine } : {}),
          ...(summonerMe?.puuid ? { riot_puuid: summonerMe.puuid } : {}),
          ...(typeof summonerMe?.profileIconId === 'number' ? { riot_profile_icon_id: summonerMe.profileIconId } : {}),
          ...(riotDisplay ? { full_name: riotDisplay } : {}),
        },
      })
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

    const parsedAction = new URL(actionLink)
    const linkProps = link.data?.properties as {
      hashed_token?: string
      verification_type?: string
    } | undefined

    let tokenHash = linkProps?.hashed_token ?? parsedAction.searchParams.get('token_hash')
    let tokenType = linkProps?.verification_type ?? parsedAction.searchParams.get('type')
    const hashParams = new URLSearchParams(parsedAction.hash.startsWith('#') ? parsedAction.hash.slice(1) : '')
    if (!tokenHash) tokenHash = hashParams.get('token_hash')
    if (!tokenType) tokenType = hashParams.get('type')

    const requestUrl = new URL(req.url)
    const isProduction = process.env.NODE_ENV === 'production'
    const host = req.headers.get('host')
    const resolvedHost = host?.split(':')[0] ?? null
    const fallbackDomain = resolvedHost?.endsWith('cwf.lol') ? '.cwf.lol' : null
    const cookieDomain = getSupabaseCookieDomain() ?? fallbackDomain
    const cookieNameBase = getSupabaseCookieNameBase()

    const sessionResponse = NextResponse.redirect(redirectTo)
    const { url: supabaseUrl, key } = getSupabaseConfig()
    const supabase = createServerClient(supabaseUrl, key, {
      cookies: {
        getAll() {
          const cookieHeader = req.headers.get('cookie') || ''
          return cookieHeader
            .split(';')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((entry) => {
              const idx = entry.indexOf('=')
              if (idx < 0) return { name: entry, value: '' }
              return { name: entry.slice(0, idx), value: entry.slice(idx + 1) }
            })
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const finalName = cookieNameBase ? name.replace(/^sb-[^-]+/, cookieNameBase) : name
            sessionResponse.cookies.set(finalName, value, {
              ...options,
              domain: cookieDomain ?? options?.domain,
              sameSite: 'lax',
              secure: isProduction,
            })
          })
        },
      },
    })

    const normalizedType = tokenType === 'magiclink' || tokenType === 'email' ? tokenType : null

    if (tokenHash && normalizedType) {
      const verified = await supabase.auth.verifyOtp({ type: normalizedType, token_hash: tokenHash })
      if (verified.error) {
        return NextResponse.json({ error: 'verifyOtp failed', details: verified.error.message }, { status: 400 })
      }

      const verifiedUserId = verified.data.user?.id ?? userId
      if (verifiedUserId) {
        if (riotDisplay) {
          await supabaseAdmin
            .from('profiles')
            .upsert({ user_id: verifiedUserId, username: riotDisplay.slice(0, 24), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
        }

        await supabaseAdmin.auth.admin.updateUserById(verifiedUserId, {
          user_metadata: {
            riot_sub: riotSub,
            ...(accountMe?.gameName ? { riot_game_name: accountMe.gameName } : {}),
            ...(accountMe?.tagLine ? { riot_tag_line: accountMe.tagLine } : {}),
            ...(summonerMe?.puuid ? { riot_puuid: summonerMe.puuid } : {}),
            ...(typeof summonerMe?.profileIconId === 'number' ? { riot_profile_icon_id: summonerMe.profileIconId } : {}),
            ...(riotDisplay ? { full_name: riotDisplay } : {}),
          },
        })
      }
    } else {
      return NextResponse.json(
        {
          error: 'Missing token_hash/type in generated action link',
          details: {
            has_hashed_token: !!linkProps?.hashed_token,
            verification_type: linkProps?.verification_type ?? null,
            action_link_has_query_token_hash: parsedAction.searchParams.has('token_hash'),
            action_link_has_hash_token_hash: hashParams.has('token_hash'),
          },
        },
        { status: 400 }
      )
    }

    sessionResponse.headers.set('cache-control', 'no-store')
    sessionResponse.cookies.set('dashboard_flash', JSON.stringify({
      kind: 'auth',
      tone: 'success',
      message: 'Signed in with Riot. Finish profile setup in Dashboard.'
    }), {
      path: '/',
      maxAge: 120,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    })
    sessionResponse.cookies.set('riot_oauth_state', '', { path: '/', maxAge: 0 })
    sessionResponse.cookies.set('riot_oauth_next', '', { path: '/', maxAge: 0 })
    return sessionResponse
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : 'unknown_error')
    return NextResponse.redirect(`/sign-in?error=${message}`)
  }
}
