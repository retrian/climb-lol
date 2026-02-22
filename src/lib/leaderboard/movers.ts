import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'
import { moversTag } from '@/lib/leaderboard/cacheTags'

const MOVERS_CACHE_TTL_SECONDS = 90
const MOVER_QUEUE_TYPE = 'RANKED_SOLO_5x5'
const EVENT_DRIFT_FALLBACK_THRESHOLD = 20

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

interface LpEventLite {
  puuid: string
  lp_delta: number | null
  recorded_at: string | null
  queue_type: string | null
}

export interface MoversData {
  playersByPuuidRecord: Record<string, PlayerLite>
  playerIconsByPuuidRecord: Record<string, number | null>
  dailyTopGain: [string, number] | null
  resolvedTopLoss: [string, number] | null
  weeklyTopGain: [string, number] | null
  resolvedWeeklyTopLoss: [string, number] | null
}

function asFiniteNumber(value: unknown): number | null {
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function toDeltaMap(rows: MoverFastRaw[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (!row?.puuid) continue
    const delta = asFiniteNumber(row.lp_delta)
    if (delta === null) continue
    map.set(row.puuid, delta)
  }
  return map
}

function pickBlendedDelta(canonical: number | undefined, eventDelta: number | undefined): number | null {
  const hasCanonical = typeof canonical === 'number' && Number.isFinite(canonical)
  const hasEvent = typeof eventDelta === 'number' && Number.isFinite(eventDelta)

  if (hasCanonical && hasEvent) {
    const drift = Math.abs((canonical as number) - (eventDelta as number))
    if (drift <= EVENT_DRIFT_FALLBACK_THRESHOLD) return eventDelta as number
    return canonical as number
  }
  if (hasEvent) return eventDelta as number
  if (hasCanonical) return canonical as number
  return null
}

function getWindowBounds(timeZone: string) {
  const now = new Date()
  const zonedNow = new Date(now.toLocaleString('en-US', { timeZone }))

  const todayStart = new Date(zonedNow)
  todayStart.setHours(0, 0, 0, 0)

  const weekStart = new Date(zonedNow)
  weekStart.setDate(weekStart.getDate() - 7)
  weekStart.setHours(0, 0, 0, 0)

  return {
    todayStartTs: todayStart.getTime(),
    weekStartTs: weekStart.getTime(),
  }
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
  const { todayStartTs, weekStartTs } = getWindowBounds(moversTimeZone)

  const [statesRaw, dailyMovers, weeklyMovers, recentEvents] = await Promise.all([
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
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_lp_events')
            .select('puuid, lp_delta, recorded_at, queue_type')
            .in('puuid', allRelevantPuuids)
            .eq('queue_type', MOVER_QUEUE_TYPE)
            .gte('recorded_at', new Date(weekStartTs).toISOString()),
          [] as LpEventLite[],
          'movers_recent_events'
        )
      : ([] as LpEventLite[]),
  ])

  const dailyCanonicalByPuuid = toDeltaMap(dailyMovers)
  const weeklyCanonicalByPuuid = toDeltaMap(weeklyMovers)
  const dailyEventByPuuid = new Map<string, number>()
  const weeklyEventByPuuid = new Map<string, number>()

  for (const row of recentEvents) {
    if (!row?.puuid) continue
    const delta = asFiniteNumber(row.lp_delta)
    if (delta === null) continue
    const recordedAtMs = row.recorded_at ? new Date(row.recorded_at).getTime() : NaN
    if (!Number.isFinite(recordedAtMs)) continue

    if (recordedAtMs >= weekStartTs) {
      weeklyEventByPuuid.set(row.puuid, (weeklyEventByPuuid.get(row.puuid) ?? 0) + delta)
    }
    if (recordedAtMs >= todayStartTs) {
      dailyEventByPuuid.set(row.puuid, (dailyEventByPuuid.get(row.puuid) ?? 0) + delta)
    }
  }

  const dailyLpEntries = allRelevantPuuids
    .map((puuid) => {
      const resolved = pickBlendedDelta(dailyCanonicalByPuuid.get(puuid), dailyEventByPuuid.get(puuid))
      return resolved === null ? null : ([puuid, resolved] as [string, number])
    })
    .filter((entry): entry is [string, number] => Boolean(entry))

  const dailyTopGainCandidate = dailyLpEntries.length
    ? dailyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] > best[1] ? curr : best))
    : null
  const dailyTopGain = dailyTopGainCandidate && dailyTopGainCandidate[1] > 0 ? dailyTopGainCandidate : null
  const dailyTopLoss = dailyLpEntries.length
    ? dailyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedTopLoss = dailyTopLoss && dailyTopLoss[1] < 0 ? dailyTopLoss : null

  const weeklyLpEntries = allRelevantPuuids
    .map((puuid) => {
      const resolved = pickBlendedDelta(weeklyCanonicalByPuuid.get(puuid), weeklyEventByPuuid.get(puuid))
      return resolved === null ? null : ([puuid, resolved] as [string, number])
    })
    .filter((entry): entry is [string, number] => Boolean(entry))

  const weeklyTopGainCandidate = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] > best[1] ? curr : best))
    : null
  const weeklyTopGain = weeklyTopGainCandidate && weeklyTopGainCandidate[1] > 0 ? weeklyTopGainCandidate : null
  const weeklyTopLoss = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best: [string, number], curr: [string, number]) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedWeeklyTopLoss = weeklyTopLoss

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
    ['lb-movers-v6', lbId],
    { revalidate: MOVERS_CACHE_TTL_SECONDS, tags: [moversTag(lbId)] }
  )()

export const getMoversDataFresh = (lbId: string) => fetchMoversData(lbId)

