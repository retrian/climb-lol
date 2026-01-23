import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'
import { riotFetchWithRetry } from '@/lib/riot/riotFetchWithRetry'

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
const CACHE_CONTROL = 'public, s-maxage=120, stale-while-revalidate=300'

function buildCacheHeaders(isHit: boolean) {
  return {
    'Cache-Control': CACHE_CONTROL,
    'X-Cache': isHit ? 'HIT' : 'MISS',
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

export async function GET(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params
    const cached = getCachedMatch(matchId)
    if (cached) {
      return NextResponse.json({ match: cached }, { headers: buildCacheHeaders(true) })
    }
    const routing = getRoutingFromMatchId(matchId)
    if (!routing) return NextResponse.json({ error: 'Unsupported match id' }, { status: 400 })
    const apiKey = getRiotApiKey()
    const match = await riotFetchWithRetry(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      apiKey,
      { maxRetries: 3, retryDelay: 2000 }
    )
    setCachedMatch(matchId, match)
    return NextResponse.json({ match }, { headers: buildCacheHeaders(false) })
  } catch (error) {
    console.error('[Match API]', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch match'
    const status = errorMessage.includes('Rate limit') ? 429 : 500
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
