import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'

interface SummonerResponse {
  id: string
  puuid: string
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

export async function GET(_: Request, { params }: { params: Promise<{ platform: string; puuid: string }> }) {
  try {
    const { platform, puuid } = await params
    const apiKey = getRiotApiKey()
    const platformHost = `${platform.toLowerCase()}.api.riotgames.com`
    const summoner = await riotFetch<SummonerResponse>(
      `https://${platformHost}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
      apiKey,
    )
    const league = await riotFetch(
      `https://${platformHost}/lol/league/v4/entries/by-summoner/${summoner.id}`,
      apiKey,
    )
    return NextResponse.json({ summoner: { summoner, league } })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch summoner' }, { status: 500 })
  }
}
