import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { cache, Suspense } from 'react'
import { unstable_cache } from 'next/cache'
import { getChampionMap } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { getSeasonStartIso } from '@/lib/riot/season'
import { compareRanks } from '@/lib/rankSort'
import { createServiceClient } from '@/lib/supabase/service'
import PlayerMatchHistoryClient from './PlayerMatchHistoryClient'
import LeaderboardTabs from '@/components/LeaderboardTabs'
import LatestActivityServer from '@/app/lb/[slug]/LatestActivityServer'
import MoversServer from '@/app/lb/[slug]/MoversServer'

export const revalidate = 30
const PAGE_CACHE_TTL_SECONDS = revalidate
const DEFAULT_DDRAGON_VERSION = '15.24.1'

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

// Database Response Types
interface RankCutoffRaw {
  queue_type: string
  tier: string
  cutoff_lp: number
}

interface TopChampionRaw {
  puuid: string
  champion_id: number | null
  games: number | null
}

interface LeaderboardRaw {
  id: string
  user_id: string
  name: string
  leaderboard_code: number
  description: string | null
  visibility: Visibility
  banner_url: string | null
  updated_at: string | null
}

interface LeaderboardPageData {
  champMap: Record<number, { id: string; name: string }>
  playerCards: Array<{
    player: Player
    index: number
    rankData: PlayerRankSnapshot | null
    stateData: PlayerRiotState | null
    topChamps: Array<{ champion_id: number; games: number }>
  }>
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  lastUpdatedIso: string | null
}

interface TeamHeaderCardProps {
  name: string
  description: string | null
  leaderboardCode: number
  visibility: Visibility
  activeTab: 'overview' | 'stats' | 'graph'
  bannerUrl: string | null
  cutoffs?: Array<{ label: string; lp: number; icon: string }>
  lastUpdated?: string | null
}

// --- Helpers ---

async function safeDb<T>(
  query: PromiseLike<{ data: T | null; error: unknown }>,
  fallback: T,
  label?: string
): Promise<T> {
  const describeError = (error: unknown) => {
    const asRecord = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null
    const ownProps: Record<string, unknown> = {}
    try {
      for (const key of Object.getOwnPropertyNames(asRecord ?? {})) {
        ownProps[key] = asRecord?.[key]
      }
    } catch {}

    return {
      label,
      type: typeof error,
      constructorName: (asRecord?.constructor as { name?: string } | undefined)?.name ?? null,
      message: asRecord?.message ?? null,
      details: asRecord?.details ?? null,
      hint: asRecord?.hint ?? null,
      code: asRecord?.code ?? null,
      name: asRecord?.name ?? null,
      toString: (() => {
        try {
          return String(error)
        } catch {
          return null
        }
      })(),
      serialized: (() => {
        try {
          return JSON.stringify(error)
        } catch {
          return null
        }
      })(),
      ownProps,
    }
  }

  try {
    const { data, error } = await query
    if (error) {
      console.error('Database Error:', describeError(error), error)
      return fallback
    }
    return (data as T) ?? fallback
  } catch (error) {
    console.error('Database Exception:', describeError(error), error)
    return fallback
  }
}

const getLeaderboardBySlug = cache(async (slug: string): Promise<LeaderboardRaw | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, leaderboard_code, description, visibility, banner_url, updated_at')
    .eq('slug', slug)
    .maybeSingle()

  return (data as LeaderboardRaw | null) ?? null
})

const getLeaderboardPageDataCached = (lbId: string, ddVersion: string) =>
  unstable_cache(
  async (): Promise<LeaderboardPageData> => {
    const supabase = createServiceClient()

    const [champMap, playersRaw, cutsRaw] = await Promise.all([
      getChampionMap(ddVersion).catch(() => ({})),
      safeDb(
        supabase
          .from('leaderboard_players')
          .select('id, puuid, game_name, tag_line, role, twitch_url, twitter_url, sort_order')
          .eq('leaderboard_id', lbId)
          .order('sort_order', { ascending: true })
          .limit(50),
        [] as Player[],
        'leaderboard_players'
      ),
      safeDb(
        supabase
          .from('rank_cutoffs')
          .select('queue_type, tier, cutoff_lp')
          .in('tier', ['GRANDMASTER', 'CHALLENGER']),
        [] as RankCutoffRaw[],
        'rank_cutoffs'
      )
    ])

    const players: Player[] = playersRaw
    const top50Puuids = players.map((p) => p.puuid).filter(Boolean)
    const allRelevantPuuids = top50Puuids

    const seasonStartIso = getSeasonStartIso({ ddVersion })
    const seasonStartMsLatest = new Date(seasonStartIso).getTime()

    const [statesRaw, ranksRaw, topChampsRaw] = await Promise.all([
      allRelevantPuuids.length > 0
        ? safeDb(supabase.from('player_riot_state').select('*').in('puuid', allRelevantPuuids), [] as PlayerRiotState[], 'player_riot_state')
        : ([] as PlayerRiotState[]),
      allRelevantPuuids.length > 0
        ? safeDb(
            supabase
              .from('player_rank_snapshot')
              .select('*')
              .in('puuid', allRelevantPuuids)
              .in('queue_type', ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'])
              .gte('fetched_at', seasonStartIso),
            [] as PlayerRankSnapshot[],
            'player_rank_snapshot'
          )
        : ([] as PlayerRankSnapshot[]),
      top50Puuids.length > 0 ? safeDb(
        supabase
          .from('player_top_champions')
          .select('puuid, champion_id, games')
          .in('puuid', top50Puuids)
          .order('games', { ascending: false }),
        [] as TopChampionRaw[],
        'player_top_champions'
      ) : [],
    ])

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

    const rankBy = new Map<string, PlayerRankSnapshot | null>()
    const queuesByPuuid = new Map<string, { solo: PlayerRankSnapshot | null; flex: PlayerRankSnapshot | null }>()

    for (const r of ranksRaw) {
      if (r.fetched_at && (!seasonStartMsLatest || new Date(r.fetched_at).getTime() >= seasonStartMsLatest)) {
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
      rankBy.set(pid, entry ? (entry.solo ?? entry.flex ?? null) : null)
    }

    const playersSorted = [...players].sort((a, b) => {
      const rankA = rankBy.get(a.puuid)
      const rankB = rankBy.get(b.puuid)
      return compareRanks(rankA ?? undefined, rankB ?? undefined)
    })

    const champsBy = new Map<string, Array<{ champion_id: number; games: number }>>()
    for (const row of topChampsRaw) {
      if (!row.puuid || !row.champion_id) continue
      const current = champsBy.get(row.puuid) ?? []
      current.push({ champion_id: row.champion_id, games: row.games ?? 0 })
      champsBy.set(row.puuid, current)
    }
    for (const [puuid, champs] of champsBy.entries()) {
      champsBy.set(puuid, champs.sort((a, b) => b.games - a.games).slice(0, 5))
    }

    const cutoffsMap = new Map<string, number>()
    for (const c of cutsRaw) cutoffsMap.set(`${c.queue_type}::${c.tier}`, c.cutoff_lp)
    const cutoffs = [
      { key: 'RANKED_SOLO_5x5::CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
      { key: 'RANKED_SOLO_5x5::GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
    ].map((i) => ({ label: i.label, lp: cutoffsMap.get(i.key) as number, icon: i.icon })).filter((x) => x.lp !== undefined)

    const playerCards = playersSorted.map((player, idx) => ({
      player,
      index: idx + 1,
      rankData: rankBy.get(player.puuid) ?? null,
      stateData: stateBy.get(player.puuid) ?? null,
      topChamps: champsBy.get(player.puuid) ?? [],
    }))

    return {
      champMap,
      playerCards,
      cutoffs,
      lastUpdatedIso,
    }
  },
  ['lb-page-data-v6', lbId, ddVersion],
  { revalidate: PAGE_CACHE_TTL_SECONDS }
)()

// --- Components ---

  function TeamHeaderCard({ name, description, leaderboardCode, visibility, activeTab, bannerUrl, cutoffs = [], lastUpdated = null }: TeamHeaderCardProps) {
    const formattedLastUpdated = lastUpdated
      ? new Date(lastUpdated).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : null

    return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-lg dark:border-slate-800 dark:bg-slate-900">
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
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 mb-4 pb-2 pt-2 dark:from-white dark:via-slate-200 dark:to-slate-400">{name}</h1>
          {description && <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">{description}</p>}
          {formattedLastUpdated ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Updated {formattedLastUpdated}
            </p>
          ) : null}
        </div>
        {cutoffs && cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2"><div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" /><div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Rank Cutoffs</div></div>
            {cutoffs.map((c) => (<div key={c.label} className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"><img src={c.icon} alt={c.label} width={48} height={48} className="w-12 h-12 object-contain drop-shadow-sm" /><div className="flex-1"><div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">{c.label}</div><div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div></div></div>))}
          </div>
        )}
      </div>
    </div>
    )
}

// --- Main Page Component ---

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const lb = await getLeaderboardBySlug(slug)

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
  }
}

async function LeaderboardBody({ lbId, slug, ddVersion }: { lbId: string; slug: string; ddVersion: string }) {
  const supabase = await createClient()

  const viewResult = await supabase.rpc('increment_leaderboard_view', { slug_input: slug })
  if (viewResult.error) {
    console.error('Failed to increment leaderboard view:', viewResult.error)
  }

  const data = await getLeaderboardPageDataCached(lbId, ddVersion)

  const {
    champMap,
    playerCards,
  } = data

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,820px)_280px] gap-8 lg:gap-10 items-start justify-center">
      <Suspense fallback={<LatestActivitySkeleton />}>
        <LatestActivityServer lbId={lbId} ddVersion={ddVersion} />
      </Suspense>

      <div className="order-1 lg:order-2 space-y-8 lg:space-y-10">
        <div className="max-w-[820px] mx-auto">
          <PlayerMatchHistoryClient playerCards={playerCards} champMap={champMap} ddVersion={ddVersion} />
        </div>
      </div>

      <Suspense fallback={<MoversSkeleton />}>
        <MoversServer lbId={lbId} ddVersion={ddVersion} />
      </Suspense>
    </div>
  )
}

function LatestActivitySkeleton() {
  return (
    <aside className="lg:sticky lg:top-6 order-2 lg:order-1">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-1 w-8 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 rounded-full shadow-sm" />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Latest Activity</h3>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 h-64 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
    </aside>
  )
}

function MoversSkeleton() {
  return (
    <aside className="hidden lg:block lg:sticky lg:top-6 order-3">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 h-64 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
    </aside>
  )
}

export default async function LeaderboardDetail({
  params,
  fromCodeRoute = false,
}: {
  params: Promise<{ slug: string }>
  fromCodeRoute?: boolean
}) {
  const { slug } = await params
  const latestPatch = await getLatestDdragonVersion().catch(() => null)
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || DEFAULT_DDRAGON_VERSION
  const supabase = await createClient()
  const lb = await getLeaderboardBySlug(slug)

  if (!lb) notFound()

  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  if (!fromCodeRoute) {
    redirect(`/leaderboards/${lb.leaderboard_code}`)
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <TeamHeaderCard
            name={lb.name}
            description={lb.description}
            leaderboardCode={lb.leaderboard_code}
            visibility={lb.visibility}
            activeTab="overview"
            bannerUrl={lb.banner_url}
          />
        </div>
        <Suspense
          fallback={
            <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,820px)_280px] gap-8 lg:gap-10 items-start justify-center">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 h-64 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
              <div className="rounded-2xl border border-slate-200 bg-white p-4 h-96 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
              <div className="rounded-2xl border border-slate-200 bg-white p-4 h-64 animate-pulse dark:border-slate-800 dark:bg-slate-900" />
            </div>
          }
        >
          <LeaderboardBody lbId={lb.id} slug={slug} ddVersion={ddVersion} />
        </Suspense>
      </div>
    </main>
  )
}
