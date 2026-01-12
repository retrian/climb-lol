import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid } = await params
    if (!puuid) return NextResponse.json({ error: 'Missing puuid' }, { status: 400 })

    const supabase = await createClient()

    const [{ data: state }, { data: ranks }] = await Promise.all([
      supabase
        .from('player_riot_state')
        .select('puuid, profile_icon_id, last_rank_sync_at, last_matches_sync_at')
        .eq('puuid', puuid)
        .maybeSingle(),
      supabase
        .from('player_rank_snapshot')
        .select('puuid, queue_type, tier, rank, league_points, wins, losses, fetched_at')
        .eq('puuid', puuid),
    ])

    const solo = (ranks ?? []).find((row) => row.queue_type === 'RANKED_SOLO_5x5') ?? null
    const flex = (ranks ?? []).find((row) => row.queue_type === 'RANKED_FLEX_SR') ?? null
    const rank = solo ?? flex

    const lastUpdated = [state?.last_rank_sync_at, state?.last_matches_sync_at, rank?.fetched_at]
      .filter(Boolean)
      .map((iso) => new Date(iso as string).getTime())
      .filter((ts) => Number.isFinite(ts))
      .sort((a, b) => b - a)[0]

    return NextResponse.json({
      profileIconId: state?.profile_icon_id ?? null,
      lastUpdated: lastUpdated ? new Date(lastUpdated).toISOString() : null,
      rank: rank
        ? {
            tier: rank.tier ?? null,
            rank: rank.rank ?? null,
            league_points: rank.league_points ?? 0,
            wins: rank.wins ?? 0,
            losses: rank.losses ?? 0,
            queueType: rank.queue_type ?? null,
          }
        : null,
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch player summary' }, { status: 500 })
  }
}
