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
    .select('name, slug, visibility, description, updated_at')
    .eq('visibility', 'PUBLIC')
    .order('updated_at', { ascending: false })

  if (q.length) {
    // name search only
    query = query.ilike('name', `%${q}%`)
  }

  const { data: leaderboards } = await query

  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold text-gray-900">Leaderboards</h1>

      <form className="mt-6" action="/leaderboards" method="get">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by leaderboard name…"
          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        />
      </form>

      <div className="mt-8 space-y-3">
        {(leaderboards ?? []).map((lb) => (
          <Link
            key={lb.slug}
            href={`/lb/${lb.slug}`}
            className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:bg-gray-50"
          >
            <div className="text-lg font-semibold text-gray-900">{lb.name}</div>
            {lb.description && <div className="mt-1 text-sm text-gray-600">{lb.description}</div>}
          </Link>
        ))}

        {(leaderboards ?? []).length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
            No public leaderboards found.
          </div>
        )}
      </div>
    </main>
  )
}
