import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

function formatDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type ClubRow = {
  id: string
  name: string
  slug: string
  description: string | null
  visibility: string | null
  updated_at: string | null
  created_at: string | null
  banner_url: string | null
}

type ClubMemberRow = {
  club_id: string
}

export default async function ClubsPage({
  searchParams,
}: {
  searchParams?: { q?: string } | Promise<{ q?: string }>
}) {
  const sp = await Promise.resolve(searchParams ?? {})
  const q = (sp.q ?? '').trim()

  const supabase = await createClient()

  let clubQuery = supabase
    .from('clubs')
    .select('id, name, slug, description, visibility, updated_at, created_at, banner_url')
    .eq('visibility', 'PUBLIC')
    .order('updated_at', { ascending: false })

  if (q.length) {
    clubQuery = clubQuery.ilike('name', `%${q}%`)
  }

  const { data: clubsRaw, error: clubsError } = await clubQuery
  const clubs = (clubsRaw ?? []) as ClubRow[]

  const clubIds = clubs.map((club) => club.id)
  const { data: memberRows, error: membersError } = clubIds.length
    ? await supabase.from('club_members').select('club_id').in('club_id', clubIds)
    : ({ data: [], error: null } as { data: ClubMemberRow[]; error: null })

  const memberCounts = new Map<string, number>()
  for (const row of memberRows ?? []) {
    memberCounts.set(row.club_id, (memberCounts.get(row.club_id) ?? 0) + 1)
  }

  const hasClubError = !!clubsError || !!membersError

  return (
    <main className="lb-less-rounded min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-10 lg:py-16">
        <div className="mb-10">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400 lg:text-5xl">
              Clubs
            </h1>
            <p className="mt-3 text-base font-medium text-slate-600 dark:text-slate-300">
              Discover squads, rosters, and the leaderboards they rally around.
            </p>
          </div>
        </div>

        {hasClubError && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Clubs are not available yet in this environment. {clubsError?.message ?? membersError?.message}
          </div>
        )}

        <form className="mb-8" action="/clubs" method="get">
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <svg className="h-5 w-5 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              name="q"
              defaultValue={q}
              placeholder="Search clubs..."
              className="w-full rounded-2xl border-2 border-slate-200 bg-white py-4 pl-12 pr-4 text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
          </div>
        </form>

        {q.length > 0 && (
          <div className="mb-6 flex items-center justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {clubs.length} result{clubs.length === 1 ? '' : 's'} for{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">&quot;{q}&quot;</span>
            </p>
            <Link
              href="/clubs"
              className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Clear search
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {clubs.map((club) => {
            const updatedLabel = formatDate(club.updated_at ?? club.created_at)
            const count = memberCounts.get(club.id) ?? 0

            return (
              <Link
                key={club.id}
                href={`/clubs/${club.slug}`}
                className="group block relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-900 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-xl dark:border-slate-800 dark:hover:border-slate-700"
              >
                <div className="relative h-52 w-full">
                  {club.banner_url ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={club.banner_url} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-br from-white/28 via-white/14 to-white/4 dark:from-slate-950/42 dark:via-slate-950/22 dark:to-slate-900/12" />
                      <div className="absolute inset-0 bg-gradient-to-t from-white/36 via-white/8 to-transparent dark:from-slate-950/42 dark:via-slate-950/14 dark:to-transparent" />
                    </>
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900" />
                  )}

                  <div className="absolute inset-x-0 bottom-0 p-5">
                    <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-slate-950/60 px-3 py-2 backdrop-blur-sm">
                      <h2 className="truncate text-base font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.65)]">
                        {club.name}
                      </h2>
                      <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/85">
                        {club.visibility ?? 'PUBLIC'}
                      </span>
                    </div>

                    {club.description ? (
                      <p className="mt-2 line-clamp-1 text-xs font-medium text-slate-700/95 drop-shadow-[0_1px_3px_rgba(255,255,255,0.45)] dark:text-white/75 dark:drop-shadow-none">
                        {club.description}
                      </p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-4 text-[11px] font-semibold uppercase tracking-wide text-slate-700/90 drop-shadow-[0_1px_3px_rgba(255,255,255,0.45)] dark:text-white/70 dark:drop-shadow-none">
                      <span className="inline-flex items-center gap-1.5">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M22 21v-2a4 4 0 0 0-3-3.87" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        {count} member{count === 1 ? '' : 's'}
                      </span>
                      {updatedLabel ? <span>Updated {updatedLabel}</span> : null}
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}

          {clubs.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
              <svg className="mx-auto mb-4 h-16 w-16 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="mb-1 text-base font-bold text-slate-500 dark:text-slate-300">
                {q.length > 0 ? 'No clubs found' : 'No public clubs yet'}
              </p>
              <p className="text-sm text-slate-400 dark:text-slate-500">
                {q.length > 0 ? 'Try adjusting your search terms' : 'Create one from the dashboard to get started.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
