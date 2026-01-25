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

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600'
const TIMELINE_DB_TTL_MS = 24 * 60 * 60 * 1000
const TIMELINE_IN_FLIGHT = new Map<string, Promise<any>>()

function buildCacheHeaders(status: 'HIT' | 'HIT-DB' | 'HIT-INFLIGHT' | 'MISS') {
  return {
    'Cache-Control': CACHE_CONTROL,
    'X-Cache': status,
  }
}

function isFresh(timestamp: string | null | undefined, ttlMs: number) {
  if (!timestamp) return false
  const ts = new Date(timestamp).getTime()
  return Number.isFinite(ts) && Date.now() - ts < ttlMs
}

async function getDbCachedTimeline(matchId: string) {
  const service = createServiceClient()
  const { data, error } = await service
    .from('match_cache')
    .select('timeline_json, timeline_fetched_at')
    .eq('match_id', matchId)
    .maybeSingle()

  if (error) {
    console.error('[Timeline Cache] read error', error.message)
    return null
  }

  if (data?.timeline_json && isFresh(data.timeline_fetched_at, TIMELINE_DB_TTL_MS)) {
    return data.timeline_json
  }

  return null
}

async function upsertDbTimeline(matchId: string, timeline: any) {
  const service = createServiceClient()
  const now = new Date().toISOString()
  const { error } = await service
    .from('match_cache')
    .upsert(
      {
        match_id: matchId,
        timeline_json: timeline,
        timeline_fetched_at: now,
        updated_at: now,
      },
      { onConflict: 'match_id' }
    )

  if (error) {
    console.error('[Timeline Cache] write error', error.message)
  }
}

function getRoutingFromMatchId(matchId: string) {
  const platform = matchId.split('_')[0]?.toUpperCase()
  if (!platform) return null
  return ROUTING_BY_PLATFORM[platform] ?? null
}

export async function GET(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params
    const dbCached = await getDbCachedTimeline(matchId)
    if (dbCached) {
      return NextResponse.json({ timeline: dbCached }, { headers: buildCacheHeaders('HIT-DB') })
    }

    const inFlight = TIMELINE_IN_FLIGHT.get(matchId)
    if (inFlight) {
      const timeline = await inFlight
      return NextResponse.json({ timeline }, { headers: buildCacheHeaders('HIT-INFLIGHT') })
    }

    const routing = getRoutingFromMatchId(matchId)
    if (!routing) return NextResponse.json({ error: 'Unsupported match id' }, { status: 400 })
    const apiKey = getRiotApiKey()
    const fetchPromise = (async () => {
      const timeline = await riotFetchWithRetry(
        `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
        apiKey,
        { maxRetries: 3, retryDelay: 2000 }
      )
      await upsertDbTimeline(matchId, timeline)
      return timeline
    })().finally(() => {
      TIMELINE_IN_FLIGHT.delete(matchId)
    })

    TIMELINE_IN_FLIGHT.set(matchId, fetchPromise)
    const timeline = await fetchPromise
    return NextResponse.json({ timeline }, { headers: buildCacheHeaders('MISS') })
  } catch (error) {
    console.error('[Riot Timeline API]', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch timeline'
    const status = errorMessage.includes('Rate limit') ? 429 : 500
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
