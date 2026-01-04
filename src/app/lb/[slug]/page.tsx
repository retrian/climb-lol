import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { timeAgo } from '@/lib/timeAgo'
import { getChampionMap, championIconUrl } from '@/lib/champions'
import { formatRank } from '@/lib/rankFormat'
import { compareRanks } from '@/lib/rankSort'

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

function syncTimeAgo(iso?: string | null) {
  if (!iso) return 'never'
  return timeAgo(new Date(iso).getTime())
}

function profileIconUrl(profileIconId?: number | null) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.1.1'
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profileIconId}.png`
}

function queueLabel(queueId?: number | null) {
  if (queueId === 420) return 'Solo/Duo'
  if (queueId === 440) return 'Flex'
  return queueId ? `Queue ${queueId}` : 'Game'
}

function formatDuration(durationS?: number | null) {
  if (!durationS) return ''
  const m = Math.floor(durationS / 60)
  return `${m}m`
}

function formatWinrate(wins?: number | null, losses?: number | null) {
  const w = wins ?? 0
  const l = losses ?? 0
  const total = w + l
  if (total === 0) return { wins: 0, losses: 0, percentage: 0, label: '0W - 0L 0%' }
  const pct = Math.round((w / total) * 100)
  return {
    wins: w,
    losses: l,
    percentage: Math.min(100, Math.max(0, pct)),
    label: `${w}W - ${l}L ${pct}%`,
  }
}

export default async function LeaderboardDetail({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const ddVersion = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.1.1'
  const champMap = await getChampionMap(ddVersion)

  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, description, visibility')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  const { data: playersRaw } = await supabase
    .from('leaderboard_players')
    .select('id, puuid, game_name, tag_line, role, twitch_url, twitter_url, sort_order')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(15)

  const players = playersRaw ?? []
  const puuids = players.map((p) => p.puuid).filter(Boolean)

  function displayRiotId(p: any) {
    const gn = (p.game_name ?? '').trim()
    const tl = (p.tag_line ?? '').trim()
    if (gn && tl) return `${gn}#${tl}`
    return p.puuid
  }

  if (players.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900">{lb.name}</h1>
          {lb.description && <p className="mt-2 text-gray-600">{lb.description}</p>}
        </div>

        <section className="mb-12">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Players</h2>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm font-medium text-gray-900">No players yet</p>
            <p className="mt-1 text-xs text-gray-500">Players will appear here once they're added.</p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Latest Games</h2>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm font-medium text-gray-900">No games yet</p>
            <p className="mt-1 text-xs text-gray-500">Once matches are ingested, they’ll appear here.</p>
          </div>
        </section>
      </main>
    )
  }

  const [{ data: statesRaw }, { data: ranksRaw }, { data: champsRaw }] = await Promise.all([
    supabase
      .from('player_riot_state')
      .select('puuid, profile_icon_id, last_rank_sync_at, last_matches_sync_at, last_error')
      .in('puuid', puuids),
    supabase
      .from('player_rank_snapshot')
      .select('puuid, queue_type, tier, rank, league_points, wins, losses, fetched_at')
      .in('puuid', puuids),
    supabase
      .from('player_top_champions')
      .select('puuid, champion_id, games, wins, last_played_ts, computed_at')
      .in('puuid', puuids),
  ])

  const stateBy = new Map((statesRaw ?? []).map((s) => [s.puuid, s]))
  const ranks = ranksRaw ?? []
  const champs = champsRaw ?? []

  const rankBy = new Map<string, any>()
  for (const puuid of puuids) {
    const solo = ranks.find((r) => r.puuid === puuid && r.queue_type === 'RANKED_SOLO_5x5')
    const flex = ranks.find((r) => r.puuid === puuid && r.queue_type === 'RANKED_FLEX_SR')
    rankBy.set(puuid, solo ?? flex ?? null)
  }

  const playersSorted = [...players].sort((a, b) => {
    const rankA = rankBy.get(a.puuid)
    const rankB = rankBy.get(b.puuid)
    return compareRanks(rankA, rankB)
  })

  const champsBy = new Map<string, any[]>()
  for (const row of champs) {
    const arr = champsBy.get(row.puuid) ?? []
    arr.push(row)
    champsBy.set(row.puuid, arr)
  }
  for (const [puuid, arr] of champsBy.entries()) {
    arr.sort((a, b) => (b.games ?? 0) - (a.games ?? 0) || (b.last_played_ts ?? 0) - (a.last_played_ts ?? 0))
    champsBy.set(puuid, arr.slice(0, 5))
  }

  const { data: cutsRaw } = await supabase
    .from('rank_cutoffs')
    .select('queue_type, tier, cutoff_lp')
    .in('tier', ['GRANDMASTER', 'CHALLENGER'])
    .order('queue_type', { ascending: true })
    .order('tier', { ascending: false })

  const cutoffsByQueueTier = new Map(
    (cutsRaw ?? []).map((c) => [`${c.queue_type}::${c.tier}`, c.cutoff_lp as number])
  )

  const { data: latestRaw } = await supabase.rpc('get_leaderboard_latest_games', {
    lb_id: lb.id,
    lim: 10,
  })

  const latestGames = (latestRaw ?? []).map((row: any) => ({
    matchId: row.match_id as string,
    puuid: row.puuid as string,
    championId: row.champion_id as number,
    k: row.kills as number,
    d: row.deaths as number,
    a: row.assists as number,
    cs: row.cs as number,
    win: row.win as boolean,
    endTs: row.game_end_ts as number | undefined,
    durationS: row.game_duration_s as number | undefined,
    queueId: row.queue_id as number | undefined,
  }))

  const lastUpdatedIso = puuids
    .map((p) => stateBy.get(p)?.last_rank_sync_at ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) as string | null

  const playersByPuuid = new Map(players.map((p) => [p.puuid, p]))

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:py-12">
      {/* Header */}
      <div className="mb-8 sm:mb-10">
        <h1 className="text-3xl font-bold text-gray-900">{lb.name}</h1>
        {lb.description && <p className="mt-2 text-gray-600">{lb.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="rounded-full border border-gray-200 bg-white px-2 py-1">{lb.visibility}</span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-1">
            Last updated: {syncTimeAgo(lastUpdatedIso)}
          </span>
        </div>

        {/* Rank Cutoffs (Solo/Duo only) */}
        {cutoffsByQueueTier.size > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {Array.from(
              new Map([
                ['RANKED_SOLO_5x5::CHALLENGER', 'Challenger'],
                ['RANKED_SOLO_5x5::GRANDMASTER', 'Grandmaster'],
              ])
            ).map(([key, label]) => {
              const lp = cutoffsByQueueTier.get(key)
              if (lp === undefined) return null
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900"
                >
                  <span className="text-amber-600">★</span>
                  {label}: {lp} LP
                </span>
              )
            })}
          </div>
        )}
      </div>

      {/* Players */}
      <section className="mb-10 sm:mb-12">
        <div className="mb-3 sm:mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Players</h2>
          <span className="text-sm text-gray-500">
            {players.length} {players.length === 1 ? 'player' : 'players'}
          </span>
        </div>

        <div className="space-y-3">
          {playersSorted.map((p, index) => {
            const st = stateBy.get(p.puuid)
            const r = rankBy.get(p.puuid)
            const icon = profileIconUrl(st?.profile_icon_id)
            const wr = formatWinrate(r?.wins, r?.losses)
            const top5 = champsBy.get(p.puuid) ?? []

            return (
              <div
                key={p.id}
                className="rounded-xl border border-gray-200 bg-white/60 p-3 sm:p-4 shadow-sm transition hover:shadow-md hover:border-gray-300"
              >
                {/* Top row */}
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-700">
                    #{index + 1}
                  </div>

                  <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    {icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={icon} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-500">
                        NA
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-900">{displayRiotId(p)}</div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      {p.role && (
                        <span className="rounded-md border border-gray-200 bg-white px-2 py-0.5">{p.role}</span>
                      )}
                      <span className="rounded-md border border-gray-200 bg-white px-2 py-0.5">
                        {formatRank(r?.tier, r?.rank, r?.league_points)}
                      </span>
                      <span className="text-gray-500">
                        Updated {syncTimeAgo(st?.last_rank_sync_at ?? st?.last_matches_sync_at)}
                      </span>
                    </div>

                    {/* Mobile socials (compact) */}
                    <div className="mt-2 flex gap-2 sm:hidden">
                      {p.twitch_url && (
                        <a
                          href={p.twitch_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700"
                        >
                          Twitch
                        </a>
                      )}
                      {p.twitter_url && (
                        <a
                          href={p.twitter_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700"
                        >
                          Twitter
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Desktop socials */}
                  <div className="hidden gap-2 sm:flex flex-shrink-0">
                    {p.twitch_url && (
                      <a
                        href={p.twitch_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Twitch"
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        Twitch
                      </a>
                    )}
                    {p.twitter_url && (
                      <a
                        href={p.twitter_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Twitter"
                        className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        Twitter
                      </a>
                    )}
                  </div>
                </div>

                {/* Winrate */}
                {wr.wins + wr.losses > 0 ? (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-600">
                      <span>{wr.label}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full bg-gray-900" style={{ width: `${wr.percentage}%` }} />
                    </div>
                  </div>
                ) : null}

                {/* Top Champions */}
                {top5.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {top5.map((c) => {
                      const champ = champMap[c.champion_id]
                      if (!champ) return null
                      return (
                        <img
                          key={c.champion_id}
                          src={championIconUrl(ddVersion, champ.id)}
                          alt={champ.name}
                          title={`${champ.name} • ${c.wins}W/${c.games}G`}
                          className="h-7 w-7 rounded-md"
                          loading="lazy"
                        />
                      )
                    })}
                  </div>
                )}

                {st?.last_error && (
                  <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    Sync error (kept last snapshot)
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Latest Games */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Latest Games</h2>

        {latestGames.length ? (
          <div className="space-y-2 sm:space-y-3">
            {latestGames.map((g: any) => {
              const p = playersByPuuid.get(g.puuid)
              const name = p ? displayRiotId(p) : g.puuid
              const when = g.endTs ? timeAgo(g.endTs) : ''
              const dur = formatDuration(g.durationS)

              const champ = champMap[g.championId]
              const champSrc = champ ? championIconUrl(ddVersion, champ.id) : null

              return (
                <div
                  key={`${g.matchId}-${g.puuid}`}
                  className="rounded-lg border border-gray-200 bg-white p-3 sm:p-4 shadow-sm"
                >
                  {/* Mobile-compact header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-sm font-medium text-gray-900">{name}</div>
                    <div className="text-[11px] sm:text-xs text-gray-500 whitespace-nowrap">
                      {queueLabel(g.queueId)} {dur ? `· ${dur}` : ''} {when ? `· ${when}` : ''}
                    </div>
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3">
                    {/* Left side */}
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${
                          g.win ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'
                        }`}
                      >
                        {g.win ? 'W' : 'L'}
                      </span>

                      {champSrc ? (
                        <img
                          src={champSrc}
                          alt={champ?.name ?? 'Champion'}
                          title={champ?.name ?? ''}
                          className="h-6 w-6 rounded"
                          loading="lazy"
                        />
                      ) : null}

                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900 tabular-nums">
                          {g.k}/{g.d}/{g.a}
                        </div>
                        <div className="text-xs text-gray-500">CS {g.cs}</div>
                      </div>
                    </div>

                    {/* Right side (kept minimal on mobile) */}
                    <div className="text-xs text-gray-500 tabular-nums">
                      {champ?.name ? <span className="hidden sm:inline">{champ.name}</span> : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm font-medium text-gray-900">No games yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Once the cron job ingests matches into the database, they’ll show here.
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
