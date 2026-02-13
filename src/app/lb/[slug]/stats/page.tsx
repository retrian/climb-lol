import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getChampionMap, championIconUrl } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { getSeasonStartIso } from '@/lib/riot/season'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'
import ChampionTable from './ChampionTable'
import StatsHighlightsClient, { type ListBlock, type PodiumBlock } from '@/app/lb/[slug]/stats/StatsHighlightsClient'
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

type MatchParticipantRow = MatchParticipant & {
  matches: {
    game_duration_s: number | null
    game_end_ts: number | null
    queue_id?: number | null
  } | null
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

function topUniquePlayers<T extends { puuid: string }>(rows: T[], limit = Number.POSITIVE_INFINITY) {
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

function uniqueByPuuid<T extends { puuid: string }>(rows: T[]) {
  return topUniquePlayers(rows)
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


  const rankByPuuid = new Map(
    (rankSnapshotRaw ?? [])
      .filter((row) => row.queue_type === 'RANKED_SOLO_5x5')
      .map((row) => [row.puuid, row])
  )

  const { data: participantsRaw } = await supabase
    .from('match_participants')
    .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win, vision_score, end_type, matches!inner(game_duration_s, game_end_ts, queue_id)')
    .in('puuid', puuids)
    .eq('matches.queue_id', 420)
    .gte('matches.game_end_ts', seasonStartMs)


  // Build match Map from joined matches to avoid separate batched queries
  const matchById = new Map<string, { durationS: number; endTs: number }>()
  const participants: MatchParticipant[] = []

  const participantRows = (participantsRaw ?? []) as unknown as MatchParticipantRow[]
  for (const row of participantRows) {
    const match = Array.isArray(row.matches) ? row.matches[0] : row.matches
    if (!match || typeof match.game_end_ts !== 'number') continue
    matchById.set(row.match_id, {
      durationS: typeof match.game_duration_s === 'number' ? match.game_duration_s : 0,
      endTs: match.game_end_ts,
    })
    participants.push({
      match_id: row.match_id,
      puuid: row.puuid,
      champion_id: row.champion_id,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      cs: row.cs,
      win: row.win,
      vision_score: row.vision_score,
      end_type: row.end_type,
    })
  }

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
  const topKills = uniqueByPuuid([...playerLeaderboard].sort((a, b) => averagePerGame(b.kills, b.games) - averagePerGame(a.kills, a.games)))
  const topDeaths = uniqueByPuuid([...playerLeaderboard].sort((a, b) => averagePerGame(b.deaths, b.games) - averagePerGame(a.deaths, a.games)))
  const topAssists = uniqueByPuuid([...playerLeaderboard].sort((a, b) => averagePerGame(b.assists, b.games) - averagePerGame(a.assists, a.games)))
  const topKdaPlayers = uniqueByPuuid([...playerLeaderboard].sort((a, b) => b.kda.value - a.kda.value))
  const bottomKdaPlayers = uniqueByPuuid([...playerLeaderboard].sort((a, b) => a.kda.value - b.kda.value))
  const topTotalTime = uniqueByPuuid([...playerLeaderboard].sort((a, b) => b.durationS - a.durationS))

  const topKillsSingle = topUniquePlayers([...participants].sort((a, b) => b.kills - a.kills))
  const topDeathsSingle = topUniquePlayers([...participants].sort((a, b) => b.deaths - a.deaths))
  const topAssistsSingle = topUniquePlayers([...participants].sort((a, b) => b.assists - a.assists))
  const topCsSingle = topUniquePlayers([...participants].sort((a, b) => b.cs - a.cs))
  const topVisionSingle = topUniquePlayers(
    [...participants]
      .filter((row) => typeof row.vision_score === 'number')
      .sort((a, b) => (b.vision_score ?? 0) - (a.vision_score ?? 0)),
  )

  const singleGameBlocks = [
    { id: 'single-kills', title: 'Most Kills in One Game', data: topKillsSingle, key: 'kills', accent: 'from-rose-400 to-rose-600' },
    { id: 'single-deaths', title: 'Most Deaths in One Game', data: topDeathsSingle, key: 'deaths', accent: 'from-slate-400 to-slate-600' },
    { id: 'single-assists', title: 'Most Assists in One Game', data: topAssistsSingle, key: 'assists', accent: 'from-emerald-400 to-emerald-600' },
    { id: 'single-cs', title: 'Most CS in One Game', data: topCsSingle, key: 'cs', accent: 'from-sky-400 to-sky-600' },
    { id: 'single-vision', title: 'Most Vision Score in One Game', data: topVisionSingle, key: 'vision_score', accent: 'from-violet-400 to-violet-600' },
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

  const longestMatches = uniqueByPuuid(
    matchSummaries
      .filter((match) => match.durationS > 0)
      .sort((a, b) => b.durationS - a.durationS),
  )


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
  const fastestWinTimesAll = uniqueByPuuid(
    Array.from(winDurationByPuuid.entries())
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
    .sort((a, b) => a.avgWinDurationS - b.avgWinDurationS),
  )
  const fastestLossTimesAll = uniqueByPuuid(
    Array.from(lossDurationByPuuid.entries())
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
    .sort((a, b) => a.avgLossDurationS - b.avgLossDurationS),
  )

  const noGames = participants.length === 0

  const singleGameTopBlocks: PodiumBlock[] = singleGameTopRow.map((block) => ({
    id: block.id,
    title: block.title,
    accent: block.accent,
    entries: block.data.map((row) => {
      const player = playersByPuuid.get(row.puuid)
      return {
        puuid: row.puuid,
        name: player ? displayRiotId(player) : row.puuid,
        iconUrl: profileIconUrl(stateBy.get(row.puuid)?.profile_icon_id ?? null, ddVersion),
        value: row[block.key as keyof typeof row] as number,
      }
    }),
  }))

  const singleGameBottomBlocks: PodiumBlock[] = singleGameBottomRow.map((block) => ({
    id: block.id,
    title: block.title,
    accent: block.accent,
    entries: block.data.map((row) => {
      const player = playersByPuuid.get(row.puuid)
      return {
        puuid: row.puuid,
        name: player ? displayRiotId(player) : row.puuid,
        iconUrl: profileIconUrl(stateBy.get(row.puuid)?.profile_icon_id ?? null, ddVersion),
        value: row[block.key as keyof typeof row] as number,
      }
    }),
  }))

  const playerBlocks: ListBlock[] = [
    {
      id: 'avg-kills',
      title: 'Most Avg Kills / Game',
      accent: 'from-rose-400 to-rose-600',
      entries: topKills.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: averagePerGame(row.kills, row.games).toFixed(2),
      })),
    },
    {
      id: 'avg-deaths',
      title: 'Most Avg Deaths / Game',
      accent: 'from-slate-400 to-slate-600',
      entries: topDeaths.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: averagePerGame(row.deaths, row.games).toFixed(2),
      })),
    },
    {
      id: 'avg-assists',
      title: 'Most Avg Assists / Game',
      accent: 'from-emerald-400 to-emerald-600',
      entries: topAssists.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: averagePerGame(row.assists, row.games).toFixed(2),
      })),
    },
    {
      id: 'best-kda',
      title: 'Best Overall KDA',
      accent: 'from-sky-400 to-sky-600',
      entries: topKdaPlayers.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: row.kda.value,
        valueLabel: row.kda.label,
        valueClassName: getKdaColor(row.kda.value),
      })),
    },
    {
      id: 'worst-kda',
      title: 'Worst Overall KDA',
      accent: 'from-amber-400 to-amber-600',
      entries: bottomKdaPlayers.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: row.kda.value,
        valueLabel: row.kda.label,
        valueClassName: getKdaColor(row.kda.value),
      })),
    },
  ]

  const timeBlocks: PodiumBlock[] = [
    {
      id: 'longest-game',
      title: 'Longest Game Length',
      accent: 'from-violet-400 to-violet-600',
      entries: longestMatches.map((row) => ({
        puuid: row.puuid,
        name: row.playerName,
        iconUrl: row.playerIconUrl,
        value: row.durationS,
        valueLabel: formatMatchDuration(row.durationS),
      })),
    },
    {
      id: 'fastest-win',
      title: 'Fastest Average Win Times',
      accent: 'from-violet-400 to-violet-600',
      entries: fastestWinTimesAll.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: row.avgWinDurationS,
        valueLabel: formatMatchDuration(row.avgWinDurationS),
      })),
    },
    {
      id: 'fastest-loss',
      title: 'Fastest Average Loss Times',
      accent: 'from-violet-400 to-violet-600',
      entries: fastestLossTimesAll.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: row.avgLossDurationS,
        valueLabel: formatMatchDuration(row.avgLossDurationS),
      })),
    },
    {
      id: 'total-time',
      title: 'Longest Individual Total Time Played',
      accent: 'from-violet-400 to-violet-600',
      entries: topTotalTime.map((row) => ({
        puuid: row.puuid,
        name: row.name,
        iconUrl: row.iconUrl,
        value: row.durationS,
        valueLabel: formatDaysHoursCaps(row.durationS),
      })),
    },
  ]


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

          <StatsHighlightsClient
            singleGameTopRow={singleGameTopBlocks}
            singleGameBottomRow={singleGameBottomBlocks}
            playerBlocks={playerBlocks}
            timeBlocks={timeBlocks}
          />
        </div>
      </div>
    </main>
  )
}
