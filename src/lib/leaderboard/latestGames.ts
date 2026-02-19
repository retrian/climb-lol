import { unstable_cache } from 'next/cache'
import { getChampionMap } from '@/lib/champions'
import { getSeasonStartIso } from '@/lib/riot/season'
import { createServiceClient } from '@/lib/supabase/service'

const PAGE_CACHE_TTL_SECONDS = 30
const MOVER_QUEUE_ID = 420

export interface LatestActivityPlayer {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
}

interface PlayerRiotState {
  puuid: string
  profile_icon_id: number | null
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

export interface LatestActivityGame {
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

export interface LatestActivityMatchParticipant {
  matchId: string
  puuid: string
  championId: number
  kills: number
  deaths: number
  assists: number
  cs: number
  win: boolean
}

export interface LatestActivityData {
  champMap: Record<number, { id: string; name: string }>
  playersByPuuidRecord: Record<string, LatestActivityPlayer>
  rankByPuuidRecord: Record<string, PlayerRankSnapshot | null>
  participantsByMatchRecord: Record<string, LatestActivityMatchParticipant[]>
  playerIconsByPuuidRecord: Record<string, number | null>
  preloadedMatchDataRecord: Record<
    string,
    {
      match: unknown
      timeline: unknown
      accounts: Record<string, unknown>
    }
  >
  latestGames: LatestActivityGame[]
}

async function safeDb<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  fallback: T,
  label?: string
): Promise<T> {
  try {
    const { data, error } = await query
    if (error) {
      console.error('[latest-activity] database error', { label, error })
      return fallback
    }
    return (data as T) ?? fallback
  } catch (error) {
    console.error('[latest-activity] database exception', { label, error })
    return fallback
  }
}

function makeLpKey(matchId: string, puuid: string): string {
  return `${matchId}-${puuid}`
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

const fetchLatestActivityData = async (lbId: string, ddVersion: string): Promise<LatestActivityData> => {
  const supabase = createServiceClient()

  const [champMap, playersRaw, latestRaw] = await Promise.all([
    getChampionMap(ddVersion).catch(() => ({})),
    safeDb(
      supabase
        .from('leaderboard_players')
        .select('id, puuid, game_name, tag_line')
        .eq('leaderboard_id', lbId)
        .order('sort_order', { ascending: true })
        .limit(50),
      [] as LatestActivityPlayer[],
      'leaderboard_players'
    ),
    safeDb(
      supabase.rpc('get_leaderboard_latest_games', { lb_id: lbId, lim: 10 }),
      [] as LatestGameRpcRaw[],
      'get_leaderboard_latest_games'
    ),
  ])

  const top50Puuids = playersRaw.map((p) => p.puuid).filter(Boolean)
  const top50Set = new Set(top50Puuids)
  const latestMatchIds: string[] = []
  const seenMatchIds = new Set<string>()
  const gamePuuids = new Set<string>()

  for (const row of latestRaw) {
    if (row.match_id && !seenMatchIds.has(row.match_id)) {
      seenMatchIds.add(row.match_id)
      latestMatchIds.push(row.match_id)
    }
    if (row.puuid) gamePuuids.add(row.puuid)
  }

  const missingPuuids = Array.from(gamePuuids).filter((p) => !top50Set.has(p))
  const allRelevantPuuids = Array.from(new Set([...top50Puuids, ...Array.from(gamePuuids)]))

  const seasonStartIso = getSeasonStartIso({ ddVersion })
  const seasonStartMsLatest = new Date(seasonStartIso).getTime()

  const [statesRaw, ranksRaw, missingPlayersRaw, latestMatchesRaw, lpEventsRaw, matchParticipantsRaw] = await Promise.all([
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase.from('player_riot_state').select('puuid, profile_icon_id').in('puuid', allRelevantPuuids),
          [] as PlayerRiotState[],
          'player_riot_state'
        )
      : ([] as PlayerRiotState[]),
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_rank_snapshot')
            .select('puuid, queue_type, tier, rank, league_points, wins, losses, fetched_at')
            .in('puuid', allRelevantPuuids)
            .in('queue_type', ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'])
            .gte('fetched_at', seasonStartIso),
          [] as PlayerRankSnapshot[],
          'player_rank_snapshot'
        )
      : ([] as PlayerRankSnapshot[]),
    missingPuuids.length > 0
      ? safeDb(
          supabase.from('players').select('puuid, game_name, tag_line').in('puuid', missingPuuids),
          [] as PlayerBasicRaw[],
          'missing_players'
        )
      : ([] as PlayerBasicRaw[]),
    latestMatchIds.length > 0
      ? safeDb(
          supabase
            .from('matches')
            .select('match_id, fetched_at, game_end_ts')
            .in('match_id', latestMatchIds)
            .gte('fetched_at', seasonStartIso)
            .gte('game_end_ts', seasonStartMsLatest),
          [] as LatestMatchRaw[],
          'latest_matches'
        )
      : ([] as LatestMatchRaw[]),
    latestMatchIds.length > 0 && allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_lp_events')
            .select('match_id, puuid, lp_delta, note')
            .in('match_id', latestMatchIds)
            .in('puuid', allRelevantPuuids),
          [] as LpEventRaw[],
          'player_lp_events'
        )
      : ([] as LpEventRaw[]),
    latestMatchIds.length > 0
      ? safeDb(
          supabase
            .from('match_participants')
            .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win')
            .in('match_id', latestMatchIds),
          [] as MatchParticipantRaw[],
          'match_participants_latest'
        )
      : ([] as MatchParticipantRaw[]),
  ])

  const playersByPuuid = new Map<string, LatestActivityPlayer>()
  for (const player of playersRaw) playersByPuuid.set(player.puuid, player)
  for (const player of missingPlayersRaw) {
    if (!playersByPuuid.has(player.puuid)) {
      playersByPuuid.set(player.puuid, {
        id: player.puuid,
        puuid: player.puuid,
        game_name: player.game_name,
        tag_line: player.tag_line,
      })
    }
  }

  const stateBy = new Map<string, PlayerRiotState>()
  for (const state of statesRaw) stateBy.set(state.puuid, state)

  const rankBy = new Map<string, PlayerRankSnapshot | null>()
  const queuesByPuuid = new Map<string, { solo: PlayerRankSnapshot | null; flex: PlayerRankSnapshot | null }>()
  for (const row of ranksRaw) {
    let entry = queuesByPuuid.get(row.puuid)
    if (!entry) {
      entry = { solo: null, flex: null }
      queuesByPuuid.set(row.puuid, entry)
    }
    if (row.queue_type === 'RANKED_SOLO_5x5') entry.solo = row
    else if (row.queue_type === 'RANKED_FLEX_SR') entry.flex = row
  }
  for (const puuid of allRelevantPuuids) {
    const entry = queuesByPuuid.get(puuid)
    rankBy.set(puuid, entry ? (entry.solo ?? entry.flex ?? null) : null)
  }

  const allowedMatchIds = new Set(latestMatchesRaw.map((row) => row.match_id))
  const latestMatchEndById = new Map(latestMatchesRaw.map((row) => [row.match_id, row.game_end_ts]))
  const filteredLatestRaw = latestRaw.filter((row: LatestGameRpcRaw) => {
    if (row.queue_id !== MOVER_QUEUE_ID) return false

    if (allowedMatchIds.has(row.match_id)) return true

    const fallbackEndTs = row.game_end_ts ?? latestMatchEndById.get(row.match_id) ?? null
    if (typeof fallbackEndTs === 'number') {
      return fallbackEndTs >= seasonStartMsLatest
    }

    return true
  })

  const lpByMatchAndPlayer = new Map<string, { delta: number; note: string | null }>()
  for (const row of lpEventsRaw) {
    if (row.match_id && row.puuid && typeof row.lp_delta === 'number') {
      lpByMatchAndPlayer.set(makeLpKey(row.match_id, row.puuid), {
        delta: row.lp_delta,
        note: row.note ?? null,
      })
    }
  }

  const latestGames: LatestActivityGame[] = filteredLatestRaw.map((row: LatestGameRpcRaw) => {
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

  const participantsByMatch = new Map<string, LatestActivityMatchParticipant[]>()
  for (const row of matchParticipantsRaw) {
    if (!row.match_id || !row.puuid) continue
    const entry: LatestActivityMatchParticipant = {
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

  const playerIconsByPuuidRecord = Object.fromEntries(
    Array.from(stateBy.entries()).map(([puuid, state]) => [puuid, state.profile_icon_id ?? null])
  ) as Record<string, number | null>

  return {
    champMap,
    playersByPuuidRecord: Object.fromEntries(playersByPuuid.entries()),
    rankByPuuidRecord: Object.fromEntries(rankBy.entries()) as Record<string, PlayerRankSnapshot | null>,
    participantsByMatchRecord: Object.fromEntries(participantsByMatch.entries()),
    playerIconsByPuuidRecord,
    preloadedMatchDataRecord: {},
    latestGames,
  }
}

export const getLatestActivityDataCached = (lbId: string, ddVersion: string) =>
  unstable_cache(
    () => fetchLatestActivityData(lbId, ddVersion),
    ['lb-latest-activity-v1', lbId, ddVersion],
    { revalidate: PAGE_CACHE_TTL_SECONDS }
  )()

export const getLatestGamesCached = async (lbId: string, ddVersion: string) => {
  const data = await getLatestActivityDataCached(lbId, ddVersion)
  return data.latestGames
}

export const getLatestGamesFresh = async (lbId: string, ddVersion: string): Promise<LatestActivityGame[]> => {
  const supabase = createServiceClient()

  const latestRaw = await safeDb(
    supabase.rpc('get_leaderboard_latest_games', { lb_id: lbId, lim: 10 }),
    [] as LatestGameRpcRaw[],
    'get_leaderboard_latest_games'
  )

  const latestMatchIds: string[] = []
  const seenMatchIds = new Set<string>()
  const gamePuuids = new Set<string>()
  for (const row of latestRaw) {
    if (row.match_id && !seenMatchIds.has(row.match_id)) {
      seenMatchIds.add(row.match_id)
      latestMatchIds.push(row.match_id)
    }
    if (row.puuid) gamePuuids.add(row.puuid)
  }

  const seasonStartIso = getSeasonStartIso({ ddVersion })
  const seasonStartMsLatest = new Date(seasonStartIso).getTime()
  const allRelevantPuuids = Array.from(gamePuuids)

  const [latestMatchesRaw, lpEventsRaw] = await Promise.all([
    latestMatchIds.length > 0
      ? safeDb(
          supabase
            .from('matches')
            .select('match_id, fetched_at, game_end_ts')
            .in('match_id', latestMatchIds)
            .gte('fetched_at', seasonStartIso)
            .gte('game_end_ts', seasonStartMsLatest),
          [] as LatestMatchRaw[],
          'latest_matches'
        )
      : ([] as LatestMatchRaw[]),
    latestMatchIds.length > 0 && allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_lp_events')
            .select('match_id, puuid, lp_delta, note')
            .in('match_id', latestMatchIds)
            .in('puuid', allRelevantPuuids),
          [] as LpEventRaw[],
          'player_lp_events'
        )
      : ([] as LpEventRaw[]),
  ])

  const allowedMatchIds = new Set(latestMatchesRaw.map((row) => row.match_id))
  const latestMatchEndById = new Map(latestMatchesRaw.map((row) => [row.match_id, row.game_end_ts]))
  const filteredLatestRaw = latestRaw.filter((row: LatestGameRpcRaw) => {
    if (row.queue_id !== MOVER_QUEUE_ID) return false
    if (allowedMatchIds.has(row.match_id)) return true

    const fallbackEndTs = row.game_end_ts ?? latestMatchEndById.get(row.match_id) ?? null
    if (typeof fallbackEndTs === 'number') return fallbackEndTs >= seasonStartMsLatest
    return true
  })

  const lpByMatchAndPlayer = new Map<string, { delta: number; note: string | null }>()
  for (const row of lpEventsRaw) {
    if (row.match_id && row.puuid && typeof row.lp_delta === 'number') {
      lpByMatchAndPlayer.set(makeLpKey(row.match_id, row.puuid), {
        delta: row.lp_delta,
        note: row.note ?? null,
      })
    }
  }

  return filteredLatestRaw.map((row: LatestGameRpcRaw) => {
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
}

