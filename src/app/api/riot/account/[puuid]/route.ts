import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'
import { riotFetchWithRetry } from '@/lib/riot/riotFetchWithRetry'

export async function GET(_: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid } = await params
    const apiKey = getRiotApiKey()
    const account = await riotFetchWithRetry(
      `https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}`,
      apiKey,
      { maxRetries: 3, retryDelay: 2000 }
    )
    return NextResponse.json({ account })
  } catch (error) {
    console.error('[Riot Account API]', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch account'
    const status = errorMessage.includes('Rate limit') ? 429 : 500
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
