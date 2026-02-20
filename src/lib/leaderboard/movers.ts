import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { moversTag } from '@/lib/leaderboard/cacheTags'

const MOVERS_CACHE_TTL_SECONDS = 90

interface PlayerLite {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
}

interface PlayerStateLite {
  puuid: string
  profile_icon_id: number | null
}

interface MoverFastRaw {
  puuid: string
  lp_delta: number
}

export interface MoversData {
  playersByPuuidRecord: Record<string, PlayerLite>
  playerIconsByPuuidRecord: Record<string, number | null>
  dailyTopGain: [string, number] | null
  resolvedTopLoss: [string, number] | null
  weeklyTopGain: [string, number] | null
  resolvedWeeklyTopLoss: [string, number] | null
}

async function safeDb<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  fallback: T,
  label?: string
): Promise<T> {
  try {
    const { data, error } = await query
    if (error) {
      console.error('[movers] database error', { label, error })
      return fallback
    }
    return (data as T) ?? fallback
  } catch (error) {
    console.error('[movers] database exception', { label, error })
    return fallback
  }
}

async function fetchMoversData(lbId: string): Promise<MoversData> {
  const supabase = createServiceClient()

  const players = await safeDb(
    supabase
      .from('leaderboard_players')
      .select('id, puuid, game_name, tag_line')
      .eq('leaderboard_id', lbId)
      .order('sort_order', { ascending: true })
      .limit(50),
    [] as PlayerLite[],
    'leaderboard_players'
  )

  const allRelevantPuuids = players.map((p) => p.puuid).filter(Boolean)

  const moversTimeZone = process.env.MOVERS_TIMEZONE ?? 'America/Chicago'
  const now = new Date()
  const zonedNow = new Date(now.toLocaleString('en-US', { timeZone: moversTimeZone }))
  const todayStart = new Date(zonedNow)
  todayStart.setHours(0, 0, 0, 0)
  const todayStartTs = todayStart.getTime()

  const weekStart = new Date(zonedNow)
  weekStart.setDate(weekStart.getDate() - 7)
  const weekStartTs = weekStart.getTime()

  const [statesRaw, dailyMovers, weeklyMovers] = await Promise.all([
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase.from('player_riot_state').select('puuid, profile_icon_id').in('puuid', allRelevantPuuids),
          [] as PlayerStateLite[],
          'player_riot_state'
        )
      : ([] as PlayerStateLite[]),
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase.rpc('get_leaderboard_movers_fast', {
            lb_id: lbId,
            start_at: new Date(todayStartTs).toISOString(),
          }),
          [] as MoverFastRaw[],
          'movers_daily'
        )
      : ([] as MoverFastRaw[]),
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase.rpc('get_leaderboard_movers_fast', {
            lb_id: lbId,
            start_at: new Date(weekStartTs).toISOString(),
          }),
          [] as MoverFastRaw[],
          'movers_weekly'
        )
      : ([] as MoverFastRaw[]),
  ])
  const dailyLpEntries = dailyMovers
    .filter((row: MoverFastRaw) => Boolean(row.puuid) && Number.isFinite(row.lp_delta))
    .map((row: MoverFastRaw) => [row.puuid, row.lp_delta] as [string, number])
  const dailyTopGainCandidate = dailyLpEntries.length
    ? dailyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] > best[1] ? curr : best))
    : null
  const dailyTopGain = dailyTopGainCandidate && dailyTopGainCandidate[1] > 0 ? dailyTopGainCandidate : null
  const dailyTopLoss = dailyLpEntries.length
    ? dailyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedTopLoss = dailyTopLoss && dailyTopLoss[1] < 0 ? dailyTopLoss : null

  const weeklyLpEntries = weeklyMovers
    .filter((row: MoverFastRaw) => Boolean(row.puuid) && Number.isFinite(row.lp_delta))
    .map((row: MoverFastRaw) => [row.puuid, row.lp_delta] as [string, number])
  const weeklyTopGainCandidate = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] > best[1] ? curr : best))
    : null
  const weeklyTopGain = weeklyTopGainCandidate && weeklyTopGainCandidate[1] > 0 ? weeklyTopGainCandidate : null
  const weeklyTopLoss = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedWeeklyTopLoss = weeklyTopLoss && weeklyTopLoss[1] < 0 ? weeklyTopLoss : null

  return {
    playersByPuuidRecord: Object.fromEntries(players.map((player) => [player.puuid, player])) as Record<string, PlayerLite>,
    playerIconsByPuuidRecord: Object.fromEntries(
      statesRaw.map((state) => [state.puuid, state.profile_icon_id ?? null])
    ) as Record<string, number | null>,
    dailyTopGain,
    resolvedTopLoss,
    weeklyTopGain,
    resolvedWeeklyTopLoss,
  }
}

export const getMoversDataCached = (lbId: string) =>
  unstable_cache(
    () => fetchMoversData(lbId),
    ['lb-movers-v5', lbId],
    { revalidate: MOVERS_CACHE_TTL_SECONDS, tags: [moversTag(lbId)] }
  )()

