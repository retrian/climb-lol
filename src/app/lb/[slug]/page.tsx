import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

export default async function LeaderboardDetail({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, name, description, visibility')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  const { data: players } = await supabase
    .from('leaderboard_players')
    .select('id, puuid, role, twitch_url, twitter_url')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold text-gray-900">{lb.name}</h1>
        {lb.description && <p className="mt-2 text-gray-600">{lb.description}</p>}
      </div>

      {/* Players Section */}
      <section className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">Players</h2>
          {players && players.length > 0 && (
            <span className="text-sm text-gray-500">
              {players.length} {players.length === 1 ? 'player' : 'players'}
            </span>
          )}
        </div>

        {(players?.length ?? 0) > 0 ? (
          <div className="space-y-3">
            {players!.map((p, index) => (
              <div
                key={p.id}
                className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-center gap-4">
                  {/* Rank Number */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-700">
                    #{index + 1}
                  </div>

                  {/* Player Info */}
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{p.puuid}</div>
                    {p.role && <div className="mt-1 text-xs text-gray-500">{p.role}</div>}
                  </div>

                  {/* Social Links */}
                  {(p.twitch_url || p.twitter_url) && (
                    <div className="flex gap-2">
                      {p.twitch_url && (
                        <a
                          href={p.twitch_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Twitch
                        </a>
                      )}
                      {p.twitter_url && (
                        <a
                          href={p.twitter_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
                        >
                          Twitter
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
              <svg
                className="h-6 w-6 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">No players yet</p>
            <p className="mt-1 text-xs text-gray-500">
              Players will appear here once they're added to the leaderboard
            </p>
          </div>
        )}
      </section>

      {/* Latest Games Section */}
      <section>
        <h2 className="mb-4 text-xl font-semibold text-gray-900">Latest Games</h2>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
            <svg
              className="h-6 w-6 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-900">Coming Soon</p>
          <p className="mt-1 text-xs text-gray-500">
            Game history and statistics will be available here
          </p>
        </div>
      </section>
    </main>
  )
}
