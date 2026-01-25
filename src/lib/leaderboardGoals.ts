export type GoalMode = 'LIVE' | 'RACE' | 'LP_GOAL' | 'RANK_GOAL'

export type GoalStatus = 'LIVE' | 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'COMPLETED'

export type GoalConfig = {
  goal_mode?: string | null
  race_start_at?: string | null
  race_end_at?: string | null
  lp_goal?: number | null
  rank_goal_tier?: string | null
}

export type LpHistoryRow = {
  puuid: string
  tier: string | null
  rank: string | null
  lp: number | null
  fetched_at: string
}

export type GoalState = {
  mode: GoalMode
  status: GoalStatus
  startMs: number | null
  endMs: number | null
  completionAt: string | null
  winnerPuuid: string | null
  winnerLp: number | null
  winnerTier: string | null
  winnerRank: string | null
}

const GOAL_MODES = new Set<GoalMode>(['LIVE', 'RACE', 'LP_GOAL', 'RANK_GOAL'])

const TIER_WEIGHT: Record<string, number> = {
  CHALLENGER: 10,
  GRANDMASTER: 9,
  MASTER: 8,
  DIAMOND: 7,
  EMERALD: 6,
  PLATINUM: 5,
  GOLD: 4,
  SILVER: 3,
  BRONZE: 2,
  IRON: 1,
}

function parseIsoToMs(value?: string | null): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : ms
}

function tierWeight(tier?: string | null): number {
  if (!tier) return 0
  return TIER_WEIGHT[tier.toUpperCase()] ?? 0
}

export function normalizeGoalMode(mode?: string | null): GoalMode {
  const raw = String(mode ?? '').trim().toUpperCase() as GoalMode
  return GOAL_MODES.has(raw) ? raw : 'LIVE'
}

export function formatGoalDate(iso?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function formatGoalRange(startIso?: string | null, endIso?: string | null): string | null {
  const start = formatGoalDate(startIso)
  const end = formatGoalDate(endIso)
  if (start && end) return `${start} → ${end}`
  if (start) return `Starts ${start}`
  if (end) return `Ends ${end}`
  return null
}

function computeLpGoalCompletion(history: LpHistoryRow[], targetLp: number) {
  let earliestMs: number | null = null
  let winner: LpHistoryRow | null = null

  for (const row of history) {
    const lp = row.lp ?? null
    const tier = String(row.tier ?? '').toUpperCase()
    const isApex = tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER'
    if (!isApex) continue
    if (lp === null || lp < targetLp) continue
    const ts = new Date(row.fetched_at).getTime()
    if (Number.isNaN(ts)) continue
    if (earliestMs === null || ts < earliestMs || (ts === earliestMs && (winner?.lp ?? -Infinity) < lp)) {
      earliestMs = ts
      winner = row
    }
  }

  if (earliestMs === null || !winner) return null
  return {
    completionAt: new Date(earliestMs).toISOString(),
    winner,
  }
}

function computeRankGoalCompletion(history: LpHistoryRow[], targetTier: string) {
  const targetWeight = tierWeight(targetTier)
  if (!targetWeight) return null

  let earliestDay: string | null = null
  let winner: LpHistoryRow | null = null

  for (const row of history) {
    if (tierWeight(row.tier) < targetWeight) continue
    const dayKey = new Date(row.fetched_at).toISOString().slice(0, 10)
    if (!earliestDay || dayKey < earliestDay) {
      earliestDay = dayKey
      winner = row
      continue
    }
    if (dayKey === earliestDay) {
      const lp = row.lp ?? 0
      const bestLp = winner?.lp ?? 0
      if (lp > bestLp) winner = row
    }
  }

  if (!earliestDay || !winner) return null
  const completionAt = `${earliestDay}T23:59:59.999Z`

  return {
    completionAt,
    winner,
  }
}

export function computeGoalState(config: GoalConfig, history: LpHistoryRow[], nowMs = Date.now()): GoalState {
  const mode = normalizeGoalMode(config.goal_mode)
  const startMs = parseIsoToMs(config.race_start_at)
  const raceEndMs = parseIsoToMs(config.race_end_at)

  let status: GoalStatus = mode === 'LIVE' ? 'LIVE' : 'ACTIVE'
  let completionAt: string | null = null
  let winner: LpHistoryRow | null = null

  if (mode === 'RACE') {
    if (startMs && nowMs < startMs) status = 'SCHEDULED'
    if (raceEndMs && nowMs > raceEndMs) status = 'ENDED'
  }

  if (mode === 'LP_GOAL' && typeof config.lp_goal === 'number' && config.lp_goal > 0) {
    const result = computeLpGoalCompletion(history, config.lp_goal)
    if (result) {
      completionAt = result.completionAt
      winner = result.winner
      status = 'COMPLETED'
    }
  }

  if (mode === 'RANK_GOAL' && config.rank_goal_tier) {
    const result = computeRankGoalCompletion(history, config.rank_goal_tier)
    if (result) {
      completionAt = result.completionAt
      winner = result.winner
      status = 'COMPLETED'
    }
  }

  const completionMs = completionAt ? parseIsoToMs(completionAt) : null
  const endMs = completionMs ?? (mode === 'RACE' && raceEndMs && nowMs > raceEndMs ? raceEndMs : null)

  return {
    mode,
    status,
    startMs: mode === 'RACE' ? startMs : null,
    endMs,
    completionAt,
    winnerPuuid: winner?.puuid ?? null,
    winnerLp: winner?.lp ?? null,
    winnerTier: winner?.tier ?? null,
    winnerRank: winner?.rank ?? null,
  }
}
