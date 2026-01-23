import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChampionMap, championIconUrl } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'
import ChampionTable from './ChampionTable'
import LeaderboardTabs from '@/components/LeaderboardTabs'

// --- Configuration ---
const FALLBACK_SEASON_START = '2026-01-08T20:00:00.000Z'

// --- Types ---
type Player = {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
}

type MatchParticipant = {
  match_id: string
  puuid: string
  champion_id: number
  kills: number
  deaths: number
  assists: number
  cs: number
  win: boolean
  vision_score?: number | null
}

type MatchRow = {
  match_id: string
  game_duration_s: number | null
  game_end_ts: number | null
}

type StatTotals = {
  games: number
  wins: number
  losses: number
  kills: number
  deaths: number
  assists: number
  cs: number
  durationS: number
}

// Types expected by ChampionTable
type ChampionPlayerRow = {
  puuid: string
  name: string
  iconUrl: string | null
  games: number
  wins: number
  losses: number
  winrate: string
  kda: { value: number; label: string }
  avgCs: number
}

type ChampionRow = {
  id: number
  name: string
  iconUrl: string | null
  wins: number
  losses: number
  winrate: string
  winrateValue: number
  games: number
  kdaLabel: string
  kdaValue: number
  avgCs: number
  players: ChampionPlayerRow[]
}

// --- Helpers ---

function displayRiotId(player: Player) {
  const gn = (player.game_name ?? '').trim()
  if (gn) return gn
  return player.puuid
}

function profileIconUrl(profileIconId?: number | null, ddVersion?: string) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = ddVersion || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profileIconId}.png`
}

function formatWinrate(wins: number, games: number) {
  if (!games) return '0%'
  return `${Math.round((wins / games) * 100)}%`
}

function formatAverageKda(kills: number, assists: number, deaths: number) {
  // Prevent division by zero and handle negative numbers gracefully
  const safeDeaths = Math.max(1, deaths)
  const kda = (Math.max(0, kills) + Math.max(0, assists)) / safeDeaths
  return { value: kda, label: kda.toFixed(2) }
}

function formatDaysHoursCaps(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0
  const days = Math.floor(safeSeconds / 86400)
  const hours = Math.floor((safeSeconds % 86400) / 3600)
  return `${days}D ${hours.toString().padStart(2, '0')}H`
}

// --- Components ---

function TeamHeaderCard({
  name,
  description,
  slug,
  visibility,
  activeTab,
  cutoffs,
  bannerUrl,
}: {
  name: string
  description?: string | null
  slug: string
  visibility: string
  activeTab: 'overview' | 'graph' | 'stats'
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  bannerUrl: string | null
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <div className="absolute inset-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900" />
      <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] pointer-events-none dark:bg-grid-slate-800 dark:[mask-image:linear-gradient(0deg,rgba(15,23,42,0.9),rgba(15,23,42,0.4))]" />

      {bannerUrl && (
        <div className="relative h-48 w-full border-b border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={bannerUrl} alt="Leaderboard Banner" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="relative flex flex-col lg:flex-row">
        <div className="flex-1 p-8 lg:p-10">
          <div className="mb-4 lg:mb-6">
            <LeaderboardTabs slug={slug} activeTab={activeTab} visibility={visibility} />
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 mb-4 pb-2 pt-2 dark:from-white dark:via-slate-200 dark:to-slate-400">
            {name}
          </h1>
          {description && (
            <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">
              {description}
            </p>
          )}
        </div>

        {cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Rank Cutoffs
              </div>
            </div>
            {cutoffs.map((c) => (
              <div
                key={c.label}
                className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.icon} alt={c.label} className="w-12 h-12 object-contain drop-shadow-sm" />
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">
                    {c.label}
                  </div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default async function LeaderboardStatsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const latestPatch = await getLatestDdragonVersion()
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
  const champMap = await getChampionMap(ddVersion)

  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, visibility, banner_url, description')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  if (lb.visibility === 'PRIVATE') {
    // Better auth check: check error or user mismatch explicitly
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user || data.user.id !== lb.user_id) {
      notFound()
    }
  }

  const { data: playersRaw } = await supabase
    .from('leaderboard_players')
    .select('id, puuid, game_name, tag_line')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(500)

  const players = (playersRaw ?? []) as Player[]
  const puuids = players.map((p) => p.puuid)

  const { data: cutoffsRaw } = await supabase
    .from('rank_cutoffs')
    .select('queue_type, tier, cutoff_lp')
    .in('tier', ['GRANDMASTER', 'CHALLENGER'])

  const cutoffsByTier = new Map((cutoffsRaw ?? []).map((row) => [row.tier, row.cutoff_lp]))

  const cutoffsDisplay = [
    { key: 'GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
    { key: 'CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
  ]
    .map((item) => ({
      label: item.label,
      lp: cutoffsByTier.get(item.key),
      icon: item.icon,
    }))
    .filter((item) => item.lp !== undefined) as Array<{ label: string; lp: number; icon: string }>

  if (puuids.length === 0) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            slug={slug}
            visibility={lb.visibility}
            activeTab="stats"
            cutoffs={cutoffsDisplay}
            bannerUrl={lb.banner_url}
          />
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            No players found for this leaderboard yet.
          </div>
        </div>
      </main>
    )
  }

  const seasonStartMs = new Date(process.env.NEXT_PUBLIC_SEASON_START || FALLBACK_SEASON_START).getTime()

  const { data: stateRaw } = await supabase
    .from('player_riot_state')
    .select('puuid, profile_icon_id')
    .in('puuid', puuids)

  const stateBy = new Map((stateRaw ?? []).map((row) => [row.puuid, row]))

  const { data: participantsRaw } = await supabase
    .from('match_participants')
    .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win, vision_score')
    .in('puuid', puuids)

  const matchIds = Array.from(new Set((participantsRaw ?? []).map((row) => row.match_id)))

  // ✅ BATCHED QUERY FIX: Fetch matches in chunks to avoid URL length limits
  const matchesRaw: MatchRow[] = []
  const BATCH_SIZE = 500
  
  if (matchIds.length > 0) {
    for (let i = 0; i < matchIds.length; i += BATCH_SIZE) {
      const batch = matchIds.slice(i, i + BATCH_SIZE)
      const { data } = await supabase
        .from('matches')
        .select('match_id, game_duration_s, game_end_ts')
        .in('match_id', batch)
      
      if (data) {
        matchesRaw.push(...data)
      }
    }
  }

  // Build match Map with CLIENT-SIDE filtering
  const matchById = new Map<string, { durationS: number; endTs: number }>()
  
  for (const row of matchesRaw) {
    const endTs = typeof row.game_end_ts === 'number' ? row.game_end_ts : null
    
    // ✅ Filter applied here in JavaScript to be safe against BigInt issues
    if (!endTs || endTs < seasonStartMs) continue

    matchById.set(row.match_id, {
      durationS: typeof row.game_duration_s === 'number' ? row.game_duration_s : 0,
      endTs,
    })
  }

  // Type assertion verified by previous query logic
  const participants = (participantsRaw ?? []).filter((row) => matchById.has(row.match_id)) as MatchParticipant[]

  const playersByPuuid = new Map(players.map((p) => [p.puuid, p]))

  const totals: StatTotals = {
    games: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    cs: 0,
    durationS: 0,
  }

  const playersTotals = new Map<string, StatTotals>()
  const championsTotals = new Map<number, StatTotals>()
  const championPlayers = new Map<number, Map<string, StatTotals>>()

  for (const row of participants) {
    const matchMeta = matchById.get(row.match_id)!
    const durationS = matchMeta.durationS
    const winVal = row.win ? 1 : 0
    const lossVal = 1 - winVal

    totals.games += 1
    totals.wins += winVal
    totals.losses += lossVal
    totals.kills += row.kills
    totals.deaths += row.deaths
    totals.assists += row.assists
    totals.cs += row.cs
    totals.durationS += durationS

    let playerTotal = playersTotals.get(row.puuid)
    if (!playerTotal) {
      playerTotal = { games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, cs: 0, durationS: 0 }
      playersTotals.set(row.puuid, playerTotal)
    }
    playerTotal.games += 1
    playerTotal.wins += winVal
    playerTotal.losses += lossVal
    playerTotal.kills += row.kills
    playerTotal.deaths += row.deaths
    playerTotal.assists += row.assists
    playerTotal.cs += row.cs
    playerTotal.durationS += durationS

    let champTotal = championsTotals.get(row.champion_id)
    if (!champTotal) {
      champTotal = { games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, cs: 0, durationS: 0 }
      championsTotals.set(row.champion_id, champTotal)
    }
    champTotal.games += 1
    champTotal.wins += winVal
    champTotal.losses += lossVal
    champTotal.kills += row.kills
    champTotal.deaths += row.deaths
    champTotal.assists += row.assists
    champTotal.cs += row.cs

    let champPlayers = championPlayers.get(row.champion_id)
    if (!champPlayers) {
      champPlayers = new Map<string, StatTotals>()
      championPlayers.set(row.champion_id, champPlayers)
    }
    let champPlayer = champPlayers.get(row.puuid)
    if (!champPlayer) {
      champPlayer = { games: 0, wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0, cs: 0, durationS: 0 }
      champPlayers.set(row.puuid, champPlayer)
    }
    champPlayer.games += 1
    champPlayer.wins += winVal
    champPlayer.losses += lossVal
    champPlayer.kills += row.kills
    champPlayer.deaths += row.deaths
    champPlayer.assists += row.assists
    champPlayer.cs += row.cs
    champPlayer.durationS += durationS
  }

  const championLeaderboard = Array.from(championsTotals.entries()).map(([championId, stats]) => {
    const champion = champMap[championId]
    const kda = formatAverageKda(stats.kills, stats.assists, stats.deaths)
    const avgCs = stats.games ? stats.cs / stats.games : 0
    const winrateValue = stats.games ? stats.wins / stats.games : 0

    const playersStats: ChampionPlayerRow[] = Array.from(championPlayers.get(championId)?.entries() ?? []).map(([puuid, values]) => {
      const player = playersByPuuid.get(puuid)
      const playerKda = formatAverageKda(values.kills, values.assists, values.deaths)
      const playerAvgCs = values.games ? values.cs / values.games : 0
      return {
        puuid,
        name: player ? displayRiotId(player) : puuid,
        iconUrl: profileIconUrl(stateBy.get(puuid)?.profile_icon_id ?? null, ddVersion),
        games: values.games,
        wins: values.wins,
        losses: values.losses,
        winrate: formatWinrate(values.wins, values.games),
        kda: playerKda,
        avgCs: playerAvgCs,
      }
    })

    playersStats.sort((a, b) => b.games - a.games)

    return {
      championId,
      championName: champion?.name ?? 'Unknown',
      championKey: champion?.id ?? null,
      games: stats.games,
      wins: stats.wins,
      losses: stats.losses,
      winrate: formatWinrate(stats.wins, stats.games),
      winrateValue,
      kda,
      avgCs,
      players: playersStats,
    }
  })

  championLeaderboard.sort((a, b) => {
    if (b.winrateValue !== a.winrateValue) return b.winrateValue - a.winrateValue
    if (b.games !== a.games) return b.games - a.games
    if (b.kda.value !== a.kda.value) return b.kda.value - a.kda.value
    return b.avgCs - a.avgCs
  })

  // Explicit type annotation for championTableRows
  const championTableRows: ChampionRow[] = championLeaderboard.map((champ) => ({
    id: champ.championId,
    name: champ.championName,
    iconUrl: champ.championKey ? championIconUrl(ddVersion, champ.championKey) : null,
    wins: champ.wins,
    losses: champ.losses,
    winrate: champ.winrate,
    winrateValue: champ.winrateValue,
    games: champ.games,
    kdaLabel: champ.kda.label,
    kdaValue: champ.kda.value,
    avgCs: champ.avgCs,
    players: champ.players,
  }))

  const playerLeaderboard = Array.from(playersTotals.entries()).map(([puuid, stats]) => {
    const player = playersByPuuid.get(puuid)
    const kda = formatAverageKda(stats.kills, stats.assists, stats.deaths)
    return {
      puuid,
      name: player ? displayRiotId(player) : puuid,
      iconUrl: profileIconUrl(stateBy.get(puuid)?.profile_icon_id ?? null, ddVersion),
      ...stats,
      winrate: formatWinrate(stats.wins, stats.games),
      kda,
    }
  })

  const topKills = [...playerLeaderboard].sort((a, b) => b.kills - a.kills).slice(0, 5)
  const topDeaths = [...playerLeaderboard].sort((a, b) => b.deaths - a.deaths).slice(0, 5)
  const topAssists = [...playerLeaderboard].sort((a, b) => b.assists - a.assists).slice(0, 5)
  const topKdaPlayers = [...playerLeaderboard].sort((a, b) => b.kda.value - a.kda.value).slice(0, 5)
  const bottomKdaPlayers = [...playerLeaderboard].sort((a, b) => a.kda.value - b.kda.value).slice(0, 5)
  const topWinratePlayers = [...playerLeaderboard].sort((a, b) => b.wins / b.games - a.wins / a.games).slice(0, 5)
  const topTotalTime = [...playerLeaderboard].sort((a, b) => b.durationS - a.durationS).slice(0, 5)

  const topKillsSingle = [...participants].sort((a, b) => b.kills - a.kills).slice(0, 3)
  const topDeathsSingle = [...participants].sort((a, b) => b.deaths - a.deaths).slice(0, 3)
  const topAssistsSingle = [...participants].sort((a, b) => b.assists - a.assists).slice(0, 3)
  const topCsSingle = [...participants].sort((a, b) => b.cs - a.cs).slice(0, 3)
  const topVisionSingle = [...participants]
    .filter((row) => typeof row.vision_score === 'number')
    .sort((a, b) => (b.vision_score ?? 0) - (a.vision_score ?? 0))
    .slice(0, 3)

  const participantsByMatch = new Map<string, MatchParticipant[]>()
  for (const row of participants) {
    const matchParticipants = participantsByMatch.get(row.match_id)
    if (matchParticipants) {
      matchParticipants.push(row)
    } else {
      participantsByMatch.set(row.match_id, [row])
    }
  }

  const matchSummaries = Array.from(matchById.entries()).map(([matchId, meta]) => {
    const matchParticipants = participantsByMatch.get(matchId) ?? []
    const representative = matchParticipants[0]
    const player = representative ? playersByPuuid.get(representative.puuid) : null
    return {
      matchId,
      durationS: meta.durationS,
      endTs: meta.endTs,
      playerName: player ? displayRiotId(player) : representative?.puuid ?? 'Unknown',
      playerIconUrl: representative
        ? profileIconUrl(stateBy.get(representative.puuid)?.profile_icon_id ?? null, ddVersion)
        : null,
    }
  })

  const longestMatches = matchSummaries
    .filter((match) => match.durationS > 0)
    .sort((a, b) => b.durationS - a.durationS)
    .slice(0, 5)

  const longestGamesTop = longestMatches.slice(0, 3)
  const bestKdaPlayersTop = topKdaPlayers.slice(0, 3)
  const worstKdaPlayersTop = bottomKdaPlayers.slice(0, 3)
  const longestTotalTimeTop = topTotalTime.slice(0, 3)

  const noGames = participants.length === 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10 lg:py-14 space-y-8">
        <TeamHeaderCard
          name={lb.name}
          description={lb.description}
          slug={slug}
          visibility={lb.visibility}
          activeTab="stats"
          cutoffs={cutoffsDisplay}
          bannerUrl={lb.banner_url}
        />

        {noGames ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            No games found for this leaderboard yet (current season).
          </div>
        ) : null}

        <section className="grid gap-4 md:grid-cols-3">
          {[
            {
              label: 'Total Games',
              value: totals.games.toLocaleString(),
              sub: 'Combined player games',
            },
            {
              label: 'Total Record',
              value: `${totals.wins}W - ${totals.losses}L`,
              sub: `${formatWinrate(totals.wins, totals.games)} • ${totals.games.toLocaleString()} games`,
            },
            {
              label: 'Total Time Played',
              value: formatDaysHoursCaps(totals.durationS),
              sub: `Across all matches • ${Math.floor((Number.isFinite(totals.durationS) ? totals.durationS : 0) / 3600).toLocaleString()}h`,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {card.label}
              </div>
              <div className="mt-3 text-3xl font-black text-slate-900 dark:text-slate-100">{card.value}</div>
              <div className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">{card.sub}</div>
            </div>
          ))}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-1 w-8 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" />
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Champion Analytics
            </h2>
          </div>

          <details className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Unique Champions
                </div>
                <div className="text-2xl font-black text-slate-900 dark:text-slate-100">
                  {championLeaderboard.length}
                </div>
              </div>
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Toggle
              </span>
            </summary>

            {noGames ? (
              <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No champion data yet.</div>
            ) : (
              <ChampionTable rows={championTableRows} />
            )}
          </details>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-gradient-to-r from-amber-400 to-amber-600" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Player Accumulative Rankings
              </h3>
            </div>

            <div className="mt-4 space-y-4">
              {[
                { title: 'Most Total Kills', data: topKills, value: (row: typeof topKills[number]) => row.kills },
                { title: 'Most Total Deaths', data: topDeaths, value: (row: typeof topDeaths[number]) => row.deaths },
                {
                  title: 'Most Total Assists',
                  data: topAssists,
                  value: (row: typeof topAssists[number]) => row.assists,
                },
              ].map((block) => (
                <div key={block.title}>
                  <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    {block.title}
                  </div>
                  {block.data.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-400">No data yet.</div>
                  ) : (
                    <ol className="mt-2 space-y-1 text-sm">
                      {block.data.map((row, idx) => (
                        <li key={row.puuid} className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                            <span className="text-slate-400">{idx + 1}.</span>
                            {row.iconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.iconUrl}
                                alt=""
                                className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                            )}
                            <span>{row.name}</span>
                          </span>
                          <span className="text-slate-900 font-semibold tabular-nums dark:text-slate-100">
                            {block.value(row)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-gradient-to-r from-rose-400 to-rose-600" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Single Game High Scores
              </h3>
            </div>

            <div className="mt-4 space-y-4">
              {[
                { title: 'Most Kills in One Game', data: topKillsSingle, key: 'kills' },
                { title: 'Most Deaths in One Game', data: topDeathsSingle, key: 'deaths' },
                { title: 'Most Assists in One Game', data: topAssistsSingle, key: 'assists' },
                { title: 'Most CS in One Game', data: topCsSingle, key: 'cs' },
                 { title: 'Most Vision Score in One Game', data: topVisionSingle, key: 'vision_score' },
              ].map((block) => (
                <div key={block.title}>
                  <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    {block.title}
                  </div>
                  {block.data.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-400">No data yet.</div>
                  ) : (
                    <ol className="mt-2 space-y-1 text-sm">
                      {block.data.map((row, idx) => {
                        const player = playersByPuuid.get(row.puuid)
                        const iconUrl = profileIconUrl(stateBy.get(row.puuid)?.profile_icon_id ?? null, ddVersion)
                        const champ = champMap[row.champion_id]
                        return (
                          <li key={`${row.match_id}-${row.puuid}`} className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                              <span className="text-slate-400">{idx + 1}.</span>
                              {iconUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={iconUrl}
                                  alt=""
                                  className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                                />
                              ) : (
                                <div className="h-7 w-7 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                              )}
                              <span>{player ? displayRiotId(player) : row.puuid}</span>
                              <span className="text-slate-400"> • {champ?.name ?? 'Unknown'}</span>
                            </span>
                            <span className="text-slate-900 font-semibold tabular-nums dark:text-slate-100">
                              {row[block.key as keyof typeof row]}
                            </span>
                          </li>
                        )
                      })}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-gradient-to-r from-sky-400 to-sky-600" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                KDA Leaderboard Highlights
              </h3>
            </div>

            <div className="mt-4 space-y-4">
              {[
                { title: 'Best Overall KDA', data: bestKdaPlayersTop },
                { title: 'Worst Overall KDA', data: worstKdaPlayersTop },
              ].map((block) => (
                <div key={block.title}>
                  <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    {block.title}
                  </div>
                  {block.data.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-400">No data yet.</div>
                  ) : (
                    <ol className="mt-2 space-y-1 text-sm">
                      {block.data.map((row, idx) => (
                        <li key={row.puuid} className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                            <span className="text-slate-400">{idx + 1}.</span>
                            {row.iconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.iconUrl}
                                alt=""
                                className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                              />
                            ) : (
                              <div className="h-7 w-7 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                            )}
                            <span>{row.name}</span>
                          </span>
                          <span className={`font-semibold tabular-nums ${getKdaColor(row.kda.value)}`}>
                            {row.kda.label} KDA
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-gradient-to-r from-violet-400 to-violet-600" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Time &amp; Length Highlights
              </h3>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Longest Game Length
                </div>
                {longestGamesTop.length === 0 ? (
                  <div className="mt-2 text-xs text-slate-400">No data yet.</div>
                ) : (
                  <ol className="mt-2 space-y-1 text-sm">
                    {longestGamesTop.map((row, idx) => (
                      <li key={row.matchId} className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                          <span className="text-slate-400">{idx + 1}.</span>
                          {row.playerIconUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.playerIconUrl}
                              alt=""
                              className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                            />
                          ) : (
                            <div className="h-7 w-7 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                          )}
                          <span>{row.playerName}</span>
                        </span>
                        <span className="text-slate-900 font-semibold tabular-nums dark:text-slate-100">
                          {formatMatchDuration(row.durationS)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Longest Individual Total Time Played
                </div>
                {longestTotalTimeTop.length === 0 ? (
                  <div className="mt-2 text-xs text-slate-400">No data yet.</div>
                ) : (
                  <ol className="mt-2 space-y-1 text-sm">
                    {longestTotalTimeTop.map((row, idx) => (
                      <li key={row.puuid} className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                          <span className="text-slate-400">{idx + 1}.</span>
                          {row.iconUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={row.iconUrl}
                              alt=""
                              className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                            />
                          ) : (
                            <div className="h-7 w-7 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                          )}
                          <span>{row.name}</span>
                        </span>
                        <span className="text-slate-900 font-semibold tabular-nums dark:text-slate-100">
                          {formatDaysHoursCaps(row.durationS)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
