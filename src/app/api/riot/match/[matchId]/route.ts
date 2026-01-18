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

export async function GET(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params
    const routing = getRoutingFromMatchId(matchId)
    if (!routing) return NextResponse.json({ error: 'Unsupported match id' }, { status: 400 })
    const apiKey = getRiotApiKey()
    const match = await riotFetchWithRetry(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      apiKey,
      { maxRetries: 3, retryDelay: 2000 }
    )
    return NextResponse.json({ match })
  } catch (error) {
    console.error('[Riot Match API]', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch match'
    const status = errorMessage.includes('Rate limit') ? 429 : 500
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
