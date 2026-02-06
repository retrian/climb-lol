import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'
import { riotFetchWithRetry } from '@/lib/riot/riotFetchWithRetry'
import { createServiceClient } from '@/lib/supabase/service'

const ROUTING_BY_PLATFORM: Record<string, string> = {
  NA1: 'americas',
  BR1: 'americas',
  LA1: 'americas',
  LA2: 'americas',
  OC1: 'sea',
  KR: 'asia',
  JP1: 'asia',
  EUN1: 'europe',
  EUW1: 'europe',
  TR1: 'europe',
  RU: 'europe',
  PH2: 'sea',
  SG2: 'sea',
  TH2: 'sea',
  TW2: 'sea',
  VN2: 'sea',
}

function getRoutingFromMatchId(matchId: string) {
  const platform = matchId.split('_')[0]?.toUpperCase()
  if (!platform) return null
  return ROUTING_BY_PLATFORM[platform] ?? null
}

const MATCH_CACHE = new Map<string, { value: any; expiresAt: number }>()
const MATCH_CACHE_TTL_MS = 2 * 60 * 1000
const MATCH_CACHE_MAX = 100
const MATCH_DB_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600'
const MATCH_IN_FLIGHT = new Map<string, Promise<any>>()

function buildCacheHeaders(status: 'HIT' | 'HIT-DB' | 'HIT-INFLIGHT' | 'MISS') {
  return {
    'Cache-Control': CACHE_CONTROL,
    'X-Cache': status,
  }
}

function getCachedMatch(matchId: string) {
  const entry = MATCH_CACHE.get(matchId)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    MATCH_CACHE.delete(matchId)
    return null
  }
  return entry.value
}

function setCachedMatch(matchId: string, value: any) {
  MATCH_CACHE.set(matchId, { value, expiresAt: Date.now() + MATCH_CACHE_TTL_MS })
  if (MATCH_CACHE.size <= MATCH_CACHE_MAX) return
  const overflow = MATCH_CACHE.size - MATCH_CACHE_MAX
  const keys = Array.from(MATCH_CACHE.keys()).slice(0, overflow)
  keys.forEach((key) => MATCH_CACHE.delete(key))
}

function isFresh(timestamp: string | null | undefined, ttlMs: number) {
  if (!timestamp) return false
  const ts = new Date(timestamp).getTime()
  return Number.isFinite(ts) && Date.now() - ts < ttlMs
}

function getEndType(info: any): 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL' {
  if (!info) return 'NORMAL'
  if (Number(info.gameDuration ?? 0) < 300) return 'REMAKE'
  if (info.gameEndedInEarlySurrender) return 'EARLY_SURRENDER'
  if (info.gameEndedInSurrender) return 'SURRENDER'
  return 'NORMAL'
}

async function upsertMatchParticipants(matchId: string, match: any) {
  const service = createServiceClient()
  const info = match?.info
  const meta = match?.metadata
  if (!info || !meta?.matchId) return

  const { data: existingLp, error: existingError } = await service
    .from('match_participants')
    .select('puuid, lp_change, lp_note, rank_tier, rank_division')
    .eq('match_id', matchId)

  if (existingError) {
    console.warn('[Match Cache] lp lookup error', existingError.message)
  }

  const lpByPuuid = new Map(
    (existingLp ?? []).map((row: any) => [row.puuid, row])
  )

  const endType = getEndType(info)
  const participants = (info.participants as any[]) ?? []
  const upserts = participants.map((part) => {
    const existing = lpByPuuid.get(part.puuid)
    return {
      match_id: meta.matchId,
      puuid: part.puuid,
      champion_id: Number(part.championId ?? 0),
      kills: Number(part.kills ?? 0),
      deaths: Number(part.deaths ?? 0),
      assists: Number(part.assists ?? 0),
      cs: Number((part.totalMinionsKilled ?? 0) + (part.neutralMinionsKilled ?? 0)),
      win: Boolean(part.win),
      vision_score: Number(part.visionScore ?? 0),
      end_type: endType,
      lp_change: existing?.lp_change ?? null,
      lp_note: existing?.lp_note ?? null,
      rank_tier: existing?.rank_tier ?? null,
      rank_division: existing?.rank_division ?? null,
    }
  })

  if (upserts.length === 0) return

  const { error } = await service
    .from('match_participants')
    .upsert(upserts, { onConflict: 'match_id,puuid' })

  if (error) {
    console.warn('[Match Cache] participants upsert error', error.message)
  }
}

async function upsertMatchMeta(match: any) {
  const service = createServiceClient()
  const info = match?.info
  const meta = match?.metadata
  if (!info || !meta?.matchId) return

  const gameEndTs = Number(info.gameEndTimestamp ?? (info.gameStartTimestamp + info.gameDuration * 1000))

  const { error } = await service
    .from('matches')
    .upsert(
      [{
        match_id: meta.matchId,
        queue_id: Number(info.queueId ?? 0),
        game_end_ts: gameEndTs,
        game_duration_s: Number(info.gameDuration ?? 0),
      }],
      { onConflict: 'match_id' }
    )

  if (error) {
    console.warn('[Match Cache] matches upsert error', error.message)
  }
}

async function getDbCachedMatch(matchId: string) {
  const service = createServiceClient()
  const { data, error } = await service
    .from('match_cache')
    .select('match_json, match_fetched_at')
    .eq('match_id', matchId)
    .maybeSingle()

  if (error) {
    console.error('[Match Cache] read error', error.message)
    return null
  }

  if (data?.match_json && isFresh(data.match_fetched_at, MATCH_DB_TTL_MS)) {
    return data.match_json
  }

  return null
}

async function upsertDbMatch(matchId: string, match: any) {
  const service = createServiceClient()
  const now = new Date().toISOString()
  const { error } = await service
    .from('match_cache')
    .upsert(
      {
        match_id: matchId,
        match_json: match,
        match_fetched_at: now,
        updated_at: now,
      },
      { onConflict: 'match_id' }
    )

  if (error) {
    console.error('[Match Cache] write error', error.message)
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params
    const url = new URL(request.url)
    const forceRefresh = url.searchParams.has('refresh')

    if (forceRefresh) {
      const routing = getRoutingFromMatchId(matchId)
      if (!routing) return NextResponse.json({ error: 'Unsupported match id' }, { status: 400 })
      const apiKey = getRiotApiKey()
      const match = await riotFetchWithRetry(
        `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        apiKey,
        { maxRetries: 3, retryDelay: 2000 }
      )
      setCachedMatch(matchId, match)
      await Promise.all([
        upsertDbMatch(matchId, match),
        upsertMatchMeta(match),
        upsertMatchParticipants(matchId, match),
      ])
      return NextResponse.json({ match }, { headers: buildCacheHeaders('MISS') })
    }

    const cached = getCachedMatch(matchId)
    if (cached) {
      return NextResponse.json({ match: cached }, { headers: buildCacheHeaders('HIT') })
    }
    const dbCached = await getDbCachedMatch(matchId)
    if (dbCached) {
      setCachedMatch(matchId, dbCached)
      return NextResponse.json({ match: dbCached }, { headers: buildCacheHeaders('HIT-DB') })
    }

    const inFlight = MATCH_IN_FLIGHT.get(matchId)
    if (inFlight) {
      const match = await inFlight
      return NextResponse.json({ match }, { headers: buildCacheHeaders('HIT-INFLIGHT') })
    }

    const routing = getRoutingFromMatchId(matchId)
    if (!routing) return NextResponse.json({ error: 'Unsupported match id' }, { status: 400 })
    const apiKey = getRiotApiKey()
    const fetchPromise = (async () => {
      const match = await riotFetchWithRetry(
        `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
        apiKey,
        { maxRetries: 3, retryDelay: 2000 }
      )
      setCachedMatch(matchId, match)
      await upsertDbMatch(matchId, match)
      return match
    })().finally(() => {
      MATCH_IN_FLIGHT.delete(matchId)
    })

    MATCH_IN_FLIGHT.set(matchId, fetchPromise)
    const match = await fetchPromise
    return NextResponse.json({ match }, { headers: buildCacheHeaders('MISS') })
  } catch (error) {
    console.error('[Match API]', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch match'
    const status = errorMessage.includes('Rate limit') ? 429 : 500
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
