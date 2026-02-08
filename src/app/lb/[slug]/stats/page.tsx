import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChampionMap, championIconUrl } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { getSeasonStartIso } from '@/lib/riot/season'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'
import ChampionTable from './ChampionTable'
import LeaderboardTabs from '@/components/LeaderboardTabs'

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
  end_type?: string | null
}

type MatchRow = {
  match_id: string
  game_duration_s: number | null
  game_end_ts: number | null
  queue_id?: number | null
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
  tagLine: string | null
  iconUrl: string | null
  games: number
  wins: number
  losses: number
  winrate: string
  kda: { value: number; label: string }
  avgCs: number
  overallGames: number
  overallWins: number
  overallLosses: number
  overallWinrate: string
  rankTier: string | null
  rankDivision: string | null
  rankLp: number | null
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

function topUniquePlayers<T extends { puuid: string }>(rows: T[], limit: number) {
  const seen = new Set<string>()
  const unique: T[] = []
  for (const row of rows) {
    if (seen.has(row.puuid)) continue
    seen.add(row.puuid)
    unique.push(row)
    if (unique.length >= limit) break
  }
  return unique
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

        {cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Rank Cutoffs
              </div>
            </div>
            {cutoffs.map((c) => (<div key={c.label} className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"><img src={c.icon} alt={c.label} className="w-12 h-12 object-contain drop-shadow-sm" /><div className="flex-1"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">{c.label}</div><div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div></div></div>))}
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
    { key: 'CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
    { key: 'GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
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
        <div className="mx-auto w-full max-w-[1460px] px-6 py-10 space-y-8">
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

  const seasonStartMs = new Date(getSeasonStartIso({ ddVersion })).getTime()

  const { data: stateRaw } = await supabase
    .from('player_riot_state')
    .select('puuid, profile_icon_id')
    .in('puuid', puuids)

  const stateBy = new Map((stateRaw ?? []).map((row) => [row.puuid, row]))

  const { data: rankSnapshotRaw } = await supabase
    .from('player_rank_snapshot')
    .select('puuid, queue_type, tier, rank, league_points')
    .in('puuid', puuids)

  const rankByPuuid = new Map((rankSnapshotRaw ?? []).map((row) => [row.puuid, row]))

  const { data: participantsRaw } = await supabase
    .from('match_participants')
    .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win, vision_score, end_type')
    .in('puuid', puuids)

  const matchIds = Array.from(new Set((participantsRaw ?? []).map((row) => row.match_id)))

  // ✅ BATCHED QUERY FIX: Fetch matches in chunks to avoid URL length limits
  const matchesRaw: MatchRow[] = []
  const BATCH_SIZE = 50
  
  if (matchIds.length > 0) {
    for (let i = 0; i < matchIds.length; i += BATCH_SIZE) {
      const batch = matchIds.slice(i, i + BATCH_SIZE)
      const { data } = await supabase
        .from('matches')
        .select('match_id, game_duration_s, game_end_ts, queue_id')
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
    const queueId = typeof row.queue_id === 'number' ? row.queue_id : null
    
    // ✅ Filter applied here in JavaScript to be safe against BigInt issues
    if (!endTs || endTs < seasonStartMs) continue
    if (queueId !== 420) continue

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

  const playerTotalsByPuuid = new Map(playerLeaderboard.map((player) => [player.puuid, player]))

  const championLeaderboard = Array.from(championsTotals.entries()).map(([championId, stats]) => {
    const champion = champMap[championId]
    const kda = formatAverageKda(stats.kills, stats.assists, stats.deaths)
    const avgCs = stats.games ? stats.cs / stats.games : 0
    const winrateValue = stats.games ? stats.wins / stats.games : 0

    const playersStats: ChampionPlayerRow[] = Array.from(championPlayers.get(championId)?.entries() ?? []).map(([puuid, values]) => {
      const player = playersByPuuid.get(puuid)
      const playerKda = formatAverageKda(values.kills, values.assists, values.deaths)
      const playerAvgCs = values.games ? values.cs / values.games : 0
      const overall = playerTotalsByPuuid.get(puuid)
      const rank = rankByPuuid.get(puuid)
      return {
        puuid,
        name: player ? displayRiotId(player) : puuid,
        tagLine: player?.tag_line ?? null,
        iconUrl: profileIconUrl(stateBy.get(puuid)?.profile_icon_id ?? null, ddVersion),
        games: values.games,
        wins: values.wins,
        losses: values.losses,
        winrate: formatWinrate(values.wins, values.games),
        kda: playerKda,
        avgCs: playerAvgCs,
        overallGames: overall?.games ?? values.games,
        overallWins: overall?.wins ?? values.wins,
        overallLosses: overall?.losses ?? values.losses,
        overallWinrate: overall?.winrate ?? formatWinrate(values.wins, values.games),
        rankTier: rank?.tier ?? null,
        rankDivision: rank?.rank ?? null,
        rankLp: rank?.league_points ?? null,
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

  const averagePerGame = (value: number, games: number) => (games > 0 ? value / games : 0)
  const topKills = [...playerLeaderboard]
    .sort((a, b) => averagePerGame(b.kills, b.games) - averagePerGame(a.kills, a.games))
    .slice(0, 5)
  const topDeaths = [...playerLeaderboard]
    .sort((a, b) => averagePerGame(b.deaths, b.games) - averagePerGame(a.deaths, a.games))
    .slice(0, 5)
  const topAssists = [...playerLeaderboard]
    .sort((a, b) => averagePerGame(b.assists, b.games) - averagePerGame(a.assists, a.games))
    .slice(0, 5)
  const topKdaPlayers = [...playerLeaderboard].sort((a, b) => b.kda.value - a.kda.value).slice(0, 5)
  const bottomKdaPlayers = [...playerLeaderboard].sort((a, b) => a.kda.value - b.kda.value).slice(0, 5)
  const topWinratePlayers = [...playerLeaderboard].sort((a, b) => b.wins / b.games - a.wins / a.games).slice(0, 5)
  const topTotalTime = [...playerLeaderboard].sort((a, b) => b.durationS - a.durationS).slice(0, 5)

  const topKillsSingle = topUniquePlayers([...participants].sort((a, b) => b.kills - a.kills), 3)
  const topDeathsSingle = topUniquePlayers([...participants].sort((a, b) => b.deaths - a.deaths), 3)
  const topAssistsSingle = topUniquePlayers([...participants].sort((a, b) => b.assists - a.assists), 3)
  const topCsSingle = topUniquePlayers([...participants].sort((a, b) => b.cs - a.cs), 3)
  const topVisionSingle = topUniquePlayers(
    [...participants]
      .filter((row) => typeof row.vision_score === 'number')
      .sort((a, b) => (b.vision_score ?? 0) - (a.vision_score ?? 0)),
    3,
  )

  const singleGameBlocks = [
    { title: 'Most Kills in One Game', data: topKillsSingle, key: 'kills', accent: 'from-rose-400 to-rose-600' },
    { title: 'Most Deaths in One Game', data: topDeathsSingle, key: 'deaths', accent: 'from-slate-400 to-slate-600' },
    { title: 'Most Assists in One Game', data: topAssistsSingle, key: 'assists', accent: 'from-emerald-400 to-emerald-600' },
    { title: 'Most CS in One Game', data: topCsSingle, key: 'cs', accent: 'from-sky-400 to-sky-600' },
    { title: 'Most Vision Score in One Game', data: topVisionSingle, key: 'vision_score', accent: 'from-violet-400 to-violet-600' },
  ]
  const singleGameTopRow = singleGameBlocks.slice(0, 3)
  const singleGameBottomRow = singleGameBlocks.slice(3)

  const participantsByMatch = new Map<string, MatchParticipant[]>()
  for (const row of participants) {
    const matchParticipants = participantsByMatch.get(row.match_id)
    if (matchParticipants) {
      matchParticipants.push(row)
    } else {
      participantsByMatch.set(row.match_id, [row])
    }
  }


  const endTypeByMatch = new Map<string, string>()
  for (const row of participants) {
    if (!row.end_type) continue
    if (!endTypeByMatch.has(row.match_id)) {
      endTypeByMatch.set(row.match_id, row.end_type)
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
      puuid: representative?.puuid ?? 'Unknown',
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
  const bestKdaPlayersTop = topKdaPlayers.slice(0, 5)
  const worstKdaPlayersTop = bottomKdaPlayers.slice(0, 5)
  const longestTotalTimeTop = topTotalTime.slice(0, 3)
  const winsWithDuration = participants.filter((row) => row.win && (matchById.get(row.match_id)?.durationS ?? 0) > 0)
  const lossesWithDuration = participants.filter((row) => !row.win && (matchById.get(row.match_id)?.durationS ?? 0) > 0)
  const winDurationByPuuid = new Map<string, { total: number; wins: number }>()
  for (const row of winsWithDuration) {
    const durationS = matchById.get(row.match_id)?.durationS ?? 0
    if (!durationS) continue
    const entry = winDurationByPuuid.get(row.puuid) ?? { total: 0, wins: 0 }
    entry.total += durationS
    entry.wins += 1
    winDurationByPuuid.set(row.puuid, entry)
  }
  const lossDurationByPuuid = new Map<string, { total: number; losses: number }>()
  for (const row of lossesWithDuration) {
    const durationS = matchById.get(row.match_id)?.durationS ?? 0
    if (!durationS) continue
    const entry = lossDurationByPuuid.get(row.puuid) ?? { total: 0, losses: 0 }
    entry.total += durationS
    entry.losses += 1
    lossDurationByPuuid.set(row.puuid, entry)
  }
  const fastestWinTimesTop = Array.from(winDurationByPuuid.entries())
    .map(([puuid, stats]) => {
      const player = playersByPuuid.get(puuid)
      return {
        puuid,
        name: player ? displayRiotId(player) : puuid,
        iconUrl: profileIconUrl(stateBy.get(puuid)?.profile_icon_id ?? null, ddVersion),
        avgWinDurationS: stats.wins ? stats.total / stats.wins : 0,
      }
    })
    .filter((row) => row.avgWinDurationS > 0)
    .sort((a, b) => a.avgWinDurationS - b.avgWinDurationS)
    .slice(0, 3)
  const fastestLossTimesTop = Array.from(lossDurationByPuuid.entries())
    .map(([puuid, stats]) => {
      const player = playersByPuuid.get(puuid)
      return {
        puuid,
        name: player ? displayRiotId(player) : puuid,
        iconUrl: profileIconUrl(stateBy.get(puuid)?.profile_icon_id ?? null, ddVersion),
        avgLossDurationS: stats.losses ? stats.total / stats.losses : 0,
      }
    })
    .filter((row) => row.avgLossDurationS > 0)
    .sort((a, b) => a.avgLossDurationS - b.avgLossDurationS)
    .slice(0, 3)

  const noGames = participants.length === 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full max-w-none px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            slug={slug}
            visibility={lb.visibility}
            activeTab="stats"
            cutoffs={cutoffsDisplay}
            bannerUrl={lb.banner_url}
          />
        </div>

        <div className="mx-auto w-full max-w-[1460px] space-y-10 lg:space-y-12">
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

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {noGames ? (
                <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">No champion data yet.</div>
              ) : (
                <ChampionTable rows={championTableRows} />
              )}
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <div className="flex items-center gap-2">
                <div className="h-1 w-8 rounded-full bg-gradient-to-r from-rose-400 to-rose-600" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Single Game High Scores
                </h3>
              </div>

              <div className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {singleGameTopRow.map((block) => (
                    <div
                      key={block.title}
                      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60"
                    >
                      <div className="p-4">
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                          {block.title}
                        </div>
                        {block.data.length === 0 ? (
                          <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                        ) : (
                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                              {block.data.map((row, idx) => {
                                const player = playersByPuuid.get(row.puuid)
                                const iconUrl = profileIconUrl(stateBy.get(row.puuid)?.profile_icon_id ?? null, ddVersion)
                                const champ = champMap[row.champion_id]
                                const orderClass = idx === 0 ? 'sm:order-2' : idx === 1 ? 'sm:order-1' : 'sm:order-3'
                                const sizeClass = idx === 0 ? 'sm:scale-105' : idx === 2 ? 'sm:scale-95' : 'sm:scale-100'
                                return (
                                  <div key={`${row.match_id}-${row.puuid}`} className={orderClass}>
                                    <div className={`relative px-4 py-3 ${sizeClass}`}>
                                      <div className="flex flex-col items-center text-center gap-2">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{idx + 1}</div>
                                        <div className={`relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 ${
                                          idx === 0
                                            ? 'border-amber-400'
                                            : idx === 1
                                              ? 'border-slate-300'
                                              : 'border-orange-500'
                                        }`}>
                                          <div className="h-full w-full overflow-hidden rounded-full">
                                            {iconUrl ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img src={iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
                                            ) : (
                                              <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                            )}
                                          </div>
                                          {champ?.id ? (
                                            <span className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full border-2 border-slate-900 bg-slate-100 shadow-sm overflow-hidden dark:border-slate-900 dark:bg-slate-800">
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={championIconUrl(ddVersion, champ.id)}
                                                alt=""
                                                className="h-full w-full rounded-full object-cover"
                                              />
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-100">
                                            {player ? displayRiotId(player) : row.puuid}
                                          </div>
                                        </div>
                                        <div className="text-2xl font-black tabular-nums text-slate-100">
                                          {row[block.key as keyof typeof row]}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
                  {singleGameBottomRow.map((block, idx) => (
                    <div
                      key={block.title}
                      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60 lg:col-span-2 ${
                        idx === 0 ? 'lg:col-start-2' : 'lg:col-start-4'
                      }`}
                    >
                      <div className="p-4">
                      <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                        {block.title}
                      </div>
                      {block.data.length === 0 ? (
                        <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                        ) : (
                          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                              {block.data.map((row, idx) => {
                                const player = playersByPuuid.get(row.puuid)
                                const iconUrl = profileIconUrl(stateBy.get(row.puuid)?.profile_icon_id ?? null, ddVersion)
                                const champ = champMap[row.champion_id]
                                const orderClass = idx === 0 ? 'sm:order-2' : idx === 1 ? 'sm:order-1' : 'sm:order-3'
                                const sizeClass = idx === 0 ? 'sm:scale-105' : idx === 2 ? 'sm:scale-95' : 'sm:scale-100'
                                return (
                                  <div key={`${row.match_id}-${row.puuid}`} className={orderClass}>
                                    <div className={`relative px-4 py-3 ${sizeClass}`}>
                                      <div className="flex flex-col items-center text-center gap-2">
                                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{idx + 1}</div>
                                        <div className={`relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 ${
                                          idx === 0
                                            ? 'border-amber-400'
                                            : idx === 1
                                              ? 'border-slate-300'
                                              : 'border-orange-500'
                                        }`}>
                                          <div className="h-full w-full overflow-hidden rounded-full">
                                            {iconUrl ? (
                                              // eslint-disable-next-line @next/next/no-img-element
                                              <img src={iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
                                            ) : (
                                              <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                            )}
                                          </div>
                                          {champ?.id ? (
                                            <span className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full border-2 border-slate-900 bg-slate-100 shadow-sm overflow-hidden dark:border-slate-900 dark:bg-slate-800">
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={championIconUrl(ddVersion, champ.id)}
                                                alt=""
                                                className="h-full w-full rounded-full object-cover"
                                              />
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="min-w-0">
                                          <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-100">
                                            {player ? displayRiotId(player) : row.puuid}
                                          </div>
                                        </div>
                                        <div className="text-2xl font-black tabular-nums text-slate-100">
                                          {row[block.key as keyof typeof row]}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                          </div>
                        )}
                    </div>
                  </div>
                ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="flex items-center gap-2">
                <div className="h-1 w-8 rounded-full bg-gradient-to-r from-amber-400 to-amber-600" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Player Accumulative Rankings
                </h3>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-5">
                {[
                  {
                    title: 'Most Avg Kills / Game',
                    data: topKills,
                    accent: 'from-rose-400 to-rose-600',
                    value: (row: typeof topKills[number]) => averagePerGame(row.kills, row.games).toFixed(2),
                  },
                  {
                    title: 'Most Avg Deaths / Game',
                    data: topDeaths,
                    accent: 'from-slate-400 to-slate-600',
                    value: (row: typeof topDeaths[number]) => averagePerGame(row.deaths, row.games).toFixed(2),
                  },
                  {
                    title: 'Most Avg Assists / Game',
                    data: topAssists,
                    accent: 'from-emerald-400 to-emerald-600',
                    value: (row: typeof topAssists[number]) => averagePerGame(row.assists, row.games).toFixed(2),
                  },
                  {
                    title: 'Best Overall KDA',
                    data: bestKdaPlayersTop,
                    accent: 'from-sky-400 to-sky-600',
                    value: (row: typeof bestKdaPlayersTop[number]) => row.kda.label,
                    valueClass: (row: typeof bestKdaPlayersTop[number]) => getKdaColor(row.kda.value),
                  },
                  {
                    title: 'Worst Overall KDA',
                    data: worstKdaPlayersTop,
                    accent: 'from-amber-400 to-amber-600',
                    value: (row: typeof worstKdaPlayersTop[number]) => row.kda.label,
                    valueClass: (row: typeof worstKdaPlayersTop[number]) => getKdaColor(row.kda.value),
                  },
                ].map((block) => {
                  const topPlayer = block.data[0]
                  return (
                    <div
                      key={block.title}
                      className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60"
                    >
                      <div className="p-5">
                        <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                          {block.title}
                        </div>
                        {block.data.length === 0 ? (
                          <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                        ) : (
                          <>
                            <div className="mt-4 flex items-center gap-3">
                              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                                {topPlayer.iconUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={topPlayer.iconUrl} alt="" className="h-full w-full object-cover" />
                                ) : (
                                  <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[12px] font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap leading-tight tracking-tight">
                                  {topPlayer.name}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  ({topPlayer.games.toLocaleString()} games)
                                </div>
                              </div>
                              <div
                                className={`text-3xl font-black tabular-nums ${
                                  'valueClass' in block && typeof block.valueClass === 'function'
                                    ? block.valueClass(topPlayer)
                                    : 'text-slate-900 dark:text-slate-100'
                                }`}
                              >
                                {block.value(topPlayer)}
                              </div>
                            </div>

                            <ol className="mt-4 space-y-2 text-sm">
                              {block.data.slice(1).map((row, idx) => (
                                <li key={row.puuid} className="flex items-center justify-between">
                                  <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200 min-w-0">
                                    <span className="text-slate-400">{idx + 2}.</span>
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
                                    <span className="text-[12px] whitespace-nowrap leading-tight tracking-tight">{row.name}</span>
                                  </span>
                                  <span
                                    className={`font-semibold tabular-nums ${
                                      'valueClass' in block && typeof block.valueClass === 'function'
                                        ? block.valueClass(row)
                                        : 'text-slate-900 dark:text-slate-100'
                                    }`}
                                  >
                                    {block.value(row)}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}

              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="flex items-center gap-2">
                <div className="h-1 w-8 rounded-full bg-gradient-to-r from-violet-400 to-violet-600" />
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                  Time &amp; Length Highlights
                </h3>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60">
                  <div className="p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Longest Game Length
                    </div>
                    {longestGamesTop.length === 0 ? (
                      <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                    ) : (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        {longestGamesTop.map((row, idx) => {
                          const orderClass = idx === 0 ? 'sm:order-2' : idx === 1 ? 'sm:order-1' : 'sm:order-3'
                          const sizeClass = idx === 0 ? 'sm:scale-105' : idx === 2 ? 'sm:scale-95' : 'sm:scale-100'
                          return (
                            <div key={row.matchId} className={orderClass}>
                              <div className={`relative px-4 py-3 ${sizeClass}`}>
                                <div className="flex flex-col items-center text-center gap-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{idx + 1}</div>
                                  <div
                                    className={`relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 ${
                                      idx === 0
                                        ? 'border-amber-400'
                                        : idx === 1
                                          ? 'border-slate-300'
                                          : 'border-orange-500'
                                    }`}
                                  >
                                    <div className="h-full w-full overflow-hidden rounded-full">
                                      {row.playerIconUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={row.playerIconUrl}
                                          alt=""
                                          className="h-full w-full rounded-full object-cover"
                                        />
                                      ) : (
                                        <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-100">
                                      {row.playerName}
                                    </div>
                                  </div>
                                  <div className="text-2xl font-black tabular-nums text-slate-100">
                                    {formatMatchDuration(row.durationS)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60">
                  <div className="p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Fastest Average Win Times
                    </div>
                    {fastestWinTimesTop.length === 0 ? (
                      <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                    ) : (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        {fastestWinTimesTop.map((row, idx) => {
                          const orderClass = idx === 0 ? 'sm:order-2' : idx === 1 ? 'sm:order-1' : 'sm:order-3'
                          const sizeClass = idx === 0 ? 'sm:scale-105' : idx === 2 ? 'sm:scale-95' : 'sm:scale-100'
                          return (
                            <div key={row.puuid} className={orderClass}>
                              <div className={`relative px-4 py-3 ${sizeClass}`}>
                                <div className="flex flex-col items-center text-center gap-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{idx + 1}</div>
                                  <div
                                    className={`relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 ${
                                      idx === 0
                                        ? 'border-amber-400'
                                        : idx === 1
                                          ? 'border-slate-300'
                                          : 'border-orange-500'
                                    }`}
                                  >
                                    <div className="h-full w-full overflow-hidden rounded-full">
                                      {row.iconUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={row.iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
                                      ) : (
                                        <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-100">
                                      {row.name}
                                    </div>
                                  </div>
                                  <div className="text-2xl font-black tabular-nums text-slate-100">
                                    {formatMatchDuration(row.avgWinDurationS)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60">
                  <div className="p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Fastest Average Loss Times
                    </div>
                    {fastestLossTimesTop.length === 0 ? (
                      <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                    ) : (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        {fastestLossTimesTop.map((row, idx) => {
                          const orderClass = idx === 0 ? 'sm:order-2' : idx === 1 ? 'sm:order-1' : 'sm:order-3'
                          const sizeClass = idx === 0 ? 'sm:scale-105' : idx === 2 ? 'sm:scale-95' : 'sm:scale-100'
                          return (
                            <div key={row.puuid} className={orderClass}>
                              <div className={`relative px-4 py-3 ${sizeClass}`}>
                                <div className="flex flex-col items-center text-center gap-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{idx + 1}</div>
                                  <div
                                    className={`relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 ${
                                      idx === 0
                                        ? 'border-amber-400'
                                        : idx === 1
                                          ? 'border-slate-300'
                                          : 'border-orange-500'
                                    }`}
                                  >
                                    <div className="h-full w-full overflow-hidden rounded-full">
                                      {row.iconUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={row.iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
                                      ) : (
                                        <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-100">
                                      {row.name}
                                    </div>
                                  </div>
                                  <div className="text-2xl font-black tabular-nums text-slate-100">
                                    {formatMatchDuration(row.avgLossDurationS)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60">
                  <div className="p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      Longest Individual Total Time Played
                    </div>
                    {longestTotalTimeTop.length === 0 ? (
                      <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                    ) : (
                      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                        {longestTotalTimeTop.map((row, idx) => {
                          const orderClass = idx === 0 ? 'sm:order-2' : idx === 1 ? 'sm:order-1' : 'sm:order-3'
                          const sizeClass = idx === 0 ? 'sm:scale-105' : idx === 2 ? 'sm:scale-95' : 'sm:scale-100'
                          return (
                            <div key={row.puuid} className={orderClass}>
                              <div className={`relative px-4 py-3 ${sizeClass}`}>
                                <div className="flex flex-col items-center text-center gap-2">
                                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{idx + 1}</div>
                                  <div
                                    className={`relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 ${
                                      idx === 0
                                        ? 'border-amber-400'
                                        : idx === 1
                                          ? 'border-slate-300'
                                          : 'border-orange-500'
                                    }`}
                                  >
                                    <div className="h-full w-full overflow-hidden rounded-full">
                                      {row.iconUrl ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={row.iconUrl} alt="" className="h-full w-full rounded-full object-cover" />
                                      ) : (
                                        <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-100">
                                      {row.name}
                                    </div>
                                  </div>
                                  <div className="text-2xl font-black tabular-nums text-slate-100">
                                    {formatDaysHoursCaps(row.durationS)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
