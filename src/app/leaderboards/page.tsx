import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams?: { q?: string; layout?: string; sort?: string } | Promise<{ q?: string; layout?: string; sort?: string }>
}) {
  const sp = await Promise.resolve(searchParams ?? {})
  const q = (sp.q ?? '').trim()
  const layout = sp.layout === 'grid' ? 'grid' : 'list'
  const sort = sp.sort === 'least_viewed' ? 'least_viewed' : 'most_viewed'
  const qParam = encodeURIComponent(q)

  const supabase = await createClient()

  let query = supabase
    .from('leaderboards')
    .select('id, name, slug, leaderboard_code, visibility, description, updated_at, banner_url')
    .eq('visibility', 'PUBLIC')
    .order('updated_at', { ascending: false })

  if (q.length) {
    query = query.ilike('name', `%${q}%`)
  }

  const { data: leaderboards } = await query

  const slugs = (leaderboards ?? []).map((lb) => lb.slug)
  const leaderboardIds = (leaderboards ?? []).map((lb) => lb.id)

  const { data: leaderboardViews } = slugs.length
    ? await supabase.from('leaderboard_views').select('slug, views').in('slug', slugs)
    : { data: [] as Array<{ slug: string; views: number | null }> }

  const { data: leaderboardPlayers } = leaderboardIds.length
    ? await supabase.from('leaderboard_players').select('leaderboard_id').in('leaderboard_id', leaderboardIds)
    : { data: [] as Array<{ leaderboard_id: string }> }

  const viewsBySlug = new Map<string, number>(
    (leaderboardViews ?? []).map((row) => [row.slug, row.views ?? 0])
  )

  const playersByLeaderboardId = new Map<string, number>()
  for (const row of leaderboardPlayers ?? []) {
    const current = playersByLeaderboardId.get(row.leaderboard_id) ?? 0
    playersByLeaderboardId.set(row.leaderboard_id, current + 1)
  }

  const enrichedLeaderboards = (leaderboards ?? []).map((lb) => ({
    ...lb,
    views: viewsBySlug.get(lb.slug) ?? 0,
    playerCount: playersByLeaderboardId.get(lb.id) ?? 0,
  }))

  const sortedLeaderboards = [...enrichedLeaderboards].sort((a, b) =>
    sort === 'least_viewed' ? a.views - b.views : b.views - a.views
  )

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-10 lg:py-16">
        
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400">
              Leaderboards
            </h1>
          </div>
          <p className="text-base text-slate-600 font-medium dark:text-slate-300">
            Explore public competitions
          </p>
        </div>

        {/* Search */}
        <form className="mb-8" action="/leaderboards" method="get">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                name="q"
                defaultValue={q}
                placeholder="Search leaderboards..."
                className="w-full rounded-2xl border-2 border-slate-200 bg-white pl-12 pr-4 py-4 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              />
              <input type="hidden" name="layout" value={layout} />
              <input type="hidden" name="sort" value={sort} />
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/leaderboards?q=${qParam}&layout=list&sort=${sort}`}
                className={`inline-flex h-[58px] items-center gap-2 rounded-2xl border-2 px-4 text-sm font-semibold transition ${
                  layout === 'list'
                    ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700'
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h.01M3 12h.01M3 18h.01" />
                </svg>
                List
              </Link>

              <Link
                href={`/leaderboards?q=${qParam}&layout=grid&sort=${sort}`}
                className={`inline-flex h-[58px] items-center gap-2 rounded-2xl border-2 px-4 text-sm font-semibold transition ${
                  layout === 'grid'
                    ? 'border-blue-400 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-500/10 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700'
                }`}
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                Grid
              </Link>

              <Link
                href={`/leaderboards?q=${qParam}&layout=${layout}&sort=${sort === 'most_viewed' ? 'least_viewed' : 'most_viewed'}`}
                className="inline-flex h-[58px] items-center gap-2 rounded-2xl border-2 border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 12h10M10 20h4" />
                </svg>
                {sort === 'most_viewed' ? 'Most viewed' : 'Least viewed'}
              </Link>
            </div>
          </div>
        </form>

        {/* Results */}
        {q.length > 0 && (
          <div className="mb-6 flex items-center justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {sortedLeaderboards.length} result{sortedLeaderboards.length === 1 ? '' : 's'} for{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">&quot;{q}&quot;</span>
            </p>
            <Link
              href={`/leaderboards?layout=${layout}&sort=${sort}`}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
            >
              Clear search
            </Link>
          </div>
        )}

        {/* Leaderboards List */}
        <div className={layout === 'grid' ? 'grid gap-5 sm:grid-cols-2' : 'space-y-3'}>
          {sortedLeaderboards.map((lb) => (
            <Link
              key={lb.leaderboard_code}
              href={`/leaderboards/${lb.leaderboard_code}`}
              className="group block relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl dark:border-slate-800 dark:hover:border-slate-700"
            >
              <div className="relative h-48 w-full">
                {lb.banner_url ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={lb.banner_url}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-br from-white/28 via-white/14 to-white/4 dark:from-slate-950/42 dark:via-slate-950/22 dark:to-slate-900/12" />
                    <div className="absolute inset-0 bg-gradient-to-t from-white/36 via-white/8 to-transparent dark:from-slate-950/42 dark:via-slate-950/14 dark:to-transparent" />
                  </>
                ) : (
                  <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
                )}

                <div className="absolute inset-x-0 bottom-0 p-5">
                  <div className="inline-flex max-w-full items-center rounded-xl bg-slate-950/60 px-3 py-2 backdrop-blur-sm">
                    <h2 className="truncate text-base font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                      {lb.name}
                    </h2>
                  </div>

                  {lb.description ? (
                    <p className="mt-2 line-clamp-1 text-xs font-medium text-slate-700/95 drop-shadow-[0_1px_3px_rgba(255,255,255,0.45)] dark:text-white/75 dark:drop-shadow-none">
                      {lb.description}
                    </p>
                  ) : null}

                  <div className="mt-2 flex items-center gap-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700/90 drop-shadow-[0_1px_3px_rgba(255,255,255,0.45)] dark:text-white/70 dark:drop-shadow-none">
                    <span className="inline-flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7Z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                      {lb.views.toLocaleString()}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      {lb.playerCount.toLocaleString()} players
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {/* Empty State */}
          {sortedLeaderboards.length === 0 && (
            <div className="col-span-full text-center py-16 bg-white rounded-2xl border-2 border-dashed border-slate-200 dark:bg-slate-900 dark:border-slate-700">
              <svg className="w-16 h-16 mx-auto text-slate-300 mb-4 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-base font-bold text-slate-500 mb-1 dark:text-slate-300">
                {q.length > 0 ? 'No leaderboards found' : 'No public leaderboards yet'}
              </p>
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {q.length > 0 ? 'Try adjusting your search terms' : 'Check back later for new leaderboards'}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
