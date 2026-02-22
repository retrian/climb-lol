import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import LeaderboardGraphClient from './LeaderboardGraphClient'
import LeaderboardTabs from '@/components/LeaderboardTabs'
import { compareRanks } from '@/lib/rankSort'


export const revalidate = 600


// --- Constants ---
const DEFAULT_GRANDMASTER_CUTOFF = 200
const DEFAULT_CHALLENGER_CUTOFF = 500
const DEFAULT_DDRAGON_VERSION = '15.24.1'
const SOLO_QUEUE = 'RANKED_SOLO_5x5'


// --- Types ---
type Player = {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
}


async function safeDb<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  fallback: T,
  label: string
): Promise<T> {
  try {
    const { data, error } = await query
    if (error) {
      console.error('[graph page] database error', { label, error })
      return fallback
    }
    return (data as T) ?? fallback
  } catch (error) {
    console.error('[graph page] database exception', { label, error })
    return fallback
  }
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
  leaderboardCode,
  visibility,
  activeTab,
  cutoffs,
  bannerUrl,
  lastUpdated = null,
}: {
  name: string
  description?: string | null
  leaderboardCode: number
  visibility: string
  activeTab: 'overview' | 'graph' | 'stats'
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  bannerUrl: string | null
  lastUpdated?: string | null
}) {
  const formattedLastUpdated = lastUpdated
    ? new Date(lastUpdated).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  return (
    <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
            <LeaderboardTabs leaderboardCode={leaderboardCode} activeTab={activeTab} visibility={visibility} />
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 mb-4 pb-2 pt-2 dark:from-white dark:via-slate-200 dark:to-slate-400">
            {name}
          </h1>
          {description && (
            <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">
              {description}
            </p>
          )}
          {formattedLastUpdated ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Updated {formattedLastUpdated}
            </p>
          ) : null}
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


export default async function LeaderboardGraphPage({
  params,
  fromCodeRoute = false,
}: {
  params: Promise<{ slug: string }>
  fromCodeRoute?: boolean
}) {
  const { slug } = await params
  const supabase = await createClient()
  const latestPatch = await getLatestDdragonVersion().catch(() => null)
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || DEFAULT_DDRAGON_VERSION


  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, slug, leaderboard_code, visibility, banner_url, description, updated_at')
    .eq('slug', slug)
    .maybeSingle()




  if (!lb) notFound()


  if (lb.visibility === 'PRIVATE') {
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user || data.user.id !== lb.user_id) {
      notFound()
    }
  }


  if (!fromCodeRoute) {
    redirect(`/leaderboards/${lb.leaderboard_code}/graph`)
  }


  // Use service-role client for data reads after access checks to avoid RLS-caused empty datasets.
  // Fall back to request client so transient service-client issues do not hard-crash the page.
  const dataClient = (() => {
    try {
      return createServiceClient()
    } catch (error) {
      console.error('[graph page] failed to create service client; falling back to request client', error)
      return supabase
    }
  })()


  const playersRaw = await safeDb(
    dataClient
      .from('leaderboard_players')
      .select('id, puuid, game_name, tag_line')
      .eq('leaderboard_id', lb.id)
      .order('sort_order', { ascending: true })
      .limit(2000),
    [] as Player[],
    'leaderboard_players'
  )




  const players = (playersRaw ?? []) as Player[]
  const puuids = players.map((p) => p.puuid).filter(Boolean)


  const cutoffsRaw = await safeDb(
    dataClient
      .from('rank_cutoffs')
      .select('queue_type, tier, cutoff_lp')
      .eq('queue_type', SOLO_QUEUE)
      .in('tier', ['GRANDMASTER', 'CHALLENGER']),
    [] as Array<{ queue_type: string; tier: string; cutoff_lp: number }>,
    'rank_cutoffs'
  )




  const cutoffsByTier = new Map((cutoffsRaw ?? []).map((row) => [`${row.queue_type}::${row.tier}`, row.cutoff_lp]))
 
  const cutoffsDisplay = [
    { key: `${SOLO_QUEUE}::CHALLENGER`, label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
    { key: `${SOLO_QUEUE}::GRANDMASTER`, label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
  ]
    .map((item) => ({
      label: item.label,
      lp: cutoffsByTier.get(item.key),
      icon: item.icon,
    }))
    .filter((item): item is { label: string; lp: number; icon: string } => item.lp !== undefined)


  if (puuids.length === 0) {
    return (
      <main className="lb-less-rounded min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
        <div className="mx-auto w-full max-w-[1460px] px-6 py-12 space-y-6">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            leaderboardCode={lb.leaderboard_code}
            visibility={lb.visibility}
            activeTab="graph"
            cutoffs={[]}
            bannerUrl={lb.banner_url}
          />
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            No players found for this leaderboard yet.
          </div>
        </div>
      </main>
    )
  }


  const stateRaw = await safeDb(
    dataClient
      .from('player_riot_state')
      .select('puuid, profile_icon_id')
      .in('puuid', puuids),
    [] as Array<{ puuid: string; profile_icon_id: number | null }>,
    'player_riot_state'
  )




  const stateBy = new Map((stateRaw ?? []).map((row) => [row.puuid, row]))


  const rankSnapshotRaw = await safeDb(
    dataClient
      .from('player_rank_snapshot')
      .select('puuid, queue_type, tier, rank, league_points, wins, losses, fetched_at')
      .in('puuid', puuids)
      .eq('queue_type', 'RANKED_SOLO_5x5'),
    [] as Array<{
      puuid: string
      queue_type: string
      tier: string | null
      rank: string | null
      league_points: number | null
      wins: number | null
      losses: number | null
      fetched_at: string | null
    }>,
    'player_rank_snapshot'
  )




  const rankBy = new Map((rankSnapshotRaw ?? []).map((row) => [row.puuid, row]))


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
    grandmaster: cutoffsByTier.get(`${SOLO_QUEUE}::GRANDMASTER`) ?? DEFAULT_GRANDMASTER_CUTOFF,
    challenger: cutoffsByTier.get(`${SOLO_QUEUE}::CHALLENGER`) ?? DEFAULT_CHALLENGER_CUTOFF,
  }






  return (
    <main className="lb-less-rounded min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="mx-auto w-full max-w-none px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            leaderboardCode={lb.leaderboard_code}
            visibility={lb.visibility}
            activeTab="graph"
            cutoffs={[]}
            bannerUrl={lb.banner_url}
          />
        </div>


        <div className="mx-auto w-full max-w-[1460px]">
          <LeaderboardGraphClient players={playerSummaries} slug={slug} cutoffs={cutoffs} />
        </div>
      </div>
    </main>
  )
}
