import { NextResponse } from 'next/server'
import { getRiotApiKey } from '@/lib/riot/getRiotApiKey'
import { riotFetchWithRetry } from '@/lib/riot/riotFetchWithRetry'

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=900'

function buildCacheHeaders() {
  return {
    'Cache-Control': CACHE_CONTROL,
  }
}

export async function GET(_: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid } = await params
    const apiKey = getRiotApiKey()
    try {
      const account = await riotFetchWithRetry(
        `https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`,
        apiKey,
        { maxRetries: 3, retryDelay: 2000 }
      )
      return NextResponse.json({ account }, { headers: buildCacheHeaders() })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('Riot fetch failed 400')) {
        return NextResponse.json({ account: null, error: 'BAD_PUUID' }, { headers: buildCacheHeaders() })
      }
      throw error
    }
  } catch (error) {
    console.error('[Riot Account API]', error)
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch account'
    const status = errorMessage.includes('Rate limit') ? 429 : 500
    return NextResponse.json({ error: errorMessage }, { status })
  }
}
