import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export default async function LeaderboardsPage({
  searchParams,
}: {
  searchParams?: { q?: string } | Promise<{ q?: string }>
}) {
  const sp = await Promise.resolve(searchParams ?? {})
  const q = (sp.q ?? '').trim()

  const supabase = await createClient()

  let query = supabase
    .from('leaderboards')
    .select('name, slug, visibility, description, updated_at, banner_url')
    .eq('visibility', 'PUBLIC')
    .order('updated_at', { ascending: false })

  if (q.length) {
    query = query.ilike('name', `%${q}%`)
  }

  const { data: leaderboards } = await query

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50">
      <div className="mx-auto max-w-4xl px-4 py-10 lg:py-16">
        
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600">
              Leaderboards
            </h1>
          </div>
          <p className="text-base text-slate-600 font-medium">
            Explore public competitions
          </p>
        </div>

        {/* Search */}
        <form className="mb-8" action="/leaderboards" method="get">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search leaderboards..."
              className="w-full rounded-2xl border-2 border-slate-200 bg-white pl-12 pr-4 py-4 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm"
            />
          </div>
        </form>

        {/* Results */}
        {q.length > 0 && (
          <div className="mb-6 flex items-center justify-between">
            <p className="text-sm text-slate-600">
              {leaderboards?.length ?? 0} result{leaderboards?.length === 1 ? '' : 's'} for{' '}
              <span className="font-semibold text-slate-900">&quot;{q}&quot;</span>
            </p>
            <Link
              href="/leaderboards"
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Clear search
            </Link>
          </div>
        )}

        {/* Leaderboards List */}
        <div className="space-y-3">
          {(leaderboards ?? []).map((lb) => (
            <Link
              key={lb.slug}
              href={`/lb/${lb.slug}`}
              className="group block rounded-2xl border-2 border-slate-200 bg-white overflow-hidden shadow-sm transition-all duration-200 hover:border-slate-300 hover:shadow-lg hover:-translate-y-0.5"
            >
              {/* Banner Image */}
              {lb.banner_url && (
                <div className="w-full h-32 overflow-hidden bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lb.banner_url}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              )}

              <div className="p-5 lg:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg lg:text-xl font-bold text-slate-900 group-hover:text-slate-700 transition-colors truncate">
                      {lb.name}
                    </h2>
                    {lb.description && (
                      <p className="mt-2 text-sm text-slate-600 line-clamp-2">
                        {lb.description}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      {lb.updated_at && (
                        <span className="text-slate-400">
                          Updated {new Date(lb.updated_at).toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Arrow Icon */}
                  <div className="flex-shrink-0 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-1 transition-all duration-200">
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </div>
            </Link>
          ))}

          {/* Empty State */}
          {(leaderboards ?? []).length === 0 && (
            <div className="text-center py-16 bg-white rounded-2xl border-2 border-dashed border-slate-200">
              <svg className="w-16 h-16 mx-auto text-slate-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-base font-bold text-slate-500 mb-1">
                {q.length > 0 ? 'No leaderboards found' : 'No public leaderboards yet'}
              </p>
              <p className="text-sm text-slate-400">
                {q.length > 0 ? 'Try adjusting your search terms' : 'Check back later for new leaderboards'}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}