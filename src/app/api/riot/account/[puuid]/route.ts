import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'

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

export async function GET(_: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid } = await params
    const apiKey = getRiotApiKey()
    const account = await riotFetch(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
      apiKey,
    )
    return NextResponse.json({ account })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 })
  }
}
