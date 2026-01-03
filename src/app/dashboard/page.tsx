import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function visibilityBadgeClasses(v: string) {
  switch (v) {
    case 'PUBLIC':
      return 'bg-green-50 text-green-700 border-green-200'
    case 'UNLISTED':
      return 'bg-amber-50 text-amber-700 border-amber-200'
    case 'PRIVATE':
      return 'bg-gray-100 text-gray-700 border-gray-200'
    default:
      return 'bg-gray-100 text-gray-700 border-gray-200'
  }
}

function visibilityDotClasses(v: string) {
  switch (v) {
    case 'PUBLIC':
      return 'bg-green-600'
    case 'UNLISTED':
      return 'bg-amber-600'
    case 'PRIVATE':
      return 'bg-gray-600'
    default:
      return 'bg-gray-500'
  }
}

const VISIBILITY = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const
type Visibility = (typeof VISIBILITY)[number]

function parseRiotId(input: string): { gameName: string; tagLine: string } {
  const trimmed = input.trim()
  const parts = trimmed.split('#')
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new Error('Riot ID must be in the format gameName#tagLine')
  }
  return { gameName: parts[0].trim(), tagLine: parts[1].trim() }
}

async function resolvePuuid(gameName: string, tagLine: string): Promise<string> {
  const key = process.env.RIOT_API_KEY
  if (!key) throw new Error('RIOT_API_KEY is not set')

  const url = `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
    gameName
  )}/${encodeURIComponent(tagLine)}`

  const res = await fetch(url, {
    headers: { 'X-Riot-Token': key },
    cache: 'no-store',
  })

  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`Riot lookup failed (${res.status}). ${txt}`.slice(0, 180))
  }

  const data = (await res.json()) as { puuid?: string }
  if (!data?.puuid) throw new Error('No puuid returned from Riot')
  return data.puuid
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: { edit?: string; player_err?: string; player_ok?: string } | Promise<{ edit?: string; player_err?: string; player_ok?: string }>
}) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  const sp = await Promise.resolve(searchParams ?? {})
  const isEditing = sp.edit === '1'
  const playerErr = sp.player_err ? decodeURIComponent(sp.player_err) : null
  const playerOk = sp.player_ok ? decodeURIComponent(sp.player_ok) : null

  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, name, slug, visibility, description')
    .eq('user_id', user.id)
    .maybeSingle()

  const { data: players } = lb
    ? await supabase
        .from('leaderboard_players')
        .select('id, role, game_name, tag_line, puuid, twitch_url, twitter_url, created_at')
        .eq('leaderboard_id', lb.id)
        .order('created_at', { ascending: true })
    : { data: null }

  async function createLeaderboard(formData: FormData) {
    'use server'

    const name = String(formData.get('name') ?? '').trim()
    if (!name) return

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: existing } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing) redirect('/dashboard')

    const base = slugify(name)
    const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`

    const { error } = await supabase.from('leaderboards').insert({
      user_id: user.id,
      name,
      slug,
      visibility: 'PUBLIC',
    })

    if (error) redirect('/dashboard')
    redirect('/dashboard')
  }

  async function updateLeaderboard(formData: FormData) {
    'use server'

    const name = String(formData.get('name') ?? '').trim()
    const descriptionRaw = String(formData.get('description') ?? '').trim()
    const visibilityRaw = String(formData.get('visibility') ?? '').trim()

    const safeVisibility: Visibility = VISIBILITY.includes(visibilityRaw as Visibility)
      ? (visibilityRaw as Visibility)
      : 'PUBLIC'

    if (!name) return

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!lb) redirect('/dashboard')

    await supabase
      .from('leaderboards')
      .update({
        name,
        description: descriptionRaw.length ? descriptionRaw : null,
        visibility: safeVisibility,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lb.id)
      .eq('user_id', user.id)

    redirect('/dashboard')
  }

  async function addPlayer(formData: FormData) {
    'use server'

    const riotIdRaw = String(formData.get('riot_id') ?? '').trim()
    const role = String(formData.get('role') ?? '').trim() || null
    const twitchUrl = String(formData.get('twitch_url') ?? '').trim() || null
    const twitterUrl = String(formData.get('twitter_url') ?? '').trim() || null

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!lb) redirect('/dashboard')

    if (!riotIdRaw) redirect('/dashboard?player_err=' + encodeURIComponent('Enter a Riot ID like gameName#tagLine'))

    let gameName = ''
    let tagLine = ''
    try {
      const parsed = parseRiotId(riotIdRaw)
      gameName = parsed.gameName
      tagLine = parsed.tagLine
    } catch (e: any) {
      redirect('/dashboard?player_err=' + encodeURIComponent(e?.message ?? 'Invalid Riot ID'))
    }

    const { count } = await supabase
      .from('leaderboard_players')
      .select('*', { count: 'exact', head: true })
      .eq('leaderboard_id', lb.id)

    if ((count ?? 0) >= 15) redirect('/dashboard?player_err=' + encodeURIComponent('Max 15 players per leaderboard'))

    let puuid = ''
    try {
      puuid = await resolvePuuid(gameName, tagLine)
    } catch (e: any) {
      redirect('/dashboard?player_err=' + encodeURIComponent(e?.message ?? 'Riot lookup failed'))
    }

    const { data: dup } = await supabase
      .from('leaderboard_players')
      .select('id')
      .eq('leaderboard_id', lb.id)
      .eq('puuid', puuid)
      .maybeSingle()

    if (dup) redirect('/dashboard?player_err=' + encodeURIComponent('That player is already on your leaderboard'))

    const { error } = await supabase.from('leaderboard_players').insert({
      leaderboard_id: lb.id,
      role,
      game_name: gameName,
      tag_line: tagLine,
      puuid,
      twitch_url: twitchUrl,
      twitter_url: twitterUrl,
    })

    if (error) {
      redirect('/dashboard?player_err=' + encodeURIComponent(error.message))
    }

    redirect('/dashboard?player_ok=' + encodeURIComponent(`Added ${gameName}#${tagLine}`))
  }

  async function removePlayer(formData: FormData) {
    'use server'

    const playerId = String(formData.get('player_id') ?? '').trim()
    if (!playerId) redirect('/dashboard')

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!lb) redirect('/dashboard')

    const { error } = await supabase
      .from('leaderboard_players')
      .delete()
      .eq('id', playerId)
      .eq('leaderboard_id', lb.id)

    if (error) redirect('/dashboard?player_err=' + encodeURIComponent(error.message))

    redirect('/dashboard?player_ok=' + encodeURIComponent('Removed player'))
  }

  const shareUrl = lb ? `http://localhost:3000/lb/${lb.slug}` : null
  const playerCount = players?.length ?? 0

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">Manage your leaderboard and players</p>
      </div>

      {lb ? (
        <div className="space-y-6">
          {/* Quick Actions Bar */}
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/lb/${lb.slug}`}
              className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
            >
              View Leaderboard
            </Link>
            <Link
              href={isEditing ? '/dashboard' : '/dashboard?edit=1'}
              className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              {isEditing ? 'Cancel' : 'Edit Settings'}
            </Link>
          </div>

          {/* Settings Editor (when editing) */}
          {isEditing && (
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <h2 className="mb-6 text-lg font-semibold text-gray-900">Leaderboard Settings</h2>

              <form action={updateLeaderboard} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Name</label>
                  <input
                    name="name"
                    defaultValue={lb.name}
                    required
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Description</label>
                  <textarea
                    name="description"
                    defaultValue={lb.description ?? ''}
                    rows={3}
                    placeholder="Optional description..."
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-700">Visibility</label>
                  <select
                    name="visibility"
                    defaultValue={lb.visibility}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  >
                    <option value="PUBLIC">Public - Listed in directory</option>
                    <option value="UNLISTED">Unlisted - Link only</option>
                    <option value="PRIVATE">Private - Owner only</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
                  >
                    Save Changes
                  </button>
                  <Link
                    href="/dashboard"
                    className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    Cancel
                  </Link>
                </div>
              </form>
            </div>
          )}

          {/* Info Card (when not editing) */}
          {!isEditing && (
            <div className="rounded-lg border border-gray-200 bg-white p-6">
              <div className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-gray-500">Leaderboard Name</div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">{lb.name}</div>
                </div>

                {lb.description && (
                  <div>
                    <div className="text-sm font-medium text-gray-500">Description</div>
                    <div className="mt-1 text-gray-700">{lb.description}</div>
                  </div>
                )}

                <div className="flex items-center gap-6 border-t border-gray-100 pt-4">
                  <div>
                    <div className="text-sm font-medium text-gray-500">Visibility</div>
                    <span className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${visibilityBadgeClasses(lb.visibility)}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${visibilityDotClasses(lb.visibility)}`} />
                      {lb.visibility}
                    </span>
                  </div>

                  <div>
                    <div className="text-sm font-medium text-gray-500">URL</div>
                    <code className="mt-1.5 inline-block rounded bg-gray-100 px-2.5 py-1 text-xs font-mono text-gray-700">
                      /lb/{lb.slug}
                    </code>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-sm font-medium text-gray-500">Share Link</div>
                  <input
                    readOnly
                    value={shareUrl ?? ''}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Players Section */}
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Players</h2>
                <p className="mt-1 text-sm text-gray-600">Add players using Riot ID format: gameName#tagLine</p>
              </div>
              <div className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700">
                {playerCount}/15
              </div>
            </div>

            {/* Feedback Messages */}
            {(playerErr || playerOk) && (
              <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${playerErr ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
                {playerErr ?? playerOk}
              </div>
            )}

            {/* Add Player Form */}
            <form action={addPlayer} className="mb-6 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input
                  name="riot_id"
                  placeholder="Riot ID (e.g., Doublelift#NA1)"
                  className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                />
                <input
                  name="role"
                  placeholder="Role (optional)"
                  className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>

              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-900">
                  Add social links (optional)
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <input
                    name="twitch_url"
                    placeholder="Twitch URL"
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                  <input
                    name="twitter_url"
                    placeholder="Twitter/X URL"
                    className="rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                </div>
              </details>

              <button
                type="submit"
                disabled={playerCount >= 15}
                className="w-full rounded-lg bg-gray-900 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add Player
              </button>
            </form>

            {/* Player List */}
            <div className="space-y-2 border-t border-gray-100 pt-6">
              {playerCount === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No players yet. Add your first player above.</p>
              ) : (
                players!.map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">
                          {p.game_name}#{p.tag_line}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          {p.role && <span className="rounded-full bg-gray-100 px-2 py-0.5">{p.role}</span>}
                          {p.twitch_url && <span>• Twitch</span>}
                          {p.twitter_url && <span>• Twitter</span>}
                        </div>
                      </div>
                    </div>

                    <form action={removePlayer}>
                      <input type="hidden" name="player_id" value={p.id} />
                      <button
                        type="submit"
                        className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Create Leaderboard */
        <div className="rounded-lg border border-gray-200 bg-white p-8">
          <h2 className="text-xl font-bold text-gray-900">Create Your Leaderboard</h2>
          <p className="mt-2 text-gray-600">Get started by creating your first leaderboard (one per account)</p>

          <form action={createLeaderboard} className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">Leaderboard Name</label>
              <input
                name="name"
                required
                placeholder="e.g., NA Climb Squad"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-gray-900 placeholder-gray-400 focus:border-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-gray-900 px-6 py-3 font-medium text-white transition hover:bg-gray-800"
            >
              Create Leaderboard
            </button>
          </form>
        </div>
      )}
    </main>
  )
}