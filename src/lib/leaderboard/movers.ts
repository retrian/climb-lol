import { unstable_cache } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'

const MOVER_QUEUE_ID = 420
const MOVER_ACTIVITY_FALLBACK_RATIO = 0.1
const MOVER_ACTIVITY_FALLBACK_MIN = 1
const ACTIVE_MOVER_QUERY_TIMEOUT_MS = 1500
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

interface MoverDeltaRaw {
  puuid: string
  lp_delta: number | null
  start_tier?: string | null
  start_rank?: string | null
  start_lp?: number | null
  end_tier?: string | null
  end_rank?: string | null
  end_lp?: number | null
}

interface LpEventDeltaRaw {
  puuid: string
  lp_delta: number | null
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

async function withTimeout<T>(
  promise: Promise<T>,
  fallback: T,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    const timeoutPromise = new Promise<T>((resolve) => {
      timeoutHandle = setTimeout(() => {
        console.warn('[movers] timed out query path; using fallback', { label, timeoutMs })
        resolve(fallback)
      }, timeoutMs)
    })

    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function shouldFallbackMoverActivityGate({
  activeCount,
  trackedCount,
  lbId,
  timeframe,
}: {
  activeCount: number
  trackedCount: number
  lbId: string
  timeframe: 'daily' | 'weekly'
}): boolean {
  if (trackedCount <= 0) return true

  const minimumExpectedActive = Math.max(
    MOVER_ACTIVITY_FALLBACK_MIN,
    Math.ceil(trackedCount * MOVER_ACTIVITY_FALLBACK_RATIO)
  )

  const shouldFallback = activeCount < minimumExpectedActive

  if (shouldFallback) {
    console.warn('[movers] activity gate fallback engaged', {
      lbId,
      timeframe,
      activeCount,
      trackedCount,
      activeRatio: Number((activeCount / trackedCount).toFixed(3)),
      minimumExpectedActive,
      ratioFloor: MOVER_ACTIVITY_FALLBACK_RATIO,
      queueId: MOVER_QUEUE_ID,
    })
  }

  return shouldFallback
}

function countDistinctMoverPuuids(rows: MoverDeltaRaw[]): number {
  const puuids = new Set<string>()
  for (const row of rows) {
    if (row.puuid) puuids.add(row.puuid)
  }
  return puuids.size
}

const LADDER_TIER_ORDER = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
] as const

const LADDER_DIV_ORDER = ['IV', 'III', 'II', 'I'] as const

function baseMasterLadderValue(): number {
  const diamondIndex = LADDER_TIER_ORDER.indexOf('DIAMOND')
  return diamondIndex * 400 + 3 * 100 + 100
}

function toLadderLp(tier: string | null, division: string | null, lp: number | null): number {
  const t = (tier ?? '').toUpperCase()
  const d = (division ?? '').toUpperCase()
  const safeLp = Math.max(0, lp ?? 0)

  const tierIndex = LADDER_TIER_ORDER.indexOf(t as typeof LADDER_TIER_ORDER[number])
  if (tierIndex === -1) return safeLp

  const divIndex = LADDER_DIV_ORDER.indexOf(d as typeof LADDER_DIV_ORDER[number])

  if (tierIndex <= LADDER_TIER_ORDER.indexOf('DIAMOND')) {
    const base = tierIndex * 400
    const divOffset = divIndex === -1 ? 0 : divIndex * 100
    return base + divOffset + safeLp
  }

  return baseMasterLadderValue() + safeLp
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

  const [
    statesRaw,
    dailyMoverRowsActive,
    weeklyMoverRowsActive,
    dailyLpEventRows,
    weeklyLpEventRows,
  ] = await Promise.all([
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase.from('player_riot_state').select('puuid, profile_icon_id').in('puuid', allRelevantPuuids),
          [] as PlayerStateLite[],
          'player_riot_state'
        )
      : ([] as PlayerStateLite[]),
    allRelevantPuuids.length > 0
      ? withTimeout(
          safeDb(
            supabase.rpc('get_leaderboard_mover_deltas_v2', {
              lb_id: lbId,
              start_at: new Date(todayStartTs).toISOString(),
              queue_filter: MOVER_QUEUE_ID,
              require_recent_activity: true,
            }),
            [] as MoverDeltaRaw[],
            'movers_daily_active'
          ),
          [] as MoverDeltaRaw[],
          ACTIVE_MOVER_QUERY_TIMEOUT_MS,
          'movers_daily_active'
        )
      : ([] as MoverDeltaRaw[]),
    allRelevantPuuids.length > 0
      ? withTimeout(
          safeDb(
            supabase.rpc('get_leaderboard_mover_deltas_v2', {
              lb_id: lbId,
              start_at: new Date(weekStartTs).toISOString(),
              queue_filter: MOVER_QUEUE_ID,
              require_recent_activity: true,
            }),
            [] as MoverDeltaRaw[],
            'movers_weekly_active'
          ),
          [] as MoverDeltaRaw[],
          ACTIVE_MOVER_QUERY_TIMEOUT_MS,
          'movers_weekly_active'
        )
      : ([] as MoverDeltaRaw[]),
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_lp_events')
            .select('puuid, lp_delta')
            .in('puuid', allRelevantPuuids)
            .eq('queue_type', 'RANKED_SOLO_5x5')
            .gte('recorded_at', new Date(todayStartTs).toISOString()),
          [] as LpEventDeltaRaw[],
          'daily_lp_events_window'
        )
      : ([] as LpEventDeltaRaw[]),
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_lp_events')
            .select('puuid, lp_delta')
            .in('puuid', allRelevantPuuids)
            .eq('queue_type', 'RANKED_SOLO_5x5')
            .gte('recorded_at', new Date(weekStartTs).toISOString()),
          [] as LpEventDeltaRaw[],
          'weekly_lp_events_window'
        )
      : ([] as LpEventDeltaRaw[]),
  ])

  const shouldFallbackDailyActivityGate = shouldFallbackMoverActivityGate({
    activeCount: countDistinctMoverPuuids(dailyMoverRowsActive),
    trackedCount: allRelevantPuuids.length,
    lbId,
    timeframe: 'daily',
  })

  const shouldFallbackWeeklyActivityGate = shouldFallbackMoverActivityGate({
    activeCount: countDistinctMoverPuuids(weeklyMoverRowsActive),
    trackedCount: allRelevantPuuids.length,
    lbId,
    timeframe: 'weekly',
  })

  const [dailyMoverRows, weeklyMoverRows] = await Promise.all([
    shouldFallbackDailyActivityGate
      ? safeDb(
          supabase.rpc('get_leaderboard_mover_deltas_v2', {
            lb_id: lbId,
            start_at: new Date(todayStartTs).toISOString(),
            queue_filter: MOVER_QUEUE_ID,
            require_recent_activity: false,
          }),
          [] as MoverDeltaRaw[],
          'movers_daily_fallback'
        )
      : Promise.resolve(dailyMoverRowsActive),
    shouldFallbackWeeklyActivityGate
      ? safeDb(
          supabase.rpc('get_leaderboard_mover_deltas_v2', {
            lb_id: lbId,
            start_at: new Date(weekStartTs).toISOString(),
            queue_filter: MOVER_QUEUE_ID,
            require_recent_activity: false,
          }),
          [] as MoverDeltaRaw[],
          'movers_weekly_fallback'
        )
      : Promise.resolve(weeklyMoverRowsActive),
  ])

  const dailyDeltaMap = new Map<string, number>()
  for (const row of dailyLpEventRows) {
    if (!row.puuid || typeof row.lp_delta !== 'number' || !Number.isFinite(row.lp_delta)) continue
    dailyDeltaMap.set(row.puuid, (dailyDeltaMap.get(row.puuid) ?? 0) + row.lp_delta)
  }

  const dailyMoverDeltaMap = new Map<string, number>()
  for (const row of dailyMoverRows) {
    if (!row.puuid || typeof row.lp_delta !== 'number' || !Number.isFinite(row.lp_delta)) continue
    const ladderDelta =
      row.end_tier != null && row.start_tier != null
        ? toLadderLp(row.end_tier, row.end_rank ?? null, row.end_lp ?? null)
          - toLadderLp(row.start_tier, row.start_rank ?? null, row.start_lp ?? null)
        : row.lp_delta
    dailyMoverDeltaMap.set(row.puuid, ladderDelta)
  }

  for (const [puuid, moverDelta] of dailyMoverDeltaMap.entries()) {
    const eventDelta = dailyDeltaMap.get(puuid)
    if (eventDelta === undefined || Math.abs(moverDelta) > Math.abs(eventDelta)) {
      dailyDeltaMap.set(puuid, moverDelta)
    }
  }

  const weeklyDeltaMap = new Map<string, number>()
  for (const row of weeklyLpEventRows) {
    if (!row.puuid || typeof row.lp_delta !== 'number' || !Number.isFinite(row.lp_delta)) continue
    weeklyDeltaMap.set(row.puuid, (weeklyDeltaMap.get(row.puuid) ?? 0) + row.lp_delta)
  }

  const weeklyMoverDeltaMap = new Map<string, number>()
  for (const row of weeklyMoverRows) {
    if (!row.puuid || typeof row.lp_delta !== 'number' || !Number.isFinite(row.lp_delta)) continue
    const ladderDelta =
      row.end_tier != null && row.start_tier != null
        ? toLadderLp(row.end_tier, row.end_rank ?? null, row.end_lp ?? null)
          - toLadderLp(row.start_tier, row.start_rank ?? null, row.start_lp ?? null)
        : row.lp_delta
    weeklyMoverDeltaMap.set(row.puuid, ladderDelta)
  }

  for (const [puuid, moverDelta] of weeklyMoverDeltaMap.entries()) {
    const eventDelta = weeklyDeltaMap.get(puuid)
    if (eventDelta === undefined || Math.abs(moverDelta) > Math.abs(eventDelta)) {
      weeklyDeltaMap.set(puuid, moverDelta)
    }
  }

  const dailyLpEntries = Array.from(dailyDeltaMap.entries())
  const dailyTopGainCandidate = dailyLpEntries.length
    ? dailyLpEntries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))
    : null
  const dailyTopGain = dailyTopGainCandidate && dailyTopGainCandidate[1] > 0 ? dailyTopGainCandidate : null
  const dailyTopLoss = dailyLpEntries.length
    ? dailyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedTopLoss = dailyTopLoss && dailyTopLoss[1] < 0 ? dailyTopLoss : null

  const weeklyLpEntries = Array.from(weeklyDeltaMap.entries())
  const weeklyTopGainCandidate = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))
    : null
  const weeklyTopGain = weeklyTopGainCandidate && weeklyTopGainCandidate[1] > 0 ? weeklyTopGainCandidate : null
  const weeklyTopLoss = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
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
    ['lb-movers-v1', lbId],
    { revalidate: MOVERS_CACHE_TTL_SECONDS }
  )()

