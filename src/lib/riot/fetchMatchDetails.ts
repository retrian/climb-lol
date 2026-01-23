import { getRiotApiKey } from './getRiotApiKey'
import { riotFetchWithRetry } from './riotFetchWithRetry'

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

const MATCH_DETAILS_CACHE = new Map<
  string,
  { value: MatchDetails; expiresAt: number }
>()
const MATCH_DETAILS_TTL_MS = 5 * 60 * 1000
const MATCH_DETAILS_MAX = 50

function getCachedMatchDetails(matchId: string): MatchDetails | null {
  const entry = MATCH_DETAILS_CACHE.get(matchId)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    MATCH_DETAILS_CACHE.delete(matchId)
    return null
  }
  return entry.value
}

function setCachedMatchDetails(matchId: string, value: MatchDetails) {
  MATCH_DETAILS_CACHE.set(matchId, { value, expiresAt: Date.now() + MATCH_DETAILS_TTL_MS })
  if (MATCH_DETAILS_CACHE.size <= MATCH_DETAILS_MAX) return
  const overflow = MATCH_DETAILS_CACHE.size - MATCH_DETAILS_MAX
  const keys = Array.from(MATCH_DETAILS_CACHE.keys()).slice(0, overflow)
  keys.forEach((key) => MATCH_DETAILS_CACHE.delete(key))
}

function getRoutingFromMatchId(matchId: string) {
  const platform = matchId.split('_')[0]?.toUpperCase()
  if (!platform) return null
  return ROUTING_BY_PLATFORM[platform] ?? null
}

async function riotFetch<T>(url: string, apiKey: string): Promise<T | null> {
  try {
    return await riotFetchWithRetry<T>(url, apiKey, { maxRetries: 2, retryDelay: 2000 })
  } catch (error) {
    // Silently fail for server-side preloading - we'll fetch on demand if needed
    console.warn(`[fetchMatchDetails] Failed to fetch ${url}:`, error instanceof Error ? error.message : error)
    return null
  }
}

export interface MatchDetails {
  match: any | null
  timeline: any | null
  accounts: Record<string, { gameName: string; tagLine: string }>
}

export async function fetchMatchDetails(matchId: string): Promise<MatchDetails> {
  const cached = getCachedMatchDetails(matchId)
  if (cached) return cached

  const routing = getRoutingFromMatchId(matchId)
  if (!routing) {
    const empty = { match: null, timeline: null, accounts: {} }
    setCachedMatchDetails(matchId, empty)
    return empty
  }

  const apiKey = getRiotApiKey()
  if (!apiKey) {
    const empty = { match: null, timeline: null, accounts: {} }
    setCachedMatchDetails(matchId, empty)
    return empty
  }

  // Fetch match data
  const match = await riotFetch(
    `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
    apiKey,
  )

  if (!match) {
    const empty = { match: null, timeline: null, accounts: {} }
    setCachedMatchDetails(matchId, empty)
    return empty
  }

  // Fetch timeline and accounts in parallel
  // Note: Account API always uses 'americas' routing regardless of region
  const [timeline, accountResults] = await Promise.all([
    riotFetch(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}/timeline`,
      apiKey,
    ),
    Promise.allSettled(
      (match as any).metadata.participants.map((puuid: string) =>
        riotFetch(
          `https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
          apiKey,
        ).then((account) => [puuid, account] as const)
      )
    ),
  ])

  // Process account results
  const accounts: Record<string, { gameName: string; tagLine: string }> = {}
  accountResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value) {
      const [puuid, account] = result.value
      if (account && (account as any).gameName && (account as any).tagLine) {
        accounts[puuid] = {
          gameName: (account as any).gameName,
          tagLine: (account as any).tagLine,
        }
      }
    }
  })

  const result = {
    match,
    timeline: timeline || null,
    accounts,
  }
  setCachedMatchDetails(matchId, result)
  return result
}
