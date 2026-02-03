import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { getChampionMap } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { getSeasonStartIso } from '@/lib/riot/season'
import { compareRanks } from '@/lib/rankSort'
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

interface SeasonChampionRaw {
  puuid: string
  champion_id: number | null
}

// --- Helpers ---

async function safeDb<T>(query: Promise<{ data: T | null; error: any }> | any, fallback: T): Promise<T> {
  const { data, error } = await query
  if (error) {
    console.error('Database Error:', error)
    return fallback
  }
  return (data as T) ?? fallback
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
  const supabase = await createClient()
  const { data: lb } = await supabase
    .from('leaderboards')
    .select('name, description, banner_url')
    .eq('slug', slug)
    .maybeSingle()

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

  const latestPatch = await getLatestDdragonVersion()
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'

  // Fetch Leaderboard Metadata
  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, description, visibility, banner_url, updated_at')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  const { error: viewError } = await supabase.rpc('increment_leaderboard_view', { slug_input: slug })
  if (viewError) {
    console.error('Failed to increment leaderboard view:', viewError)
  }

  // Phase 1: Discovery (Parallel Fetch)
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
      .eq('leaderboard_id', lb.id)
      .order('sort_order', { ascending: true })
      .limit(50), [] as Player[]
    ),
    safeDb(supabase
      .from('rank_cutoffs')
      .select('queue_type, tier, cutoff_lp')
      .in('tier', ['GRANDMASTER', 'CHALLENGER']), [] as RankCutoffRaw[]
    ),
    safeDb(supabase.rpc('get_leaderboard_latest_games', { lb_id: lb.id, lim: 10 }), [] as any[])
  ])

  const players: Player[] = playersRaw
  const top50Puuids = players.map((p) => p.puuid).filter(Boolean)
  const top50Set = new Set(top50Puuids)

  // Process Latest Games to find ALL PUUIDs involved
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

  const now = new Date()
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const todayStartTs = todayStart.getTime()

  const weekStart = new Date(now)
  weekStart.setDate(weekStart.getDate() - 7)
  const weekStartIso = weekStart.toISOString()
  const weekStartTs = weekStart.getTime()

  // Phase 2: Enrichment (Parallel Fetch)
  const [
    statesRaw,
    ranksRaw,
    seasonChampsRaw,
    missingPlayersRaw,
    latestMatchesRaw,
    lpEventsRaw,
    matchParticipantsRaw,
    lpEventRows
  ] = await Promise.all([
    allRelevantPuuids.length > 0
      ? safeDb(supabase.from('player_riot_state').select('*').in('puuid', allRelevantPuuids), [] as PlayerRiotState[])
      : ([] as PlayerRiotState[]),
    allRelevantPuuids.length > 0
      ? safeDb(supabase.from('player_rank_snapshot').select('*').in('puuid', allRelevantPuuids), [] as PlayerRankSnapshot[])
      : ([] as PlayerRankSnapshot[]),
    top50Puuids.length > 0 ? safeDb(
      supabase
        .from('match_participants')
        .select('puuid, champion_id, matches!inner(game_end_ts, queue_id)')
        .in('puuid', top50Puuids)
        .gte('matches.game_end_ts', seasonStartMsLatest)
        .eq('matches.queue_id', 420),
      [] as SeasonChampionRaw[]
    ) : [],
    missingPuuids.length > 0 ? safeDb(supabase.from('players').select('puuid, game_name, tag_line').in('puuid', missingPuuids), [] as PlayerBasicRaw[]) : [],
    latestMatchIds.length > 0 ? safeDb(supabase.from('matches').select('match_id, fetched_at, game_end_ts').in('match_id', latestMatchIds).gte('fetched_at', seasonStartIso).gte('game_end_ts', seasonStartMsLatest), [] as LatestMatchRaw[]) : [],
    latestMatchIds.length > 0 && allRelevantPuuids.length > 0
      ? safeDb(supabase.from('player_lp_events').select('match_id, puuid, lp_delta, note').in('match_id', latestMatchIds).in('puuid', allRelevantPuuids), [] as LpEventRaw[])
      : ([] as LpEventRaw[]),
    latestMatchIds.length > 0
      ? safeDb(supabase.from('match_participants').select('match_id, puuid, champion_id, kills, deaths, assists, cs, win').in('match_id', latestMatchIds), [] as MatchParticipantRaw[])
      : ([] as MatchParticipantRaw[]),
    allRelevantPuuids.length > 0
      ? safeDb(
          supabase
            .from('player_lp_events')
            .select('puuid, lp_delta, recorded_at, queue_type')
            .in('puuid', allRelevantPuuids)
            .eq('queue_type', 'RANKED_SOLO_5x5')
            .gte('recorded_at', weekStartIso),
          [] as Array<{ puuid: string; lp_delta: number; recorded_at: string | null; queue_type: string | null }>
        )
      : ([] as Array<{ puuid: string; lp_delta: number; recorded_at: string | null; queue_type: string | null }>),
  ])

  // --- Processing Data ---

  // 1. Merge Players
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

  // 2. Process States
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

  // 3. Process Ranks
  const rankBy = new Map<string, PlayerRankSnapshot | null>()
  const seasonStartMs = seasonStartMsLatest
  const queuesByPuuid = new Map<string, { solo: any; flex: any }>()

  for (const r of ranksRaw) {
    if (r.fetched_at && (!seasonStartMs || new Date(r.fetched_at).getTime() >= seasonStartMs)) {
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
    if (entry) {
      rankBy.set(pid, entry.solo ?? entry.flex ?? null)
    } else {
      rankBy.set(pid, null)
    }
  }

  // 4. Sort Top 50 Players
  const playersSorted = [...players].sort((a, b) => {
    const rankA = rankBy.get(a.puuid)
    const rankB = rankBy.get(b.puuid)
    return compareRanks(rankA ?? undefined, rankB ?? undefined)
  })

  // 5. Process Champs
  const champCountsByPuuid = new Map<string, Map<number, number>>()
  for (const row of seasonChampsRaw) {
    if (!row.puuid || !row.champion_id) continue
    let champMap = champCountsByPuuid.get(row.puuid)
    if (!champMap) {
      champMap = new Map<number, number>()
      champCountsByPuuid.set(row.puuid, champMap)
    }
    champMap.set(row.champion_id, (champMap.get(row.champion_id) ?? 0) + 1)
  }
  const champsBy = new Map<string, Array<{ champion_id: number; games: number }>>()
  for (const [puuid, champMap] of champCountsByPuuid.entries()) {
    const champs = Array.from(champMap.entries())
      .map(([champion_id, games]) => ({ champion_id, games }))
      .sort((a, b) => b.games - a.games)
    champsBy.set(puuid, champs)
  }

  // 6. Process Cutoffs
  const cutoffsMap = new Map<string, number>()
  for (const c of cutsRaw) cutoffsMap.set(`${c.queue_type}::${c.tier}`, c.cutoff_lp)

  const cutoffs = [
    { key: 'RANKED_SOLO_5x5::CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
    { key: 'RANKED_SOLO_5x5::GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
  ].map((i) => ({ label: i.label, lp: cutoffsMap.get(i.key) as number, icon: i.icon })).filter((x) => x.lp !== undefined)

  // 7. Assemble Latest Games
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

  const latestGames: Game[] = filteredLatestRaw.map((row: any) => {
    const lpEvent = lpByMatchAndPlayer.get(makeLpKey(row.match_id, row.puuid))
    const lpChange = row.lp_change ?? row.lp_delta ?? row.lp_diff ?? lpEvent?.delta ?? null
    const durationS = row.game_duration_s ?? row.gameDuration
    
    return {
      matchId: row.match_id,
      puuid: row.puuid,
      championId: row.champion_id,
      win: row.win,
      k: row.kills ?? 0,
      d: row.deaths ?? 0,
      a: row.assists ?? 0,
      cs: row.cs ?? 0,
      endTs: row.game_end_ts,
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

  // 8. Match Participants Map
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

  // 9. Prepare Client Props
  // ✅ FIX: Force cast strict record for component compatibility
  const playersByPuuidRecord = Object.fromEntries(allPlayersMap.entries()) as Record<string, Player>
  const rankByPuuidRecord = Object.fromEntries(rankBy.entries())
  const participantsByMatchRecord = Object.fromEntries(participantsByMatch.entries())
  const playerIconsByPuuidRecord = Object.fromEntries(
    Array.from(stateBy.entries()).map(([puuid, state]) => [puuid, state.profile_icon_id ?? null])
  ) as Record<string, number | null>
  
  const preloadedMatchDataRecord: Record<string, any> = {}

  const playerCards = playersSorted.map((player, idx) => ({
    player,
    index: idx + 1,
    rankData: rankBy.get(player.puuid) ?? null,
    stateData: stateBy.get(player.puuid) ?? null,
    topChamps: champsBy.get(player.puuid) ?? [],
  }))

  const dailyLpByPuuid = new Map<string, number>()
  for (const row of lpEventRows) {
    const lpChange = typeof row.lp_delta === 'number' && Number.isFinite(row.lp_delta) ? row.lp_delta : null
    const recordedAt = row.recorded_at ? new Date(row.recorded_at).getTime() : null
    if (lpChange === null || recordedAt === null) continue
    if (recordedAt < todayStartTs) continue
    dailyLpByPuuid.set(row.puuid, (dailyLpByPuuid.get(row.puuid) ?? 0) + lpChange)
  }

  const dailyLpEntries = Array.from(dailyLpByPuuid.entries())
  const dailyTopGain = dailyLpEntries.length
    ? dailyLpEntries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))
    : null
  const dailyTopLoss = dailyLpEntries.length
    ? dailyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedTopLoss = dailyTopLoss && dailyTopLoss[1] < 0
    ? dailyTopLoss
    : dailyLpEntries.length
      ? dailyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
      : null

  const weeklyLpByPuuid = new Map<string, number>()
  for (const row of lpEventRows) {
    const lpChange = typeof row.lp_delta === 'number' && Number.isFinite(row.lp_delta) ? row.lp_delta : null
    const recordedAt = row.recorded_at ? new Date(row.recorded_at).getTime() : null
    if (lpChange === null || recordedAt === null) continue
    if (recordedAt < weekStartTs) continue
    weeklyLpByPuuid.set(row.puuid, (weeklyLpByPuuid.get(row.puuid) ?? 0) + lpChange)
  }

  const weeklyLpEntries = Array.from(weeklyLpByPuuid.entries())
  const weeklyTopGain = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best, curr) => (curr[1] > best[1] ? curr : best))
    : null
  const weeklyTopLoss = weeklyLpEntries.length
    ? weeklyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
    : null
  const resolvedWeeklyTopLoss = weeklyTopLoss && weeklyTopLoss[1] < 0
    ? weeklyTopLoss
    : weeklyLpEntries.length
      ? weeklyLpEntries.reduce((best, curr) => (curr[1] < best[1] ? curr : best))
      : null

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
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Daily LP Movers</h3>
            </div>
            <div className="space-y-4">
              {dailyTopGain ? (() => {
                const player = playersByPuuidRecord[dailyTopGain[0]]
                const iconId = playerIconsByPuuidRecord[dailyTopGain[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? `${(player.game_name ?? 'Unknown').trim()}${player.tag_line ? ` #${player.tag_line}` : ''}` : 'Unknown Player'
                return (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-300">Top Gainer</div>
                    <div className="mt-2 flex items-center gap-2">
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className="h-5 w-5 rounded-full border border-emerald-200 dark:border-emerald-400/40" />
                      ) : null}
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{displayId}</div>
                    </div>
                    <div className="mt-1 text-sm font-black text-emerald-600 dark:text-emerald-300">+{Math.round(dailyTopGain[1])} LP</div>
                  </div>
                )
              })() : (
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  No LP changes today yet.
                </div>
              )}

              {resolvedTopLoss ? (() => {
                const player = playersByPuuidRecord[resolvedTopLoss[0]]
                const iconId = playerIconsByPuuidRecord[resolvedTopLoss[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? `${(player.game_name ?? 'Unknown').trim()}${player.tag_line ? ` #${player.tag_line}` : ''}` : 'Unknown Player'
                const isLoss = resolvedTopLoss[1] < 0
                return (
                  <div className={`rounded-2xl border px-4 py-4 shadow-sm ${
                    isLoss
                      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10'
                      : 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10'
                  }`}>
                    <div className={`text-[10px] font-black uppercase tracking-widest ${isLoss ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}`}>
                      {isLoss ? 'Top Loser' : 'Least Gain'}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className={`h-5 w-5 rounded-full border ${isLoss ? 'border-rose-200 dark:border-rose-400/40' : 'border-amber-200 dark:border-amber-400/40'}`} />
                      ) : null}
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{displayId}</div>
                    </div>
                    <div className={`mt-1 text-sm font-black ${isLoss ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}`}>
                      {resolvedTopLoss[1] >= 0 ? '+' : ''}{Math.round(resolvedTopLoss[1])} LP
                    </div>
                  </div>
                )
              })() : null}

              <div className="pt-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Weekly Movers</div>
              </div>

              {weeklyTopGain ? (() => {
                const player = playersByPuuidRecord[weeklyTopGain[0]]
                const iconId = playerIconsByPuuidRecord[weeklyTopGain[0]]
                const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
                const displayId = player ? `${(player.game_name ?? 'Unknown').trim()}${player.tag_line ? ` #${player.tag_line}` : ''}` : 'Unknown Player'
                return (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-4 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-300">Top Gainer</div>
                    <div className="mt-2 flex items-center gap-2">
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className="h-5 w-5 rounded-full border border-emerald-200 dark:border-emerald-400/40" />
                      ) : null}
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{displayId}</div>
                    </div>
                    <div className="mt-1 text-sm font-black text-emerald-600 dark:text-emerald-300">+{Math.round(weeklyTopGain[1])} LP</div>
                  </div>
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
                const displayId = player ? `${(player.game_name ?? 'Unknown').trim()}${player.tag_line ? ` #${player.tag_line}` : ''}` : 'Unknown Player'
                const isLoss = resolvedWeeklyTopLoss[1] < 0
                return (
                  <div className={`rounded-2xl border px-4 py-4 shadow-sm ${
                    isLoss
                      ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10'
                      : 'border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10'
                  }`}>
                    <div className={`text-[10px] font-black uppercase tracking-widest ${isLoss ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}`}>
                      {isLoss ? 'Top Loser' : 'Least Gain'}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {iconSrc ? (
                        <img src={iconSrc} alt="" className={`h-5 w-5 rounded-full border ${isLoss ? 'border-rose-200 dark:border-rose-400/40' : 'border-amber-200 dark:border-amber-400/40'}`} />
                      ) : null}
                      <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{displayId}</div>
                    </div>
                    <div className={`mt-1 text-sm font-black ${isLoss ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300'}`}>
                      {resolvedWeeklyTopLoss[1] >= 0 ? '+' : ''}{Math.round(resolvedWeeklyTopLoss[1])} LP
                    </div>
                  </div>
                )
              })() : null}
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
