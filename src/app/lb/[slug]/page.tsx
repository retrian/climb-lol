import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cache, Suspense } from 'react'
import { unstable_cache } from 'next/cache'
import { getChampionMap } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { getSeasonStartIso } from '@/lib/riot/season'
import { compareRanks } from '@/lib/rankSort'
import { createServiceClient } from '@/lib/supabase/service'
import LatestGamesFeedClient from './LatestGamesFeedClient'
import PlayerMatchHistoryClient from './PlayerMatchHistoryClient'
import LeaderboardTabs from '@/components/LeaderboardTabs'

export const revalidate = 30
const DEFAULT_DDRAGON_VERSION = '15.24.1'
const MAX_RECENT_PARTICIPANT_ROWS = 500

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

interface LatestGameRpcRaw {
  match_id: string
  puuid: string
  champion_id: number
  win: boolean
  kills: number | null
  deaths: number | null
  assists: number | null
  cs: number | null
  game_end_ts: number | null
  queue_id: number | null
  lp_change?: number | null
  lp_delta?: number | null
  lp_diff?: number | null
  lp_note?: string | null
  note?: string | null
  game_duration_s?: number | null
  gameDuration?: number | null
  game_ended_in_early_surrender?: boolean | null
  gameEndedInEarlySurrender?: boolean | null
  game_ended_in_surrender?: boolean | null
  gameEndedInSurrender?: boolean | null
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
  matches: Array<{
    game_end_ts: number | null
    queue_id: number | null
  }>
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
  preloadedMatchDataRecord: Record<
    string,
    {
      match: unknown
      timeline: unknown
      accounts: Record<string, unknown>
    }
  >
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
  lastUpdatedIso: string | null
}

interface TeamHeaderCardProps {
  name: string
  description: string | null
  slug: string
  visibility: Visibility
  activeTab: 'overview' | 'stats' | 'graph'
  bannerUrl: string | null
  cutoffs?: Array<{ label: string; lp: number; icon: string }>
  lastUpdated?: string | null
}

interface MoverCardProps {
  puuid: string
  lpDelta: number
  timeframeLabel: string
  borderTone: 'emerald' | 'rose' | 'amber'
  playersByPuuid: Record<string, Player>
  playerIconsByPuuid: Record<string, number | null>
  ddVersion: string
}

// --- Helpers ---

async function safeDb<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  fallback: T,
  label?: string
): Promise<T> {
  const describeError = (error: unknown) => {
    const asRecord = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null
    const ownProps: Record<string, unknown> = {}
    try {
      for (const key of Object.getOwnPropertyNames(asRecord ?? {})) {
        ownProps[key] = asRecord?.[key]
      }
    } catch {}

    return {
      label,
      type: typeof error,
      constructorName: (asRecord?.constructor as { name?: string } | undefined)?.name ?? null,
      message: asRecord?.message ?? null,
      details: asRecord?.details ?? null,
      hint: asRecord?.hint ?? null,
      code: asRecord?.code ?? null,
      name: asRecord?.name ?? null,
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

function normalizeTimestampToMs(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value < 1_000_000_000_000 ? value * 1000 : value
}

function getLatestMatchEndTsMs(matches: unknown): number | null {
  if (!matches) return null
  const rows = Array.isArray(matches) ? matches : [matches]
  let latestTs: number | null = null
  for (const row of rows) {
    const gameEndTs =
      typeof row === 'object' && row !== null && 'game_end_ts' in row
        ? (row as { game_end_ts?: number | null }).game_end_ts
        : null
    const normalized = normalizeTimestampToMs(gameEndTs)
    if (normalized === null) continue
    if (latestTs === null || normalized > latestTs) latestTs = normalized
  }
  return latestTs
}

function filterDeltasByActive(deltas: Map<string, number>, active: Set<string>) {
  if (active.size === 0) return new Map<string, number>(deltas)
  const filtered = new Map<string, number>()
  for (const [puuid, delta] of deltas.entries()) {
    if (active.has(puuid)) filtered.set(puuid, delta)
  }
  return filtered
}

function LpChangePill({ lpChange }: { lpChange: number }) {
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

function MoverCard({
  puuid,
  lpDelta,
  timeframeLabel,
  borderTone,
  playersByPuuid,
  playerIconsByPuuid,
  ddVersion,
}: MoverCardProps) {
  const player = playersByPuuid[puuid]
  const iconId = playerIconsByPuuid[puuid]
  const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
  const displayId = player ? (player.game_name ?? 'Unknown').trim() : 'Unknown Player'

  const borderClass =
    borderTone === 'emerald'
      ? 'border-l-emerald-400 border-emerald-100 dark:border-emerald-500/40'
      : borderTone === 'rose'
      ? 'border-l-rose-400 border-rose-100 dark:border-rose-500/40'
      : 'border-l-amber-400 border-amber-100 dark:border-amber-500/40'

  return (
    <a
      href="#"
      data-open-pmh={puuid}
      className={`block rounded-xl border-l-4 border-y border-r bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:bg-slate-900 ${borderClass}`}
    >
      <div className="group w-full text-left">
        <div className="flex items-center gap-3">
          {iconSrc ? (
            <div className="relative h-11 w-11 shrink-0">
              <img src={iconSrc} alt="" width={44} height={44} loading="lazy" className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800" />
            </div>
          ) : null}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                <span className="truncate">{displayId}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">{timeframeLabel}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300" />
              <LpChangePill lpChange={lpDelta} />
            </div>
          </div>
        </div>
      </div>
    </a>
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

const getLeaderboardPageDataCached = (lbId: string, ddVersion: string) =>
  unstable_cache(
  async (): Promise<LeaderboardPageData> => {
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
      safeDb(supabase.rpc('get_leaderboard_latest_games', { lb_id: lbId, lim: 10 }), [] as LatestGameRpcRaw[], 'get_leaderboard_latest_games')
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
        ? safeDb(
            supabase
              .from('player_rank_snapshot')
              .select('*')
              .in('puuid', allRelevantPuuids)
              .in('queue_type', ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'])
              .gte('fetched_at', seasonStartIso),
            [] as PlayerRankSnapshot[],
            'player_rank_snapshot'
          )
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
              .limit(MAX_RECENT_PARTICIPANT_ROWS),
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
    const queuesByPuuid = new Map<string, { solo: PlayerRankSnapshot | null; flex: PlayerRankSnapshot | null }>()

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
    const filteredLatestRaw = (latestRaw ?? []).filter((row: LatestGameRpcRaw) => {
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
    const latestGames: Game[] = filteredLatestRaw.map((row: LatestGameRpcRaw) => {
      const lpEvent = lpByMatchAndPlayer.get(makeLpKey(row.match_id, row.puuid))
      const lpChange = row.lp_change ?? row.lp_delta ?? row.lp_diff ?? lpEvent?.delta ?? null
      const durationS = row.game_duration_s ?? row.gameDuration ?? undefined
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
        endTs: row.game_end_ts ?? fallbackEndTs ?? undefined,
        durationS,
        queueId: row.queue_id ?? undefined,
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

    const dailyActivePuuids = new Set<string>()
    const weeklyActivePuuids = new Set<string>()
    for (const row of recentParticipantsRaw) {
      if (!row.puuid) continue
      const endTs = getLatestMatchEndTsMs(row.matches)
      if (endTs === null) continue
      if (endTs >= weekStartTs) weeklyActivePuuids.add(row.puuid)
      if (endTs >= todayStartTs) dailyActivePuuids.add(row.puuid)
    }

    // TODO: Implement server-side preloading for match detail payloads and hydrate this record.
    const preloadedMatchDataRecord: Record<
      string,
      {
        match: unknown
        timeline: unknown
        accounts: Record<string, unknown>
      }
    > = {}

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
      lastUpdatedIso,
    }
  },
  ['lb-page-data-v4', lbId, ddVersion],
  { revalidate: 30 }
)()

// --- Components ---

  function TeamHeaderCard({ name, description, slug, visibility, activeTab, bannerUrl, cutoffs = [], lastUpdated = null }: TeamHeaderCardProps) {
    const formattedLastUpdated = lastUpdated
      ? new Date(lastUpdated).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null

    return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      {bannerUrl ? (
        <div className="absolute inset-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bannerUrl} alt="" width={1920} height={480} fetchPriority="high" loading="eager" className="h-full w-full object-cover" />
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
          {formattedLastUpdated ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Updated {formattedLastUpdated}
            </p>
          ) : null}
        </div>
        {cutoffs && cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2"><div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" /><div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Rank Cutoffs</div></div>
            {cutoffs.map((c) => (<div key={c.label} className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"><img src={c.icon} alt={c.label} width={48} height={48} className="w-12 h-12 object-contain drop-shadow-sm" /><div className="flex-1"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">{c.label}</div><div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div></div></div>))}
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
  }
}

async function LeaderboardBody({ lbId, slug, ddVersion }: { lbId: string; slug: string; ddVersion: string }) {
  const supabase = await createClient()

  const [viewResult, data] = await Promise.all([
    supabase.rpc('increment_leaderboard_view', { slug_input: slug }),
    getLeaderboardPageDataCached(lbId, ddVersion),
  ])
  if (viewResult.error) {
    console.error('Failed to increment leaderboard view:', viewResult.error)
  }

  const {
    champMap,
    playersByPuuidRecord,
    rankByPuuidRecord,
    participantsByMatchRecord,
    playerIconsByPuuidRecord,
    preloadedMatchDataRecord,
    playerCards,
    latestGames,
    dailyTopGain,
    resolvedTopLoss,
    weeklyTopGain,
    resolvedWeeklyTopLoss,
  } = data

  return (
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
            const lpDelta = Math.round(dailyTopGain[1])
            return (
              <MoverCard
                puuid={dailyTopGain[0]}
                lpDelta={lpDelta}
                timeframeLabel="24 hours"
                borderTone="emerald"
                playersByPuuid={playersByPuuidRecord}
                playerIconsByPuuid={playerIconsByPuuidRecord}
                ddVersion={ddVersion}
              />
            )
          })() : (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              No one has gained any LP today yet.
            </div>
          )}

          {resolvedTopLoss ? (() => {
            const isLoss = resolvedTopLoss[1] < 0
            const lpDelta = Math.round(resolvedTopLoss[1])
            return (
              <MoverCard
                puuid={resolvedTopLoss[0]}
                lpDelta={lpDelta}
                timeframeLabel="24 hours"
                borderTone={isLoss ? 'rose' : 'amber'}
                playersByPuuid={playersByPuuidRecord}
                playerIconsByPuuid={playerIconsByPuuidRecord}
                ddVersion={ddVersion}
              />
            )
          })() : null}

          <div className="pt-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Weekly Movers</div>
          </div>

          {weeklyTopGain ? (() => {
            const lpDelta = Math.round(weeklyTopGain[1])
            return (
              <MoverCard
                puuid={weeklyTopGain[0]}
                lpDelta={lpDelta}
                timeframeLabel="7 days"
                borderTone="emerald"
                playersByPuuid={playersByPuuidRecord}
                playerIconsByPuuid={playerIconsByPuuidRecord}
                ddVersion={ddVersion}
              />
            )
          })() : (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              No weekly LP changes yet.
            </div>
          )}

          {resolvedWeeklyTopLoss ? (() => {
            const isLoss = resolvedWeeklyTopLoss[1] < 0
            const lpDelta = Math.round(resolvedWeeklyTopLoss[1])
            return (
              <MoverCard
                puuid={resolvedWeeklyTopLoss[0]}
                lpDelta={lpDelta}
                timeframeLabel="7 days"
                borderTone={isLoss ? 'rose' : 'amber'}
                playersByPuuid={playersByPuuidRecord}
                playerIconsByPuuid={playerIconsByPuuidRecord}
                ddVersion={ddVersion}
              />
            )
          })() : null}
        </div>
      </aside>
    </div>
  )
}

export default async function LeaderboardDetail({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const latestPatch = await getLatestDdragonVersion().catch(() => null)
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || DEFAULT_DDRAGON_VERSION
  const supabase = await createClient()
  const lb = await getLeaderboardBySlug(slug)

  if (!lb) notFound()

  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            slug={slug}
            visibility={lb.visibility}
            activeTab="overview"
            bannerUrl={lb.banner_url}
          />
        </div>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,820px)_280px] gap-8 lg:gap-10 items-start justify-center">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 h-64 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
              <div className="rounded-2xl border border-slate-200 bg-white p-4 h-96 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
              <div className="rounded-2xl border border-slate-200 bg-white p-4 h-64 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
            </div>
          }
        >
          <LeaderboardBody lbId={lb.id} slug={slug} ddVersion={ddVersion} />
        </Suspense>
      </div>
    </main>
  )
}
