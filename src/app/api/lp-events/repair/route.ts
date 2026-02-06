import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const RIOT_API_KEY = process.env.RIOT_API_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function riotGetJson(url: string, attempts = 4) {
  let lastErr: any
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(`Riot ${res.status}: ${txt}`)
      }
      return await res.json()
    } catch (e) {
      lastErr = e
      await sleep(300 * 2 ** (i - 1))
    }
  }
  throw lastErr
}

function queueIdFromQueueType(queueType?: string | null) {
  if (queueType === 'RANKED_SOLO_5x5') return 420
  if (queueType === 'RANKED_FLEX_SR') return 440
  return null
}

export async function POST(req: Request) {
  if (!RIOT_API_KEY) return NextResponse.json({ error: 'Missing RIOT_API_KEY' }, { status: 500 })
  if (!SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const body = await req.json().catch(() => null)
  const puuid = body?.puuid as string | undefined
  const wrongMatchId = body?.wrongMatchId as string | undefined
  const recordedAt = body?.recordedAt as string | undefined
  const queueType = body?.queueType as string | undefined

  if (!puuid || !wrongMatchId || !recordedAt) {
    return NextResponse.json({ error: 'puuid, wrongMatchId, recordedAt required' }, { status: 400 })
  }

  const recordedMs = Date.parse(recordedAt)
  if (Number.isNaN(recordedMs)) {
    return NextResponse.json({ error: 'recordedAt must be parseable date' }, { status: 400 })
  }

  const wantQueueId = queueIdFromQueueType(queueType)

  const idsUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/by-puuid/${encodeURIComponent(
    puuid
  )}/ids?count=50`

  const matchIds: string[] = await riotGetJson(idsUrl)

  let best: { matchId: string; diff: number; endTs: number } | null = null

  for (const matchId of matchIds) {
    const matchUrl = `https://americas.api.riotgames.com/lol/match/v5/matches/${encodeURIComponent(matchId)}`
    const match = await riotGetJson(matchUrl)

    const participants: string[] | undefined = match?.metadata?.participants
    if (!participants?.includes(puuid)) continue

    const q = match?.info?.queueId
    if (wantQueueId != null && q !== wantQueueId) continue

    const endTs: number | undefined = match?.info?.gameEndTimestamp
    if (!endTs) continue

    const diff = recordedMs - endTs
    if (diff < 0) continue

    if (!best || diff < best.diff) best = { matchId, diff, endTs }
  }

  if (!best) {
    return NextResponse.json(
      { error: 'No suitable match found to relink (try widening search/count or check recordedAt/queueType)' },
      { status: 404 }
    )
  }

  const { error } = await supabase
    .from('player_lp_events')
    .update({ match_id: best.matchId })
    .eq('puuid', puuid)
    .eq('match_id', wrongMatchId)
    .eq('recorded_at', recordedAt)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, newMatchId: best.matchId, matchEnd: new Date(best.endTs).toISOString() })
}
