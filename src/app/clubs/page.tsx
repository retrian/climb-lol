import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function slugify(input: string) {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'club'
}

function clubsRedirect(opts: { q?: string; ok?: string; err?: string }) {
  const params = new URLSearchParams()
  if (opts.q) params.set('q', opts.q)
  if (opts.ok) params.set('club_ok', opts.ok)
  if (opts.err) params.set('club_err', opts.err)
  const qs = params.toString()
  return `/clubs${qs ? `?${qs}` : ''}`
}

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
  owner_user_id: string | null
}

type ClubMemberRow = {
  club_id: string
}

export default async function ClubsPage({
  searchParams,
}: {
  searchParams?:
    | { q?: string; club_ok?: string; club_err?: string }
    | Promise<{ q?: string; club_ok?: string; club_err?: string }>
}) {
  const sp = await Promise.resolve(searchParams ?? {})
  const q = (sp.q ?? '').trim()
  const clubOk = sp.club_ok ?? null
  const clubErr = sp.club_err ?? null

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user

  let clubQuery = supabase
    .from('clubs')
    .select('id, name, slug, description, visibility, updated_at, created_at, owner_user_id')
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

  async function createClub(formData: FormData) {
    'use server'

    const name = String(formData.get('name') ?? '').trim()
    const description = String(formData.get('description') ?? '').trim().slice(0, 250) || null
    const searchQ = String(formData.get('search_q') ?? '').trim()

    if (!name) {
      redirect(clubsRedirect({ q: searchQ, err: 'Club name is required' }))
    }

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const base = slugify(name)
    const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`

    const { data: inserted, error } = await supabase
      .from('clubs')
      .insert({
        name,
        slug,
        description,
        visibility: 'PUBLIC',
        owner_user_id: user.id,
      })
      .select('id, slug')
      .maybeSingle()

    if (error || !inserted?.id || !inserted.slug) {
      redirect(clubsRedirect({ q: searchQ, err: error?.message ?? 'Failed to create club' }))
    }

    const { error: memberError } = await supabase.from('club_members').insert({
      club_id: inserted.id,
      user_id: user.id,
      role: 'OWNER',
    })

    if (memberError) {
      redirect(clubsRedirect({ q: searchQ, err: memberError.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${inserted.slug}`)
    const params = new URLSearchParams({ club_ok: 'Club created' })
    redirect(`/clubs/${inserted.slug}?${params.toString()}`)
  }

  const hasClubError = !!clubsError || !!membersError

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 lg:py-16">
        <div className="mb-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400 lg:text-5xl">
              Clubs
            </h1>
            <p className="mt-3 text-base font-medium text-slate-600 dark:text-slate-300">
              Gather friends, share leaderboards, and climb together.
            </p>
          </div>

          {user ? (
            <form action={createClub} className="w-full rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:max-w-md">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Create a club
                </h2>
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
                  New
                </span>
              </div>
              <div className="mt-4 space-y-3">
                <input
                  name="name"
                  placeholder="Club name"
                  className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  required
                />
                <textarea
                  name="description"
                  placeholder="Short description (optional)"
                  rows={3}
                  maxLength={250}
                  className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <input type="hidden" name="search_q" value={q} />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-500"
                >
                  Create club
                </button>
              </div>
            </form>
          ) : (
            <div className="w-full rounded-2xl border-2 border-dashed border-slate-200 bg-white/80 p-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300 lg:max-w-md">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Want to start a club?</p>
              <p className="mt-1">Sign in to create clubs and attach your leaderboards.</p>
              <Link
                href="/sign-in"
                className="mt-3 inline-flex items-center text-sm font-semibold text-blue-600 transition hover:text-blue-500 dark:text-blue-400"
              >
                Sign in
                <span aria-hidden className="ml-1">→</span>
              </Link>
            </div>
          )}
        </div>

        {(clubOk || clubErr || hasClubError) && (
          <div className="mb-6 space-y-3">
            {clubOk && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {clubOk}
              </div>
            )}
            {clubErr && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {clubErr}
              </div>
            )}
            {hasClubError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Clubs are not available yet in this environment. {clubsError?.message ?? membersError?.message}
              </div>
            )}
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
                className="group block rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-lg font-bold text-slate-900 transition-colors group-hover:text-slate-700 dark:text-slate-100 dark:group-hover:text-white">
                        {club.name}
                      </h2>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                        {club.visibility ?? 'PUBLIC'}
                      </span>
                    </div>
                    {club.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{club.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <svg className="h-4 w-4 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5V4H2v16h5m10 0v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6m10 0H7" />
                        </svg>
                        {count} member{count === 1 ? '' : 's'}
                      </span>
                      {updatedLabel && <span>Updated {updatedLabel}</span>}
                    </div>
                  </div>

                  <div className="flex-shrink-0 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
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
                {q.length > 0 ? 'Try adjusting your search terms' : 'Be the first to start one.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
