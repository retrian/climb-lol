import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

function timeAgo(iso?: string | null) {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

// Optional: set NEXT_PUBLIC_DDRAGON_VERSION in env for stable URLs.
// If missing, we fall back to a reasonable default.
function profileIconUrl(profileIconId?: number | null) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '14.1.1'
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profileIconId}.png`
}

function queueLabel(queueId?: number | null) {
  // If you only ingest ranked solo (420), this is enough.
  if (queueId === 420) return 'Ranked Solo'
  if (queueId === 440) return 'Ranked Flex'
  return queueId ? `Queue ${queueId}` : 'Game'
}

export default async function LeaderboardDetail({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  // Load leaderboard (+ owner for PRIVATE enforcement)
  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, description, visibility')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  // Enforce PRIVATE (PUBLIC/UNLISTED are viewable by anyone with link)
  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  // Players
  const { data: playersRaw } = await supabase
    .from('leaderboard_players')
    .select('id, puuid, game_name, tag_line, role, twitch_url, twitter_url, sort_order')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(15)

  const players = playersRaw ?? []
  const puuids = players.map((p) => p.puuid).filter(Boolean)

  // If no players, render quickly
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
            <p className="mt-1 text-xs text-gray-500">
              Players will appear here once they're added to the leaderboard.
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Latest Games</h2>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm font-medium text-gray-900">No games yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Once matches are ingested by the cron job, they’ll appear here.
            </p>
          </div>
        </section>
      </main>
    )
  }

  // Snapshot queries (DB-only)
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

  // Prefer Solo queue snapshot for display; fallback to Flex; else null
  const rankBy = new Map<string, any>()
  for (const puuid of puuids) {
    const solo = ranks.find((r) => r.puuid === puuid && r.queue_type === 'RANKED_SOLO_5x5')
    const flex = ranks.find((r) => r.puuid === puuid && r.queue_type === 'RANKED_FLEX_SR')
    rankBy.set(puuid, solo ?? flex ?? null)
  }

  // Top champs grouped per player, top 5
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

  // Latest 10 games across the leaderboard (combined feed)
  // Requires match_participants.match_id FK -> matches.match_id
  const { data: latestRaw } = await supabase
    .from('match_participants')
    .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win, matches!inner(game_end_ts, game_duration_s, queue_id)')
    .in('puuid', puuids)
    .order('game_end_ts', { foreignTable: 'matches', ascending: false })
    .limit(10)

  const latestGames = (latestRaw ?? []).map((row: any) => ({
    matchId: row.match_id as string,
    puuid: row.puuid as string,
    championId: row.champion_id as number,
    k: row.kills as number,
    d: row.deaths as number,
    a: row.assists as number,
    cs: row.cs as number,
    win: row.win as boolean,
    endTs: row.matches?.game_end_ts as number | undefined,
    durationS: row.matches?.game_duration_s as number | undefined,
    queueId: row.matches?.queue_id as number | undefined,
  }))

  // Compute “last updated” (best-effort) from states
  const lastUpdatedIso = puuids
    .map((p) => stateBy.get(p)?.last_rank_sync_at ?? null)
    .filter(Boolean)
    .sort()
    .at(-1) as string | null

  // Helper for display names
  function displayRiotId(p: any) {
    const gn = (p.game_name ?? '').trim()
    const tl = (p.tag_line ?? '').trim()
    if (gn && tl) return `${gn}#${tl}`
    return p.puuid
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900">{lb.name}</h1>
        {lb.description && <p className="mt-2 text-gray-600">{lb.description}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span className="rounded-full border border-gray-200 bg-white px-2 py-1">
            {lb.visibility}
          </span>
          <span className="rounded-full border border-gray-200 bg-white px-2 py-1">
            Last updated: {timeAgo(lastUpdatedIso)}
          </span>
        </div>
      </div>

      {/* Players Section */}
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Players</h2>
          <span className="text-sm text-gray-500">
            {players.length} {players.length === 1 ? 'player' : 'players'}
          </span>
        </div>

        <div className="space-y-3">
          {players.map((p, index) => {
            const st = stateBy.get(p.puuid)
            const r = rankBy.get(p.puuid)
            const icon = profileIconUrl(st?.profile_icon_id)
            const wins = r?.wins ?? null
            const losses = r?.losses ?? null
            const total = wins != null && losses != null ? wins + losses : null
            const wr = total ? Math.round((wins / total) * 100) : null

            const tier = r?.tier ? String(r.tier).toUpperCase() : null
            const div = r?.rank ? String(r.rank).toUpperCase() : null
            const lp = typeof r?.league_points === 'number' ? r.league_points : null

            const top5 = champsBy.get(p.puuid) ?? []

            return (
              <div
                key={p.id}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  {/* Rank Number */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-700">
                    #{index + 1}
                  </div>

                  {/* Icon */}
                  <div className="h-11 w-11 overflow-hidden rounded-full border border-gray-200 bg-gray-50">
                    {icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={icon} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-gray-500">
                        NA
                      </div>
                    )}
                  </div>

                  {/* Player Info */}
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{displayRiotId(p)}</div>

                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {p.role && <span className="rounded-full bg-gray-100 px-2 py-0.5">{p.role}</span>}

                      {tier && div ? (
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
                          {tier} {div}{lp != null ? ` · ${lp} LP` : ''}
                        </span>
                      ) : (
                        <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5">
                          Unranked / No snapshot yet
                        </span>
                      )}

                      {st?.last_error ? (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                          Sync error (kept last snapshot)
                        </span>
                      ) : null}

                      <span className="rounded-full bg-gray-50 px-2 py-0.5">
                        Updated: {timeAgo(st?.last_rank_sync_at ?? st?.last_matches_sync_at)}
                      </span>
                    </div>

                    {/* Winrate */}
                    {wins != null && losses != null ? (
                      <div className="mt-3">
                        <div className="flex items-center justify-between text-xs text-gray-600">
                          <span>
                            {wins}W - {losses}L{wr != null ? ` · ${wr}%` : ''}
                          </span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                          <div
                            className="h-full bg-gray-900"
                            style={{ width: `${wr ?? 0}%` }}
                          />
                        </div>
                      </div>
                    ) : null}

                    {/* Top 5 champs (DB snapshot, no live fetch) */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {top5.length ? (
                        top5.map((c) => (
                          <span
                            key={`${p.puuid}-${c.champion_id}`}
                            className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700"
                            title={`Champion ID ${c.champion_id} · ${c.games} games · ${c.wins}W`}
                          >
                            Champ {c.champion_id}
                          </span>
                        ))
                      ) : null}
                    </div>
                  </div>

                  {/* Social Links */}
                  {(p.twitch_url || p.twitter_url) && (
                    <div className="flex gap-2">
                      {p.twitch_url && (
                        <a
                          href={p.twitch_url}
                          target="_blank"
                          rel="noopener noreferrer"
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
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Twitter
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Latest Games Section */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Latest Games</h2>

        {latestGames.length ? (
          <div className="space-y-3">
            {latestGames.map((g) => {
              const p = players.find((x) => x.puuid === g.puuid)
              const name = p ? displayRiotId(p) : g.puuid
              const when = g.endTs ? `${Math.max(1, Math.floor((Date.now() - g.endTs) / 60000))}m ago` : ''
              const dur = g.durationS ? `${Math.floor(g.durationS / 60)}m` : ''

              return (
                <div key={`${g.matchId}-${g.puuid}`} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-gray-900">{name}</div>
                    <div className="text-xs text-gray-500">
                      {queueLabel(g.queueId)} {dur ? `· ${dur}` : ''} {when ? `· ${when}` : ''}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-700">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${g.win ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                      {g.win ? 'W' : 'L'}
                    </span>
                    <span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs">
                      Champ {g.championId}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      {g.k}/{g.d}/{g.a}
                    </span>
                    <span className="text-xs text-gray-500">CS {g.cs}</span>
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
