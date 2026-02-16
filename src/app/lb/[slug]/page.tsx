import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { getChampionMap } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { getSeasonStartIso } from '@/lib/riot/season'
import { compareRanks } from '@/lib/rankSort'
import { createServiceClient } from '@/lib/supabase/service'
import LatestGamesFeedClient from './LatestGamesFeedClient'
import PlayerMatchHistoryClient from './PlayerMatchHistoryClient'
import LeaderboardTabs from '@/components/LeaderboardTabs'

// --- Types ---

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

// Updated to allow Partial for missing players handling
export interface Player {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
  role: string | null
  twitch_url: string | null
  twitter_url: string | null
  sort_order: number
}

interface PlayerRiotState {
  puuid: string
  profile_icon_id: number | null
  summoner_level: number | null
  last_rank_sync_at: string | null
}

interface PlayerRankSnapshot {
  puuid: string
  queue_type: string
  tier: string | null
  rank: string | null
  league_points: number | null
  wins: number | null
  losses: number | null
  fetched_at: string | null
}

interface Game {
  matchId: string
  puuid: string
  championId: number
  win: boolean
  k: number
  d: number
  a: number
  cs: number
  endTs?: number
  durationS?: number
  queueId?: number
  lpChange?: number | null
  lpNote?: string | null
  endType?: 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL'
}

interface MatchParticipant {
  matchId: string
  puuid: string
  championId: number
  kills: number
  deaths: number
  assists: number
  cs: number
  win: boolean
}

// Database Response Types
interface RankCutoffRaw {
  queue_type: string
  tier: string
  cutoff_lp: number
}

interface LatestMatchRaw {
  match_id: string
  fetched_at: string
  game_end_ts: number | null
}

interface LpEventRaw {
  match_id: string
  puuid: string
  lp_delta: number | null
  note: string | null
}

interface MatchParticipantRaw {
  match_id: string
  puuid: string
  champion_id: number
  kills: number
  deaths: number
  assists: number
  cs: number
  win: boolean
}

interface PlayerBasicRaw {
  puuid: string
  game_name: string | null
  tag_line: string | null
}

interface TopChampionRaw {
  puuid: string
  champion_id: number | null
  games: number | null
}

interface MoverDeltaRaw {
  puuid: string
  lp_delta: number | null
}

interface RecentParticipantRaw {
  puuid: string
  win: boolean | null
  matches: {
    game_end_ts: number | null
    queue_id: number | null
  } | null
}

interface LeaderboardRaw {
  id: string
  user_id: string
  name: string
  description: string | null
  visibility: Visibility
  banner_url: string | null
  updated_at: string | null
}

interface LeaderboardPageData {
  champMap: Record<number, { id: string; name: string }>
  playersByPuuidRecord: Record<string, Player>
  rankByPuuidRecord: Record<string, PlayerRankSnapshot | null>
  participantsByMatchRecord: Record<string, MatchParticipant[]>
  playerIconsByPuuidRecord: Record<string, number | null>
  preloadedMatchDataRecord: Record<string, any>
  playerCards: Array<{
    player: Player
    index: number
    rankData: PlayerRankSnapshot | null
    stateData: PlayerRiotState | null
    topChamps: Array<{ champion_id: number; games: number }>
  }>
  latestGames: Game[]
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  dailyTopGain: [string, number] | null
  resolvedTopLoss: [string, number] | null
  weeklyTopGain: [string, number] | null
  resolvedWeeklyTopLoss: [string, number] | null
  dailyStatsByPuuidRecord: Record<string, { games: number; wins: number; losses: number }>
  lastUpdatedIso: string | null
}

// --- Helpers ---

async function safeDb<T>(
  query: Promise<{ data: T | null; error: unknown }> | any,
  fallback: T,
  label?: string
): Promise<T> {
  const describeError = (error: unknown) => {
    const asAny = error as any
    let ownProps: Record<string, unknown> = {}
    try {
      for (const key of Object.getOwnPropertyNames(asAny ?? {})) {
        ownProps[key] = asAny?.[key]
      }
    } catch {}

    return {
      label,
      type: typeof error,
      constructorName: asAny?.constructor?.name ?? null,
      message: asAny?.message ?? null,
      details: asAny?.details ?? null,
      hint: asAny?.hint ?? null,
      code: asAny?.code ?? null,
      name: asAny?.name ?? null,
      toString: (() => {
        try {
          return String(error)
        } catch {
          return null
        }
      })(),
      serialized: (() => {
        try {
          return JSON.stringify(error)
        } catch {
          return null
        }
      })(),
      ownProps,
    }
  }

  try {
    const { data, error } = await query
    if (error) {
      console.error('Database Error:', describeError(error), error)
      return fallback
    }
    return (data as T) ?? fallback
  } catch (error) {
    console.error('Database Exception:', describeError(error), error)
    return fallback
  }
}

function computeEndType({
  gameEndedInEarlySurrender,
  gameEndedInSurrender,
  gameDurationS,
  lpChange,
}: {
  gameEndedInEarlySurrender?: boolean | null
  gameEndedInSurrender?: boolean | null
  gameDurationS?: number
  lpChange?: number | null
}): 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL' {
  const normalizedLpChange = typeof lpChange === 'number' && Number.isFinite(lpChange) ? lpChange : null

  if (gameEndedInEarlySurrender === true) {
    if (typeof gameDurationS === 'number') {
      return gameDurationS <= 210 ? 'REMAKE' : 'EARLY_SURRENDER'
    }
    if (normalizedLpChange !== null && normalizedLpChange < 0) return 'EARLY_SURRENDER'
    return 'REMAKE'
  }

  if (gameEndedInSurrender === true) return 'SURRENDER'

  if (typeof gameDurationS === 'number') {
    if (gameDurationS <= 210 && (normalizedLpChange === null || normalizedLpChange === 0)) return 'REMAKE'
    if (gameDurationS <= 300 && normalizedLpChange !== null && normalizedLpChange < 0) return 'EARLY_SURRENDER'
  }

  return 'NORMAL'
}

function makeLpKey(matchId: string, puuid: string): string {
  return `${matchId}-${puuid}`
}

function filterDeltasByActive(deltas: Map<string, number>, active: Set<string>) {
  if (active.size === 0) return new Map<string, number>()
  const filtered = new Map<string, number>()
  for (const [puuid, delta] of deltas.entries()) {
    if (active.has(puuid)) filtered.set(puuid, delta)
  }
  return filtered
}

function renderLpChangePill(lpChange: number) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums ${
        lpChange === 0
          ? 'text-slate-500 bg-slate-100 dark:text-slate-300 dark:bg-slate-700/50'
          : lpChange > 0
          ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/20'
          : 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/20'
      }`}
    >
      {lpChange === 0 ? (
        '— 0 LP'
      ) : (
        <>
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            {lpChange > 0 ? <path d="M10 4l6 8H4l6-8z" /> : <path d="M10 16l-6-8h12l-6 8z" />}
          </svg>
          {Math.abs(lpChange)} LP
        </>
      )}
    </span>
  )
}

const getLeaderboardBySlug = cache(async (slug: string): Promise<LeaderboardRaw | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, description, visibility, banner_url, updated_at')
    .eq('slug', slug)
    .maybeSingle()

  return (data as LeaderboardRaw | null) ?? null
})

const getLeaderboardPageDataCached = unstable_cache(
  async (lbId: string, ddVersion: string): Promise<LeaderboardPageData> => {
    const supabase = createServiceClient()

    const [
      champMap,
      playersRaw,
      cutsRaw,
      latestRaw
    ] = await Promise.all([
      getChampionMap(ddVersion).catch(() => ({})),
      safeDb(supabase
        .from('leaderboard_players')
        .select('id, puuid, game_name, tag_line, role, twitch_url, twitter_url, sort_order')
        .eq('leaderboard_id', lbId)
        .order('sort_order', { ascending: true })
        .limit(50), [] as Player[], 'leaderboard_players'
      ),
      safeDb(supabase
        .from('rank_cutoffs')
        .select('queue_type, tier, cutoff_lp')
        .in('tier', ['GRANDMASTER', 'CHALLENGER']), [] as RankCutoffRaw[], 'rank_cutoffs'
      ),
      safeDb(supabase.rpc('get_leaderboard_latest_games', { lb_id: lbId, lim: 10 }), [] as any[], 'get_leaderboard_latest_games')
    ])

    const players: Player[] = playersRaw
    const top50Puuids = players.map((p) => p.puuid).filter(Boolean)
    const top50Set = new Set(top50Puuids)

    const latestMatchIds: string[] = []
    const seenMatchIds = new Set<string>()
    const gamePuuids = new Set<string>()

    if (latestRaw) {
      for (const row of latestRaw) {
        if (row.match_id && !seenMatchIds.has(row.match_id)) {
          seenMatchIds.add(row.match_id)
          latestMatchIds.push(row.match_id)
        }
        if (row.puuid) gamePuuids.add(row.puuid)
      }
    }

    const missingPuuids = Array.from(gamePuuids).filter(p => !top50Set.has(p))
    const allRelevantPuuids = Array.from(new Set([...top50Puuids, ...Array.from(gamePuuids)]))

    const seasonStartIso = getSeasonStartIso({ ddVersion })
    const seasonStartMsLatest = new Date(seasonStartIso).getTime()

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
      ranksRaw,
      topChampsRaw,
      missingPlayersRaw,
      latestMatchesRaw,
      lpEventsRaw,
      matchParticipantsRaw,
      recentParticipantsRaw,
      dailyMoverRows,
      weeklyMoverRows,
    ] = await Promise.all([
      allRelevantPuuids.length > 0
        ? safeDb(supabase.from('player_riot_state').select('*').in('puuid', allRelevantPuuids), [] as PlayerRiotState[], 'player_riot_state')
        : ([] as PlayerRiotState[]),
      allRelevantPuuids.length > 0
        ? safeDb(supabase.from('player_rank_snapshot').select('*').in('puuid', allRelevantPuuids), [] as PlayerRankSnapshot[], 'player_rank_snapshot')
        : ([] as PlayerRankSnapshot[]),
      top50Puuids.length > 0 ? safeDb(
        supabase
          .from('player_top_champions')
          .select('puuid, champion_id, games')
          .in('puuid', top50Puuids)
          .order('games', { ascending: false }),
        [] as TopChampionRaw[],
        'player_top_champions'
      ) : [],
      missingPuuids.length > 0 ? safeDb(supabase.from('players').select('puuid, game_name, tag_line').in('puuid', missingPuuids), [] as PlayerBasicRaw[], 'missing_players') : [],
      latestMatchIds.length > 0 ? safeDb(supabase.from('matches').select('match_id, fetched_at, game_end_ts').in('match_id', latestMatchIds).gte('fetched_at', seasonStartIso).gte('game_end_ts', seasonStartMsLatest), [] as LatestMatchRaw[], 'latest_matches') : [],
      latestMatchIds.length > 0 && allRelevantPuuids.length > 0
        ? safeDb(supabase.from('player_lp_events').select('match_id, puuid, lp_delta, note').in('match_id', latestMatchIds).in('puuid', allRelevantPuuids), [] as LpEventRaw[], 'player_lp_events')
        : ([] as LpEventRaw[]),
      latestMatchIds.length > 0
        ? safeDb(supabase.from('match_participants').select('match_id, puuid, champion_id, kills, deaths, assists, cs, win').in('match_id', latestMatchIds), [] as MatchParticipantRaw[], 'match_participants_latest')
        : ([] as MatchParticipantRaw[]),
      allRelevantPuuids.length > 0
        ? safeDb(
            supabase
              .from('match_participants')
              .select('puuid, win, matches!inner(game_end_ts, queue_id)')
              .in('puuid', allRelevantPuuids)
              .eq('matches.queue_id', 420)
              .gte('matches.game_end_ts', weekStartTs),
            [] as RecentParticipantRaw[],
            'recent_participants_week'
          )
        : ([] as RecentParticipantRaw[]),
      allRelevantPuuids.length > 0
        ? safeDb(
            supabase.rpc('get_leaderboard_mover_deltas', {
              lb_id: lbId,
              start_at: new Date(todayStartTs).toISOString(),
            }),
            [] as MoverDeltaRaw[],
            'movers_daily'
          )
        : ([] as MoverDeltaRaw[]),
      allRelevantPuuids.length > 0
        ? safeDb(
            supabase.rpc('get_leaderboard_mover_deltas', {
              lb_id: lbId,
              start_at: new Date(weekStartTs).toISOString(),
            }),
            [] as MoverDeltaRaw[],
            'movers_weekly'
          )
        : ([] as MoverDeltaRaw[]),
    ])

    const allPlayersMap = new Map<string, Player | Partial<Player>>()
    players.forEach(p => allPlayersMap.set(p.puuid, p))

    missingPlayersRaw.forEach((p) => {
      if (!allPlayersMap.has(p.puuid)) {
        allPlayersMap.set(p.puuid, {
          ...p,
          id: p.puuid,
          role: null,
          twitch_url: null,
          twitter_url: null,
          sort_order: 999
        })
      }
    })

    const stateBy = new Map<string, PlayerRiotState>()
    let lastUpdatedIso: string | null = null
    let maxLastUpdatedTs = 0

    for (const s of statesRaw) {
      stateBy.set(s.puuid, s)
      if (s.last_rank_sync_at) {
        const ts = new Date(s.last_rank_sync_at).getTime()
        if (ts > maxLastUpdatedTs) {
          maxLastUpdatedTs = ts
          lastUpdatedIso = s.last_rank_sync_at
        }
      }
    }

    const rankBy = new Map<string, PlayerRankSnapshot | null>()
    const queuesByPuuid = new Map<string, { solo: any; flex: any }>()

    for (const r of ranksRaw) {
      if (r.fetched_at && (!seasonStartMsLatest || new Date(r.fetched_at).getTime() >= seasonStartMsLatest)) {
        let entry = queuesByPuuid.get(r.puuid)
        if (!entry) {
          entry = { solo: null, flex: null }
          queuesByPuuid.set(r.puuid, entry)
        }
        if (r.queue_type === 'RANKED_SOLO_5x5') entry.solo = r
        else if (r.queue_type === 'RANKED_FLEX_SR') entry.flex = r
      }
    }

    for (const pid of allRelevantPuuids) {
      const entry = queuesByPuuid.get(pid)
      rankBy.set(pid, entry ? (entry.solo ?? entry.flex ?? null) : null)
    }

    const playersSorted = [...players].sort((a, b) => {
      const rankA = rankBy.get(a.puuid)
      const rankB = rankBy.get(b.puuid)
      return compareRanks(rankA ?? undefined, rankB ?? undefined)
    })

    const champsBy = new Map<string, Array<{ champion_id: number; games: number }>>()
    for (const row of topChampsRaw) {
      if (!row.puuid || !row.champion_id) continue
      const current = champsBy.get(row.puuid) ?? []
      current.push({ champion_id: row.champion_id, games: row.games ?? 0 })
      champsBy.set(row.puuid, current)
    }
    for (const [puuid, champs] of champsBy.entries()) {
      champsBy.set(puuid, champs.sort((a, b) => b.games - a.games).slice(0, 5))
    }

    const cutoffsMap = new Map<string, number>()
    for (const c of cutsRaw) cutoffsMap.set(`${c.queue_type}::${c.tier}`, c.cutoff_lp)
    const cutoffs = [
      { key: 'RANKED_SOLO_5x5::CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
      { key: 'RANKED_SOLO_5x5::GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
    ].map((i) => ({ label: i.label, lp: cutoffsMap.get(i.key) as number, icon: i.icon })).filter((x) => x.lp !== undefined)

    const allowedMatchIds = new Set(latestMatchesRaw.map((row) => row.match_id))
    const filteredLatestRaw = (latestRaw ?? []).filter((row: any) => {
      if (!allowedMatchIds.has(row.match_id)) return false
      return row.queue_id === 420
    })

    const lpByMatchAndPlayer = new Map<string, { delta: number; note: string | null }>()
    for (const row of lpEventsRaw) {
      if (row.match_id && row.puuid && typeof row.lp_delta === 'number') {
        lpByMatchAndPlayer.set(makeLpKey(row.match_id, row.puuid), { delta: row.lp_delta, note: row.note ?? null })
      }
    }

    const latestMatchEndById = new Map(latestMatchesRaw.map((row) => [row.match_id, row.game_end_ts]))
    const latestGames: Game[] = filteredLatestRaw.map((row: any) => {
      const lpEvent = lpByMatchAndPlayer.get(makeLpKey(row.match_id, row.puuid))
      const lpChange = row.lp_change ?? row.lp_delta ?? row.lp_diff ?? lpEvent?.delta ?? null
      const durationS = row.game_duration_s ?? row.gameDuration
      const fallbackEndTs = latestMatchEndById.get(row.match_id) ?? null

      return {
        matchId: row.match_id,
        puuid: row.puuid,
        championId: row.champion_id,
        win: row.win,
        k: row.kills ?? 0,
        d: row.deaths ?? 0,
        a: row.assists ?? 0,
        cs: row.cs ?? 0,
        endTs: row.game_end_ts ?? fallbackEndTs ?? null,
        durationS,
        queueId: row.queue_id,
        lpChange,
        lpNote: row.lp_note ?? row.note ?? lpEvent?.note ?? null,
        endType: computeEndType({
          gameEndedInEarlySurrender: row.game_ended_in_early_surrender ?? row.gameEndedInEarlySurrender,
          gameEndedInSurrender: row.game_ended_in_surrender ?? row.gameEndedInSurrender,
          gameDurationS: durationS,
          lpChange,
        }),
      }
    })

    const participantsByMatch = new Map<string, MatchParticipant[]>()
    for (const row of matchParticipantsRaw) {
      if (!row.match_id || !row.puuid) continue
      const entry: MatchParticipant = {
        matchId: row.match_id,
        puuid: row.puuid,
        championId: row.champion_id ?? 0,
        kills: row.kills ?? 0,
        deaths: row.deaths ?? 0,
        assists: row.assists ?? 0,
        cs: row.cs ?? 0,
        win: row.win ?? false,
      }
      const list = participantsByMatch.get(entry.matchId)
      if (list) list.push(entry)
      else participantsByMatch.set(entry.matchId, [entry])
    }

    const playersByPuuidRecord = Object.fromEntries(allPlayersMap.entries()) as Record<string, Player>
    const rankByPuuidRecord = Object.fromEntries(rankBy.entries()) as Record<string, PlayerRankSnapshot | null>
    const participantsByMatchRecord = Object.fromEntries(participantsByMatch.entries())
    const playerIconsByPuuidRecord = Object.fromEntries(
      Array.from(stateBy.entries()).map(([puuid, state]) => [puuid, state.profile_icon_id ?? null])
    ) as Record<string, number | null>

    const dailyStatsByPuuidRecord: Record<string, { games: number; wins: number; losses: number }> = {}
    const dailyActivePuuids = new Set<string>()
    const weeklyActivePuuids = new Set<string>()
    for (const row of recentParticipantsRaw) {
      if (!row.puuid || !row.matches?.game_end_ts) continue
      const endTs = row.matches.game_end_ts
      if (endTs >= weekStartTs) weeklyActivePuuids.add(row.puuid)
      if (endTs >= todayStartTs) dailyActivePuuids.add(row.puuid)
      if (endTs < todayStartTs) continue

      const current = dailyStatsByPuuidRecord[row.puuid] ?? { games: 0, wins: 0, losses: 0 }
      current.games += 1
      if (row.win) current.wins += 1
      else current.losses += 1
      dailyStatsByPuuidRecord[row.puuid] = current
    }

    const preloadedMatchDataRecord: Record<string, any> = {}

    const playerCards = playersSorted.map((player, idx) => ({
      player,
      index: idx + 1,
      rankData: rankBy.get(player.puuid) ?? null,
      stateData: stateBy.get(player.puuid) ?? null,
      topChamps: champsBy.get(player.puuid) ?? [],
    }))

    const dailyDeltaMap = new Map<string, number>()
    for (const row of dailyMoverRows) {
      if (!row.puuid || typeof row.lp_delta !== 'number' || !Number.isFinite(row.lp_delta)) continue
      dailyDeltaMap.set(row.puuid, row.lp_delta)
    }
    const dailyLpByPuuid = filterDeltasByActive(dailyDeltaMap, dailyActivePuuids)
    const dailyLpEntries = Array.from(dailyLpByPuuid.entries())
    const dailyTopGainCandidate = dailyLpEntries.length
      ? dailyLpEntries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))
      : null
    const dailyTopGain = dailyTopGainCandidate && dailyTopGainCandidate[1] > 0
      ? dailyTopGainCandidate
      : null
    const dailyTopLoss = dailyLpEntries.length
      ? dailyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
      : null
    const resolvedTopLoss = dailyLpEntries.length > 1
      ? (dailyTopLoss && dailyTopLoss[1] < 0
          ? dailyTopLoss
          : dailyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best)))
      : null

    const weeklyDeltaMap = new Map<string, number>()
    for (const row of weeklyMoverRows) {
      if (!row.puuid || typeof row.lp_delta !== 'number' || !Number.isFinite(row.lp_delta)) continue
      weeklyDeltaMap.set(row.puuid, row.lp_delta)
    }
    const weeklyLpByPuuid = filterDeltasByActive(weeklyDeltaMap, weeklyActivePuuids)
    const weeklyLpEntries = Array.from(weeklyLpByPuuid.entries())
    const weeklyTopGain = weeklyLpEntries.length
      ? weeklyLpEntries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))
      : null
    const weeklyTopLoss = weeklyLpEntries.length
      ? weeklyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
      : null
    const resolvedWeeklyTopLoss = weeklyLpEntries.length > 1
      ? (weeklyTopLoss && weeklyTopLoss[1] < 0
          ? weeklyTopLoss
          : weeklyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best)))
      : null

    return {
      champMap,
      playersByPuuidRecord,
      rankByPuuidRecord,
      participantsByMatchRecord,
      playerIconsByPuuidRecord,
      preloadedMatchDataRecord,
      playerCards,
      latestGames,
      cutoffs,
      dailyTopGain,
      resolvedTopLoss,
      weeklyTopGain,
      resolvedWeeklyTopLoss,
      dailyStatsByPuuidRecord,
      lastUpdatedIso,
    }
  },
  ['lb-page-data-v3'],
  { revalidate: 30 }
)

// --- Components ---

  function TeamHeaderCard({ name, description, slug, visibility, activeTab, bannerUrl, cutoffs }: any) {
    return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      {bannerUrl ? (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-white/70 via-white/45 to-white/25 dark:from-slate-950/80 dark:via-slate-950/55 dark:to-slate-900/35" />
          <div className="absolute inset-0 bg-gradient-to-t from-white/75 via-white/25 to-transparent dark:from-slate-950/80 dark:via-slate-950/40 dark:to-transparent" />
        </div>
      ) : (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900" />
          <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] pointer-events-none dark:bg-grid-slate-800 dark:[mask-image:linear-gradient(0deg,rgba(15,23,42,0.9),rgba(15,23,42,0.4))]" />
        </>
      )}
      <div className="relative flex flex-col lg:flex-row">
        <div className="flex-1 p-8 lg:p-10">
          <div className="mb-4 lg:mb-6">
            <LeaderboardTabs slug={slug} activeTab={activeTab} visibility={visibility} />
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 mb-4 pb-2 pt-2 dark:from-white dark:via-slate-200 dark:to-slate-400">{name}</h1>
          {description && <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">{description}</p>}
        </div>
        {cutoffs && cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2"><div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" /><div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Rank Cutoffs</div></div>
            {cutoffs.map((c: any) => (<div key={c.label} className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"><img src={c.icon} alt={c.label} className="w-12 h-12 object-contain drop-shadow-sm" /><div className="flex-1"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">{c.label}</div><div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div></div></div>))}
          </div>
        )}
      </div>
    </div>
    )
}

// --- Main Page Component ---

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const lb = await getLeaderboardBySlug(slug)

  const title = lb?.name ? `${lb.name} | CWF.LOL` : 'Leaderboard | CWF.LOL'
  const description =
    lb?.description?.trim() || 'Custom League of Legends leaderboard with live rank updates.'
  const ogImageUrl = `/api/og/leaderboard/${encodeURIComponent(slug)}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: lb?.name ? `${lb.name} leaderboard` : 'Leaderboard preview',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
    other: {
      // Prefetch DNS for Riot API domains
      'dns-prefetch': 'https://ddragon.leagueoflegends.com',
    },
  }
}

export default async function LeaderboardDetail({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const [lb, latestPatch] = await Promise.all([
    getLeaderboardBySlug(slug),
    getLatestDdragonVersion(),
  ])
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'

  if (!lb) notFound()

  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  void (async () => {
    try {
      const viewClient = await createClient()
      const { error: viewError } = await viewClient.rpc('increment_leaderboard_view', { slug_input: slug })
      if (viewError) {
        console.error('Failed to increment leaderboard view:', viewError)
      }
    } catch (error: unknown) {
      console.error('Failed to increment leaderboard view:', error)
    }
  })()
  const data = await getLeaderboardPageDataCached(lb.id, ddVersion)
  const {
    champMap,
    playersByPuuidRecord,
    rankByPuuidRecord,
    participantsByMatchRecord,
    playerIconsByPuuidRecord,
    preloadedMatchDataRecord,
    playerCards,
    latestGames,
    cutoffs,
    dailyTopGain,
    resolvedTopLoss,
    weeklyTopGain,
    resolvedWeeklyTopLoss,
    dailyStatsByPuuidRecord,
    lastUpdatedIso,
  } = data

  const dailyStatsByPuuid = new Map<string, { games: number; wins: number; losses: number }>(
    Object.entries(dailyStatsByPuuidRecord)
  )


  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full max-w-none px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            slug={slug}
            visibility={lb.visibility}
            activeTab="overview"
            lastUpdated={lastUpdatedIso}
            cutoffs={cutoffs}
            bannerUrl={lb.banner_url}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,820px)_280px] gap-8 lg:gap-10 items-start justify-center">
          <aside className="lg:sticky lg:top-6 order-2 lg:order-1">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-1 w-8 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 rounded-full shadow-sm" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Latest Activity</h3>
            </div>
            <LatestGamesFeedClient
              games={latestGames}
              playersByPuuid={playersByPuuidRecord}
              champMap={champMap}
              ddVersion={ddVersion}
              rankByPuuid={rankByPuuidRecord}
              playerIconsByPuuid={playerIconsByPuuidRecord}
              participantsByMatch={participantsByMatchRecord}
              preloadedMatchData={preloadedMatchDataRecord}
            />
          </aside>

          <div className="order-1 lg:order-2 space-y-8 lg:space-y-10">
            <div className="max-w-[820px] mx-auto">
              <PlayerMatchHistoryClient playerCards={playerCards} champMap={champMap} ddVersion={ddVersion} />
            </div>
          </div>

          <aside className="hidden lg:block lg:sticky lg:top-6 order-3">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-1 w-8 bg-gradient-to-r from-amber-400 via-amber-500 to-amber-600 rounded-full shadow-sm" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">LP Movers</h3>
            </div>
            <div className="space-y-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Daily Movers</div>
              </div>
              {dailyTopGain ? (() => {
                const player = playersByPuuidRecord[dailyTopGain[0]]
                const iconId = playerIconsByPuuidRecord[dailyTopGain[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? (player.game_name ?? 'Unknown').trim() : 'Unknown Player'
                const stats = dailyStatsByPuuid.get(dailyTopGain[0]) ?? { games: 0, wins: 0, losses: 0 }
                const lpDelta = Math.round(dailyTopGain[1])
                return (
                  <a href="#" data-open-pmh={dailyTopGain[0]} className="block rounded-xl border-l-4 border-y border-r border-l-emerald-400 border-emerald-100 bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:border-emerald-500/40 dark:bg-slate-900">
                    <div className="group w-full text-left">
                      <div className="flex items-center gap-3">
                        {iconSrc ? (
                          <div className="relative h-11 w-11 shrink-0">
                            <img src={iconSrc} alt="" className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800" />
                          </div>
                        ) : null}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                              <span className="truncate">{displayId}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">24 hours</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300" />
                            {renderLpChangePill(lpDelta)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </a>
                )
              })() : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  No one has gained any LP today yet.
                </div>
              )}

              {resolvedTopLoss ? (() => {
                const player = playersByPuuidRecord[resolvedTopLoss[0]]
                const iconId = playerIconsByPuuidRecord[resolvedTopLoss[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? (player.game_name ?? 'Unknown').trim() : 'Unknown Player'
                const isLoss = resolvedTopLoss[1] < 0
                const stats = dailyStatsByPuuid.get(resolvedTopLoss[0]) ?? { games: 0, wins: 0, losses: 0 }
                const lpDelta = Math.round(resolvedTopLoss[1])
                return (
                  <a href="#" data-open-pmh={resolvedTopLoss[0]} className={`block rounded-xl border-l-4 border-y border-r bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:bg-slate-900 ${
                    isLoss
                      ? 'border-l-rose-400 border-rose-100 dark:border-rose-500/40'
                      : 'border-l-amber-400 border-amber-100 dark:border-amber-500/40'
                  }`}>
                    <div className="group w-full text-left">
                      <div className="flex items-center gap-3">
                        {iconSrc ? (
                          <div className="relative h-11 w-11 shrink-0">
                            <img src={iconSrc} alt="" className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800" />
                          </div>
                        ) : null}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                              <span className="truncate">{displayId}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">24 hours</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300" />
                            {renderLpChangePill(lpDelta)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </a>
                )
              })() : null}

              <div className="pt-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Weekly Movers</div>
              </div>

              {weeklyTopGain ? (() => {
                const player = playersByPuuidRecord[weeklyTopGain[0]]
                const iconId = playerIconsByPuuidRecord[weeklyTopGain[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? (player.game_name ?? 'Unknown').trim() : 'Unknown Player'
                const lpDelta = Math.round(weeklyTopGain[1])
                return (
                  <a href="#" data-open-pmh={weeklyTopGain[0]} className="block rounded-xl border-l-4 border-y border-r border-l-emerald-400 border-emerald-100 bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:border-emerald-500/40 dark:bg-slate-900">
                    <div className="group w-full text-left">
                      <div className="flex items-center gap-3">
                        {iconSrc ? (
                          <div className="relative h-11 w-11 shrink-0">
                            <img src={iconSrc} alt="" className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800" />
                          </div>
                        ) : null}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                              <span className="truncate">{displayId}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">7 days</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300" />
                            {renderLpChangePill(lpDelta)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </a>
                )
              })() : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  No weekly LP changes yet.
                </div>
              )}

              {resolvedWeeklyTopLoss ? (() => {
                const player = playersByPuuidRecord[resolvedWeeklyTopLoss[0]]
                const iconId = playerIconsByPuuidRecord[resolvedWeeklyTopLoss[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? (player.game_name ?? 'Unknown').trim() : 'Unknown Player'
                const isLoss = resolvedWeeklyTopLoss[1] < 0
                const lpDelta = Math.round(resolvedWeeklyTopLoss[1])
                return (
                  <a href="#" data-open-pmh={resolvedWeeklyTopLoss[0]} className={`block rounded-xl border-l-4 border-y border-r bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:bg-slate-900 ${
                    isLoss
                      ? 'border-l-rose-400 border-rose-100 dark:border-rose-500/40'
                      : 'border-l-amber-400 border-amber-100 dark:border-amber-500/40'
                  }`}>
                    <div className="group w-full text-left">
                      <div className="flex items-center gap-3">
                        {iconSrc ? (
                          <div className="relative h-11 w-11 shrink-0">
                            <img src={iconSrc} alt="" className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800" />
                          </div>
                        ) : null}

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                              <span className="truncate">{displayId}</span>
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">7 days</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300" />
                            {renderLpChangePill(lpDelta)}
                          </div>
                        </div>
                      </div>
                    </div>
                  </a>
                )
              })() : null}
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
