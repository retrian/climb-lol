import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'

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

async function riotFetch<T>(url: string, apiKey: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'X-Riot-Token': apiKey,
    },
    next: { revalidate: 300 },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Riot fetch failed ${res.status}: ${body.slice(0, 200)}`)
  }

  return res.json() as Promise<T>
}

export async function GET(_: Request, { params }: { params: Promise<{ matchId: string }> }) {
  try {
    const { matchId } = await params
    const routing = getRoutingFromMatchId(matchId)
    if (!routing) return NextResponse.json({ error: 'Unsupported match id' }, { status: 400 })
    const apiKey = getRiotApiKey()
    const match = await riotFetch(
      `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`,
      apiKey,
    )
    return NextResponse.json({ match })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch match' }, { status: 500 })
  }
}
