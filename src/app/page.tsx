import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: topViewRows } = await supabase
    .from('leaderboard_views')
    .select('slug, views')
    .order('views', { ascending: false })
    .limit(3)

  const viewRows = topViewRows ?? []
  const slugs = viewRows.map((row) => row.slug).filter(Boolean)
  const { data: leaderboardsRaw } = slugs.length
    ? await supabase
        .from('leaderboards')
        .select('id, name, slug, leaderboard_code, description, banner_url')
        .eq('visibility', 'PUBLIC')
        .in('slug', slugs)
    : { data: [] as Array<{ id: string; name: string; slug: string; leaderboard_code: number; description: string | null; banner_url: string | null }> }

  const leaderboardsBySlug = new Map((leaderboardsRaw ?? []).map((lb) => [lb.slug, lb]))
  const popularLeaderboards = viewRows
    .map((row) => {
      const lb = leaderboardsBySlug.get(row.slug)
      return lb ? { ...lb, views: row.views ?? 0 } : null
    })
    .filter((lb): lb is { id: string; name: string; slug: string; leaderboard_code: number; description: string | null; banner_url: string | null; views: number } => !!lb)

  return (
    <main className="min-h-[calc(100vh-8.5rem)] bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto flex min-h-[calc(100vh-8.5rem)] max-w-5xl flex-col items-center px-4 py-12 text-center lg:py-20">
        <div className="space-y-4">
          <h1 className="text-5xl lg:text-6xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400">
            CWF.LOL
          </h1>
          <p className="text-lg text-slate-600 font-medium dark:text-slate-300">
            Climb with Friends, compete with others!
          </p>
        </div>

        <form action="/leaderboards" method="get" className="mt-8 w-full max-w-xl">
          <label className="sr-only" htmlFor="lb-search">
            Search leaderboards
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg className="h-5 w-5 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              id="lb-search"
              name="q"
              placeholder="Search leaderboards..."
              className="w-full rounded-2xl border-2 border-slate-200 bg-white py-4 pl-12 pr-4 text-slate-900 placeholder:text-slate-400 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </form>

        <div className="mt-10 w-full">
          <div className="flex items-center justify-center gap-4">
            <div className="h-px w-10 bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-slate-700" />
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">
              most popular leaderboards
            </p>
            <div className="h-px w-10 bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-slate-700" />
          </div>

          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {(popularLeaderboards ?? []).map((lb) => (
              <Link
                key={lb.id}
                href={`/leaderboards/${lb.leaderboard_code}`}
                className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl dark:border-slate-800 dark:hover:border-slate-700"
              >
                <div className="relative h-56 w-full">
                  {lb.banner_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={lb.banner_url}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-slate-950/30 to-transparent" />
                    </>
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-slate-950/60 px-3 py-2 backdrop-blur-sm">
                      <h2 className="truncate text-base font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                        {lb.name}
                      </h2>
                    </div>
                    <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                      {lb.views ?? 0} views
                    </div>
                  </div>
                </div>
              </Link>
            ))}

            {(popularLeaderboards ?? []).length === 0 && (
              <div className="col-span-full rounded-2xl border-2 border-dashed border-slate-200 bg-white px-6 py-10 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                No public leaderboards available yet.
              </div>
            )}
          </div>
        </div>

        <div className="h-90" />
      </div>
    </main>
  )
}
