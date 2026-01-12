import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'

// 1. Define response types for type safety
interface SummonerResponse {
  id: string
  puuid: string
}

async function riotFetch<T>(url: string, apiKey: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: { 'X-Riot-Token': apiKey },
    cache: 'no-store', // Disable cache to prevent "poisoned" 403 errors
  })

  if (!res.ok) {
    if (res.status === 404) return null
    if (res.status === 403) {
      console.warn(`[Riot API] 403 Forbidden (Key Expired?): ${url}`)
      return null
    }
    const body = await res.text()
    console.error(`[Riot API] Error ${res.status}: ${body.slice(0, 100)}`)
    throw new Error(`Riot fetch failed ${res.status}`)
  }

  return res.json() as Promise<T>
}

export async function GET(_: Request, { params }: { params: Promise<{ platform: string; puuid: string }> }) {
  try {
    const { platform, puuid } = await params
    const apiKey = getRiotApiKey()
    const platformHost = `${platform.toLowerCase()}.api.riotgames.com`

    // 2. Fetch Summoner
    const summoner = await riotFetch<SummonerResponse>(
      `https://${platformHost}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      apiKey,
    )

    // 3. CRITICAL CHECK: If this is missing, the next fetch WILL fail
    if (!summoner || !summoner.id) {
      console.warn(`Summoner lookup failed for PUUID: ${puuid}`)
      return NextResponse.json({ error: 'Summoner not found' }, { status: 404 })
    }

    // 4. Fetch League (Only runs if summoner.id exists)
    const league = await riotFetch(
      `https://${platformHost}/lol/league/v4/entries/by-summoner/${summoner.id}`,
      apiKey,
    )

    return NextResponse.json({ summoner: { ...summoner, league: league ?? [] } })
  } catch (error) {
    console.error('API Route Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}