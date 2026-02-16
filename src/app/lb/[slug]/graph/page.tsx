import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getSeasonStartIso } from '@/lib/riot/season'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import LeaderboardGraphClient from './LeaderboardGraphClient'
import LeaderboardTabs from '@/components/LeaderboardTabs'
import { compareRanks } from '@/lib/rankSort'

export const revalidate = 600

// --- Constants ---
const DEFAULT_GRANDMASTER_CUTOFF = 200
const DEFAULT_CHALLENGER_CUTOFF = 500

// --- Types ---
type Player = {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
}

type LpHistoryRow = {
  puuid: string
  tier: string | null
  rank: string | null
  lp: number | null
  wins: number | null
  losses: number | null
  fetched_at: string
}


// --- Helpers ---
function displayRiotId(player: { game_name: string | null; tag_line: string | null; puuid: string }) {
  const gn = (player.game_name ?? '').trim()
  if (gn) return gn
  return player.puuid
}

function profileIconUrl(profileIconId: number | null | undefined, ddVersion: string) {
  if (!profileIconId && profileIconId !== 0) return null
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${profileIconId}.png`
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
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
                className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700"
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

export default async function LeaderboardGraphPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const latestPatch = await getLatestDdragonVersion()
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'

  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, visibility, banner_url, description')
    .eq('slug', slug)
    .maybeSingle()


  if (!lb) notFound()

  if (lb.visibility === 'PRIVATE') {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user || data.user.id !== lb.user_id) {
      notFound()
    }
  }

  // Use service-role client for data reads after access checks to avoid RLS-caused empty datasets.
  const dataClient = createServiceClient()

  const { data: playersRaw } = await dataClient
    .from('leaderboard_players')
    .select('id, puuid, game_name, tag_line')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(2000)


  const players = (playersRaw ?? []) as Player[]
  const puuids = players.map((p) => p.puuid)

  const { data: cutoffsRaw } = await dataClient
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
    .filter((item): item is { label: string; lp: number; icon: string } => item.lp !== undefined)

  if (puuids.length === 0) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
        <div className="mx-auto w-full max-w-[1460px] px-6 py-12 space-y-6">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            slug={slug}
            visibility={lb.visibility}
            activeTab="graph"
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

  const { data: stateRaw } = await dataClient
    .from('player_riot_state')
    .select('puuid, profile_icon_id')
    .in('puuid', puuids)


  const stateBy = new Map((stateRaw ?? []).map((row) => [row.puuid, row]))

  const { data: rankSnapshotRaw } = await dataClient
    .from('player_rank_snapshot')
    .select('puuid, queue_type, tier, rank, league_points, wins, losses, fetched_at')
    .in('puuid', puuids)
    .eq('queue_type', 'RANKED_SOLO_5x5')


  const rankBy = new Map((rankSnapshotRaw ?? []).map((row) => [row.puuid, row]))

  const seasonStartIso = getSeasonStartIso()
  const { data: historyRaw } = await dataClient
    .from('player_lp_history')
    .select('puuid, tier, rank, lp, wins, losses, fetched_at')
    .in('puuid', puuids)
    .eq('queue_type', 'RANKED_SOLO_5x5')
    .gte('fetched_at', seasonStartIso)
    .order('fetched_at', { ascending: true })

  const hasSeasonHistory = (historyRaw?.length ?? 0) > 0
  const { data: fallbackHistoryRaw } = hasSeasonHistory
    ? { data: null as LpHistoryRow[] | null }
    : await dataClient
        .from('player_lp_history')
        .select('puuid, tier, rank, lp, wins, losses, fetched_at')
        .in('puuid', puuids)
        .eq('queue_type', 'RANKED_SOLO_5x5')
        .order('fetched_at', { ascending: true })

  const pointsForGraph = ((hasSeasonHistory ? historyRaw : fallbackHistoryRaw) as LpHistoryRow[] | null) ?? []



  const playersSorted = [...players].sort((a, b) =>
    compareRanks(rankBy.get(a.puuid) ?? undefined, rankBy.get(b.puuid) ?? undefined)
  )

  const playerSummaries = playersSorted.map((player, index) => {
    const rankData = rankBy.get(player.puuid)
    return {
      puuid: player.puuid,
      name: displayRiotId(player),
      tagLine: player.tag_line ?? null,
      profileIconUrl: profileIconUrl(stateBy.get(player.puuid)?.profile_icon_id ?? null, ddVersion),
      rankTier: rankData?.tier ?? null,
      rankDivision: rankData?.rank ?? null,
      lp: rankData?.league_points ?? null,
      order: index + 1,
    }
  })

  const cutoffs = {
    grandmaster: cutoffsByTier.get('GRANDMASTER') ?? DEFAULT_GRANDMASTER_CUTOFF,
    challenger: cutoffsByTier.get('CHALLENGER') ?? DEFAULT_CHALLENGER_CUTOFF,
  }



  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="mx-auto w-full max-w-none px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            slug={slug}
            visibility={lb.visibility}
            activeTab="graph"
            cutoffs={cutoffsDisplay}
            bannerUrl={lb.banner_url}
          />
        </div>

        <div className="mx-auto w-full max-w-[1460px]">
          <LeaderboardGraphClient players={playerSummaries} points={pointsForGraph} cutoffs={cutoffs} />
        </div>
      </div>
    </main>
  )
}
