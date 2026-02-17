import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getSeasonStartIso } from '@/lib/riot/season'

const HISTORY_PAGE_SIZE = 1000
const GRAPH_PUBLIC_S_MAXAGE_SECONDS = 300
const GRAPH_PUBLIC_STALE_WHILE_REVALIDATE_SECONDS = 1800

type LpHistoryRow = {
  puuid: string
  tier: string | null
  rank: string | null
  lp: number | null
  wins: number | null
  losses: number | null
  fetched_at: string
}

async function fetchPage(
  dataClient: ReturnType<typeof createServiceClient>,
  puuid: string,
  page: number,
  seasonStartIso?: string
): Promise<LpHistoryRow[]> {
  const from = page * HISTORY_PAGE_SIZE
  const to = from + HISTORY_PAGE_SIZE - 1

  let query = dataClient
    .from('player_lp_history')
    .select('puuid, tier, rank, lp, wins, losses, fetched_at')
    .eq('puuid', puuid)
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .order('fetched_at', { ascending: true })
    .range(from, to)

  if (seasonStartIso) {
    query = query.gte('fetched_at', seasonStartIso)
  }

  const { data } = await query
  return (data ?? []) as LpHistoryRow[]
}

async function fetchLpHistoryForPlayer(
  dataClient: ReturnType<typeof createServiceClient>,
  puuid: string,
  seasonStartIso?: string
): Promise<LpHistoryRow[]> {
  const firstPage = await fetchPage(dataClient, puuid, 0, seasonStartIso)
  if (firstPage.length < HISTORY_PAGE_SIZE) {
    return firstPage
  }

  const MAX_ADDITIONAL_PAGES = 9
  const additionalPages = await Promise.all(
    Array.from({ length: MAX_ADDITIONAL_PAGES }, (_, i) => fetchPage(dataClient, puuid, i + 1, seasonStartIso))
  )

  const rows: LpHistoryRow[] = []
  for (const page of [firstPage, ...additionalPages]) {
    rows.push(...page)
    if (page.length < HISTORY_PAGE_SIZE) break
  }

  return rows
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(req.url)
    const puuid = searchParams.get('puuid')?.trim()

    if (!slug || !puuid) {
      return NextResponse.json({ error: 'Missing slug or puuid' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id, user_id, visibility')
      .eq('slug', slug)
      .maybeSingle()

    if (!lb) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const isPrivate = lb.visibility === 'PRIVATE'
    if (isPrivate) {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth.user
      if (!user || user.id !== lb.user_id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }

    const dataClient = createServiceClient()

    const { data: membership } = await dataClient
      .from('leaderboard_players')
      .select('puuid')
      .eq('leaderboard_id', lb.id)
      .eq('puuid', puuid)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const seasonStartIso = getSeasonStartIso()
    const seasonRows = await fetchLpHistoryForPlayer(dataClient, puuid, seasonStartIso)
    const points = seasonRows.length > 0 ? seasonRows : await fetchLpHistoryForPlayer(dataClient, puuid)

    const res = NextResponse.json({ points })
    if (!isPrivate) {
      res.headers.set(
        'Cache-Control',
        `public, s-maxage=${GRAPH_PUBLIC_S_MAXAGE_SECONDS}, stale-while-revalidate=${GRAPH_PUBLIC_STALE_WHILE_REVALIDATE_SECONDS}`
      )
    } else {
      res.headers.set('Cache-Control', 'private, no-store')
    }

    return res
  } catch (error) {
    console.error('[graph route] error:', error)
    return NextResponse.json({ error: 'Failed to fetch graph history' }, { status: 500 })
  }
}

