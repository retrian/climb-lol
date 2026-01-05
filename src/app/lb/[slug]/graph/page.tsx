import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LeaderboardGraphClient from './LeaderboardGraphClient'
import TeamHeaderCard from '../TeamHeaderCard'

function displayRiotId(player: { game_name: string | null; tag_line: string | null; puuid: string }) {
  const gn = (player.game_name ?? '').trim()
  const tl = (player.tag_line ?? '').trim()
  if (gn && tl) return `${gn}#${tl}`
  return player.puuid
}

function profileIconUrl(profileIconId?: number | null) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profileIconId}.png`
}

export default async function LeaderboardGraphPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, visibility, banner_url, description')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  if (lb.visibility === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  const { data: playersRaw } = await supabase
    .from('leaderboard_players')
    .select('id, puuid, game_name, tag_line')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(50)

  const players = playersRaw ?? []
  const puuids = players.map((p) => p.puuid).filter(Boolean)

  const { data: cutoffsRaw } = await supabase
    .from('rank_cutoffs')
    .select('queue_type, tier, cutoff_lp')
    .in('tier', ['GRANDMASTER', 'CHALLENGER'])

  const cutoffsByTier = new Map((cutoffsRaw ?? []).map((row) => [row.tier, row.cutoff_lp]))
  const cutoffs = {
    grandmaster: Number(cutoffsByTier.get('GRANDMASTER') ?? 200),
    challenger: Number(cutoffsByTier.get('CHALLENGER') ?? 500),
  }

  const cutoffsDisplay = [
    { key: 'GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
    { key: 'CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
  ]
    .map((item) => ({
      label: item.label,
      lp: Number(cutoffsByTier.get(item.key)),
      icon: item.icon,
    }))
    .filter((item) => !Number.isNaN(item.lp))

  if (puuids.length === 0) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-5xl px-4 py-12 space-y-6">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            visibility={lb.visibility}
            lastUpdated={null}
            cutoffs={cutoffsDisplay}
            bannerUrl={lb.banner_url}
            graphHref={`/lb/${slug}/graph`}
          />
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            No players found for this leaderboard yet.
          </div>
        </div>
      </main>
    )
  }

  const { data: stateRaw } = await supabase
    .from('player_riot_state')
    .select('puuid, profile_icon_id')
    .in('puuid', puuids)

  const stateBy = new Map((stateRaw ?? []).map((row) => [row.puuid, row]))

  const minDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: historyRaw } = await supabase
    .from('player_lp_history')
    .select('puuid, tier, rank, lp, wins, losses, fetched_at')
    .in('puuid', puuids)
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .gte('fetched_at', minDate)
    .order('fetched_at', { ascending: true })

  const playerSummaries = players.map((player) => ({
    puuid: player.puuid,
    name: displayRiotId(player),
    profileIconUrl: profileIconUrl(stateBy.get(player.puuid)?.profile_icon_id ?? null),
  }))

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-6xl px-4 py-10 lg:py-14 space-y-8">
        <TeamHeaderCard
          name={lb.name}
          description={lb.description}
          visibility={lb.visibility}
          lastUpdated={null}
          cutoffs={cutoffsDisplay}
          bannerUrl={lb.banner_url}
          graphHref={`/lb/${slug}/graph`}
        />

        <LeaderboardGraphClient players={playerSummaries} points={historyRaw ?? []} cutoffs={cutoffs} />
      </div>
    </main>
  )
}
