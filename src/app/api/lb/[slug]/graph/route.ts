import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getSeasonStartIso } from '@/lib/riot/season'

const HISTORY_PAGE_SIZE = 1000
const GRAPH_PUBLIC_S_MAXAGE_SECONDS = 300
const GRAPH_PUBLIC_STALE_WHILE_REVALIDATE_SECONDS = 1800
const GRAPH_SAMPLE_TARGET_POINTS = 150

const TIER_ORDER = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const

const DIV_ORDER = ['IV', 'III', 'II', 'I'] as const

type LpHistoryRow = {
  puuid: string
  tier: string | null
  rank: string | null
  lp: number | null
  lp_delta?: number | null
  lp_note?: string | null
  wins: number | null
  losses: number | null
  fetched_at: string
}

type LpEventGraphRow = {
  match_id: string | null
  puuid: string
  lp: number | null
  lp_delta: number | null
  note: string | null
  wins: number | null
  losses: number | null
  fetched_at: string
}

type MatchParticipantRankRow = {
  match_id: string
  puuid: string
  rank_tier: string | null
  rank_division: string | null
}

function baseMasterLadder() {
  const diamondIndex = TIER_ORDER.indexOf('DIAMOND')
  return diamondIndex * 400 + 3 * 100 + 100
}

function ladderValueForRow(point: Pick<LpHistoryRow, 'tier' | 'rank' | 'lp'>) {
  const tier = (point.tier ?? '').toUpperCase()
  const div = (point.rank ?? '').toUpperCase()
  const lp = Math.max(0, point.lp ?? 0)

  const tierIndex = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number])
  if (tierIndex === -1) return lp

  const divIndex = DIV_ORDER.indexOf(div as (typeof DIV_ORDER)[number])

  if (tierIndex <= TIER_ORDER.indexOf('DIAMOND')) {
    const base = tierIndex * 400
    const divOffset = divIndex === -1 ? 0 : divIndex * 100
    return base + divOffset + lp
  }

  return baseMasterLadder() + lp
}

function sampleLpRows(rows: LpHistoryRow[], maxPoints: number) {
  const n = rows.length
  if (n <= maxPoints) return rows

  const keep = new Set<number>()
  keep.add(0)
  keep.add(n - 1)

  let peakIdx = 0
  let troughIdx = 0
  for (let i = 1; i < n; i += 1) {
    const cur = ladderValueForRow(rows[i])
    const peak = ladderValueForRow(rows[peakIdx])
    const trough = ladderValueForRow(rows[troughIdx])
    if (cur > peak) peakIdx = i
    if (cur < trough) troughIdx = i
  }
  keep.add(peakIdx)
  keep.add(troughIdx)

  for (let i = 1; i < n; i += 1) {
    const prev = rows[i - 1]
    const cur = rows[i]
    const tierChanged =
      (prev.tier ?? '').toUpperCase() !== (cur.tier ?? '').toUpperCase() ||
      (prev.rank ?? '').toUpperCase() !== (cur.rank ?? '').toUpperCase()
    if (tierChanged) keep.add(i)
  }

  const remaining = Math.max(0, maxPoints - keep.size)
  if (remaining > 0) {
    const stride = (n - 1) / (remaining + 1)
    for (let i = 1; i <= remaining; i += 1) {
      keep.add(Math.round(i * stride))
    }
  }

  return Array.from(keep)
    .sort((a, b) => a - b)
    .slice(0, maxPoints)
    .map((idx) => rows[idx])
}

async function fetchRecentLpEventsForPlayer(
  dataClient: ReturnType<typeof createServiceClient>,
  puuid: string,
  limit: number,
  seasonStartIso?: string
): Promise<LpHistoryRow[]> {
  let query = dataClient
    .from('player_lp_events')
    .select('match_id, puuid, lp:lp_after, lp_delta, note, wins:wins_after, losses:losses_after, fetched_at:recorded_at')
    .eq('puuid', puuid)
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .order('recorded_at', { ascending: false })
    .limit(limit)

  if (seasonStartIso) {
    query = query.gte('recorded_at', seasonStartIso)
  }

  const { data } = await query
  const rawRows = ((data ?? []) as LpEventGraphRow[]).reverse()
  const matchIds = Array.from(new Set(rawRows.map((r) => r.match_id).filter((id): id is string => Boolean(id))))

  const rankRowsData = matchIds.length > 0
    ? await dataClient
        .from('match_participants')
        .select('match_id, puuid, rank_tier, rank_division')
        .in('match_id', matchIds)
        .eq('puuid', puuid)
        .then((res) => (res.data ?? []) as MatchParticipantRankRow[])
    : [] as MatchParticipantRankRow[]

  const rankByMatchPuuid = new Map(
    rankRowsData.map((row) => [
      `${row.match_id}:${row.puuid}`,
      { tier: row.rank_tier ?? null, rank: row.rank_division ?? null },
    ])
  )

  return rawRows.map((row) => {
    const rankKey = row.match_id ? `${row.match_id}:${row.puuid}` : ''
    const rankInfo = rankKey ? rankByMatchPuuid.get(rankKey) : null
    return {
      puuid: row.puuid,
      tier: rankInfo?.tier ?? null,
      rank: rankInfo?.rank ?? null,
      lp: row.lp,
      lp_delta: row.lp_delta,
      lp_note: row.note,
      wins: row.wins,
      losses: row.losses,
      fetched_at: row.fetched_at,
    }
  })
}

async function fetchRecentLpHistoryForPlayer(
  dataClient: ReturnType<typeof createServiceClient>,
  puuid: string,
  limit: number,
  seasonStartIso?: string
): Promise<LpHistoryRow[]> {
  let query = dataClient
    .from('player_lp_history')
    .select('puuid, tier, rank, lp, wins, losses, fetched_at')
    .eq('puuid', puuid)
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .order('fetched_at', { ascending: false })
    .limit(limit)

  if (seasonStartIso) {
    query = query.gte('fetched_at', seasonStartIso)
  }

  const { data } = await query
  return ((data ?? []) as LpHistoryRow[]).reverse()
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

function mergeHistoryWithRecentEvents(historyRows: LpHistoryRow[], eventRows: LpHistoryRow[]) {
  if (historyRows.length === 0) return eventRows
  if (eventRows.length === 0) return historyRows

  const out = [...historyRows]
  const seen = new Set(
    historyRows.map((row) => `${row.fetched_at}|${row.lp ?? ''}|${row.wins ?? ''}|${row.losses ?? ''}`)
  )

  for (const row of eventRows) {
    const key = `${row.fetched_at}|${row.lp ?? ''}|${row.wins ?? ''}|${row.losses ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }

  return out.sort((a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime())
}

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const { searchParams } = new URL(req.url)
    const puuid = searchParams.get('puuid')?.trim()
    const limitParam = searchParams.get('limit')?.trim() ?? ''
    const parsedLimit = Number(limitParam)
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 1000) : null
    const includeFullHistory = searchParams.get('full') === '1'

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
    let points: LpHistoryRow[] = []

    if (limit !== null) {
      // Recent mode should represent actual played games.
      // Prefer per-game LP events first (season scoped), then all-time events.
      points = await fetchRecentLpEventsForPlayer(dataClient, puuid, limit, seasonStartIso)

      if (points.length < limit) {
        const allTimeEvents = await fetchRecentLpEventsForPlayer(dataClient, puuid, limit)
        if (allTimeEvents.length > points.length) {
          points = allTimeEvents
        }
      }

      // Fallback for players missing event rows.
      if (points.length === 0) {
        points = await fetchRecentLpHistoryForPlayer(dataClient, puuid, limit, seasonStartIso)
      }
      if (points.length < limit) {
        const allTimeHistory = await fetchRecentLpHistoryForPlayer(dataClient, puuid, limit)
        if (allTimeHistory.length > points.length) {
          points = allTimeHistory
        }
      }
    } else {
      const seasonRows = await fetchLpHistoryForPlayer(dataClient, puuid, seasonStartIso)
      const fullRows = seasonRows.length > 0 ? seasonRows : await fetchLpHistoryForPlayer(dataClient, puuid)
      const recentEventsSeason = await fetchRecentLpEventsForPlayer(dataClient, puuid, 200, seasonStartIso)
      const recentEvents = recentEventsSeason.length > 0
        ? recentEventsSeason
        : await fetchRecentLpEventsForPlayer(dataClient, puuid, 200)

      const mergedRows = mergeHistoryWithRecentEvents(fullRows, recentEvents)
      const fallbackRows = mergedRows.length > 0
        ? mergedRows
        : await fetchRecentLpEventsForPlayer(dataClient, puuid, 1000, seasonStartIso)
      const baseRows = fallbackRows.length > 0
        ? fallbackRows
        : await fetchRecentLpEventsForPlayer(dataClient, puuid, 1000)

      points = includeFullHistory ? baseRows : sampleLpRows(baseRows, GRAPH_SAMPLE_TARGET_POINTS)
    }

    const res = NextResponse.json({ points })
    // Recent-mode payloads are user-interactive and should never serve stale edge-cache
    // after server-side logic changes.
    if (limit !== null) {
      res.headers.set('Cache-Control', 'no-store')
    } else if (includeFullHistory) {
      // Graph page polls this endpoint for near-realtime updates.
      // Keep full-history responses uncached so newly ingested games show immediately.
      res.headers.set('Cache-Control', 'no-store')
    } else if (!isPrivate) {
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

