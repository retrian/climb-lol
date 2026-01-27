import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePuuid } from '@/lib/riot/resolvePuuid'
import { buildClubSlug, CLUB_SLUG_PART_MAX, normalizeSlugPart, parseClubSlug, validateSlugPart } from '@/lib/clubSlug'

const CLUB_BANNER_BUCKET = 'club-banners'
const TABS = ['home', 'members', 'leaderboards'] as const
type ClubTab = (typeof TABS)[number]

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'
const VISIBILITY: Visibility[] = ['PUBLIC', 'UNLISTED', 'PRIVATE']

function resolveTab(value?: string | null): ClubTab {
  if (!value) return 'home'
  return (TABS as readonly string[]).includes(value) ? (value as ClubTab) : 'home'
}

function clubUrl(slug: string, opts: { tab?: ClubTab; ok?: string; err?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.tab && opts.tab !== 'home') params.set('tab', opts.tab)
  if (opts.ok) params.set('club_ok', opts.ok)
  if (opts.err) params.set('club_err', opts.err)
  const qs = params.toString()
  return `/clubs/${slug}${qs ? `?${qs}` : ''}`
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

function parseRiotId(input: string): { gameName: string; tagLine: string } {
  const trimmed = input.trim()
  const parts = trimmed.split('#')
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new Error('Riot ID must be in the format gameName#tagLine')
  }
  return { gameName: parts[0].trim(), tagLine: parts[1].trim() }
}

function extFromType(type: string) {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/jpeg') return 'jpg'
  return null
}

function cacheBuster() {
  return Date.now().toString()
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

type ClubRow = {
  id: string
  name: string
  slug: string
  description: string | null
  visibility: string | null
  created_at: string | null
  updated_at: string | null
  owner_user_id: string | null
  banner_url: string | null
}

type MemberRow = {
  id: string
  user_id: string | null
  role: string | null
  joined_at: string | null
  player_puuid: string | null
  game_name: string | null
  tag_line: string | null
  profile_icon_id?: number | null
}

type ClubLeaderboardRow = {
  id: string
  leaderboard_id: string
  created_at: string | null
  added_by_user_id: string | null
}

type LeaderboardRow = {
  id: string
  name: string
  slug: string
  description: string | null
  updated_at: string | null
  banner_url: string | null
  visibility: string | null
}

type AttachedLeaderboard = {
  linkId: string
  addedAt: string | null
  leaderboard: LeaderboardRow | null
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function getOwnedClub(client: SupabaseClient, slug: string, userId: string) {
  return client
    .from('clubs')
    .select('id, slug')
    .eq('slug', slug)
    .eq('owner_user_id', userId)
    .maybeSingle()
}

function MemberBadge({ role }: { role?: string | null }) {
  if (!role) return null
  const normalized = role.toUpperCase()
  const isOwner = normalized === 'OWNER'
  const isAdmin = normalized === 'ADMIN'
  const styles = isOwner
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    : isAdmin
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${styles}`}>
      {role}
    </span>
  )
}

export default async function ClubDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ tab?: string; club_ok?: string; club_err?: string }> | { tab?: string; club_ok?: string; club_err?: string }
}) {
  const { slug } = await params
  const sp = await Promise.resolve(searchParams ?? {})
  const activeTab = resolveTab(sp.tab ?? null)
  const clubOk = sp.club_ok ?? null
  const clubErr = sp.club_err ?? null

  const supabase = await createClient()
  const [{ data: auth }, { data: clubRaw, error: clubError }, { data: profilesRaw }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('clubs')
      .select('id, name, slug, description, visibility, created_at, updated_at, owner_user_id, banner_url')
      .eq('slug', slug)
      .maybeSingle(),
    supabase.from('profiles').select('user_id, username'),
  ])

  const user = auth.user
  const ownerId = user?.id ?? null

  if (clubError) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
        <div className="mx-auto max-w-3xl px-4 py-16">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="text-base font-semibold">Clubs are not configured yet.</p>
            <p className="mt-2">{clubError.message}</p>
            <Link href="/clubs" className="mt-4 inline-flex font-semibold text-amber-900 underline dark:text-amber-200">
              Back to clubs
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const club = clubRaw as ClubRow | null
  if (!club) notFound()

  const canManage = !!ownerId && club.owner_user_id === ownerId
  const slugParts = parseClubSlug(club.slug)

  const [membersRes, linksRes, userLeaderboardsRes] = await Promise.all([
    supabase
      .from('club_members')
      .select('id, user_id, role, joined_at, player_puuid, game_name, tag_line')
      .eq('club_id', club.id)
      .order('joined_at', { ascending: true }),
    supabase
      .from('club_leaderboards')
      .select('id, leaderboard_id, created_at, added_by_user_id')
      .eq('club_id', club.id)
      .order('created_at', { ascending: false }),
    canManage
      ? supabase
          .from('leaderboards')
          .select('id, name, slug, description, updated_at, banner_url, visibility')
          .eq('user_id', ownerId!)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [] as LeaderboardRow[], error: null }),
  ])

  const members = (membersRes.data ?? []) as MemberRow[]
  const memberError = membersRes.error

  const memberPuuids = members.map((member) => member.player_puuid).filter((v): v is string => !!v)
  const { data: riotStateRaw } = memberPuuids.length
    ? await supabase.from('player_riot_state').select('puuid, profile_icon_id').in('puuid', memberPuuids)
    : { data: [] as Array<{ puuid: string; profile_icon_id: number | null }> }

  const riotStateByPuuid = new Map(
    (riotStateRaw ?? []).map((row) => [row.puuid, row.profile_icon_id])
  )

  const profilesByUserId = new Map(
    (profilesRaw ?? []).map((row: { user_id: string; username: string }) => [row.user_id, row.username])
  )

  const links = (linksRes.data ?? []) as ClubLeaderboardRow[]
  const linksError = linksRes.error

  const leaderboardIds = links.map((link) => link.leaderboard_id)
  const leaderboardsRes = leaderboardIds.length
    ? await supabase
        .from('leaderboards')
        .select('id, name, slug, description, updated_at, banner_url, visibility')
        .in('id', leaderboardIds)
    : { data: [] as LeaderboardRow[], error: null }

  const leaderboardsById = new Map((leaderboardsRes.data ?? []).map((lb) => [lb.id, lb as LeaderboardRow]))
  const attachedLeaderboards: AttachedLeaderboard[] = links.map((link) => ({
    linkId: link.id,
    addedAt: link.created_at,
    leaderboard: leaderboardsById.get(link.leaderboard_id) ?? null,
  }))

  const userLeaderboards = (userLeaderboardsRes.data ?? []) as LeaderboardRow[]
  const userLeaderboardsError = userLeaderboardsRes.error
  const attachedIds = new Set(attachedLeaderboards.map((item) => item.leaderboard?.id).filter((v): v is string => !!v))
  const attachableLeaderboards = userLeaderboards.filter((lb) => !attachedIds.has(lb.id))

  const memberCount = members.length
  const leaderboardCount = attachedLeaderboards.filter((item) => item.leaderboard).length
  const updatedLabel = formatDate(club.updated_at ?? club.created_at)


async function addMember(formData: FormData) {
  'use server'

    const riotIdRaw = String(formData.get('riot_id') ?? '').trim()
    if (!riotIdRaw) redirect(clubUrl(slug, { tab: 'members', err: 'Enter a Riot ID like gameName#tagLine' }))

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

  const { data: ownedClub } = await getOwnedClub(supabase, slug, user.id)
  if (!ownedClub?.id) redirect(clubUrl(slug, { tab: 'members', err: 'Only the club owner can manage members' }))

  const { count: membershipCount } = await supabase
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if ((membershipCount ?? 0) >= 3) {
    redirect(clubUrl(slug, { tab: 'members', err: 'Member club limit reached (3 max).' }))
  }

    let gameName = ''
    let tagLine = ''
    try {
      const parsed = parseRiotId(riotIdRaw)
      gameName = parsed.gameName
      tagLine = parsed.tagLine
    } catch (err) {
      redirect(clubUrl(slug, { tab: 'members', err: errorMessage(err, 'Invalid Riot ID') }))
    }

    let puuid = ''
    try {
      puuid = await resolvePuuid(gameName, tagLine)
    } catch (err) {
      redirect(clubUrl(slug, { tab: 'members', err: errorMessage(err, 'Riot lookup failed') }))
    }

    const { data: existing } = await supabase
      .from('club_members')
      .select('id')
      .eq('club_id', ownedClub.id)
      .eq('player_puuid', puuid)
      .maybeSingle()

    if (existing?.id) {
      redirect(clubUrl(slug, { tab: 'members', err: 'That Riot ID is already a member' }))
    }

  const { error } = await supabase.from('club_members').insert({
    club_id: ownedClub.id,
    role: 'MEMBER',
    player_puuid: puuid,
    game_name: gameName,
      tag_line: tagLine,
      user_id: null,
    })

    if (error) {
      redirect(clubUrl(slug, { tab: 'members', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'members', ok: `Added ${gameName}#${tagLine}` }))
  }

  async function removeMember(formData: FormData) {
    'use server'

    const memberId = String(formData.get('member_id') ?? '').trim()
    if (!memberId) redirect(clubUrl(slug, { tab: 'members', err: 'Missing member to remove' }))

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: ownedClub } = await getOwnedClub(supabase, slug, user.id)
    if (!ownedClub?.id) redirect(clubUrl(slug, { tab: 'members', err: 'Only the club owner can manage members' }))

    const { data: member } = await supabase
      .from('club_members')
      .select('id, role')
      .eq('id', memberId)
      .eq('club_id', ownedClub.id)
      .maybeSingle()

    if (!member?.id) redirect(clubUrl(slug, { tab: 'members', err: 'Member not found' }))
    if (member.role?.toUpperCase() === 'OWNER') {
      redirect(clubUrl(slug, { tab: 'members', err: 'Owner memberships cannot be removed' }))
    }

    const { error } = await supabase.from('club_members').delete().eq('id', memberId).eq('club_id', ownedClub.id)

    if (error) {
      redirect(clubUrl(slug, { tab: 'members', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'members', ok: 'Member removed' }))
  }

  async function attachLeaderboard(formData: FormData) {
    'use server'

    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
    if (!leaderboardId) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Select a leaderboard' }))
    }

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: ownedClub } = await getOwnedClub(supabase, slug, user.id)
    if (!ownedClub?.id) redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Only the club owner can attach leaderboards' }))

    const { data: leaderboard, error: leaderboardError } = await supabase
      .from('leaderboards')
      .select('id, slug')
      .eq('id', leaderboardId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (leaderboardError || !leaderboard?.id) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Leaderboard not found in your account' }))
    }

    const { data: existing } = await supabase
      .from('club_leaderboards')
      .select('id')
      .eq('club_id', ownedClub.id)
      .eq('leaderboard_id', leaderboard.id)
      .maybeSingle()

    if (existing?.id) {
      redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard already attached' }))
    }

    const { error } = await supabase.from('club_leaderboards').insert({
      club_id: ownedClub.id,
      leaderboard_id: leaderboard.id,
      added_by_user_id: user.id,
    })

    if (error) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard attached' }))
  }

  async function detachLeaderboard(formData: FormData) {
    'use server'

    const linkId = String(formData.get('link_id') ?? '').trim()
    if (!linkId) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Missing attached leaderboard' }))
    }

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: ownedClub } = await getOwnedClub(supabase, slug, user.id)
    if (!ownedClub?.id) redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Only the club owner can manage leaderboards' }))

    const { error } = await supabase.from('club_leaderboards').delete().eq('id', linkId).eq('club_id', ownedClub.id)

    if (error) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard removed' }))
  }

  const hasMemberError = !!memberError
  const hasLeaderboardError = !!linksError || !!leaderboardsRes.error
  const hasAttachError = !!userLeaderboardsError

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 lg:py-16">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white/90 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
          {club.banner_url ? (
            <div className="h-44 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={club.banner_url} alt="" className="h-full w-full object-cover" />
            </div>
          ) : (
            <div className="h-32 w-full bg-gradient-to-r from-slate-900 via-slate-800 to-slate-700" />
          )}

          <div className="p-6 lg:p-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100 lg:text-4xl">
                    {club.name}
                  </h1>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white dark:bg-slate-100 dark:text-slate-900">
                    {club.visibility ?? 'PUBLIC'}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {club.slug}
                  </span>
                </div>
                {club.description && (
                  <p className="mt-3 max-w-2xl text-base text-slate-600 dark:text-slate-300">{club.description}</p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
                  {updatedLabel && <span>Updated {updatedLabel}</span>}
                  <span>{memberCount} member{memberCount === 1 ? '' : 's'}</span>
                  <span>{leaderboardCount} leaderboard{leaderboardCount === 1 ? '' : 's'}</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Link
                  href="/clubs"
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  ← Back to clubs
                </Link>
                {canManage ? (
                  <Link
                    href="/dashboard?section=club#club"
                    className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    Manage in dashboard
                  </Link>
                ) : (
                  <span className="inline-flex items-center justify-center rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Club owner manages settings
                  </span>
                )}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-2">
              {TABS.map((tab) => {
                const isActive = tab === activeTab
                return (
                  <Link
                    key={tab}
                    href={clubUrl(club.slug, { tab })}
                    className={`rounded-xl px-4 py-2 text-sm font-semibold capitalize transition ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-white'
                    }`}
                  >
                    {tab}
                  </Link>
                )
              })}
            </div>
          </div>
        </div>

        {(clubOk || clubErr || hasMemberError || hasLeaderboardError || hasAttachError) && (
          <div className="mt-6 space-y-3">
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
            {hasMemberError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Member data is unavailable right now. {memberError?.message}
              </div>
            )}
            {hasLeaderboardError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Attached leaderboards could not be loaded. {linksError?.message ?? leaderboardsRes.error?.message}
              </div>
            )}
            {hasAttachError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                Your leaderboards are not available to attach. {userLeaderboardsError?.message}
              </div>
            )}
          </div>
        )}

        {activeTab === 'home' && (
          <section className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club home</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                This is the public landing page for the club. Share your identity, link your favorite competitions, and keep your roster in sync.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Members</p>
                  <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{memberCount}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Riot IDs on the roster</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leaderboards</p>
                  <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{leaderboardCount}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Attached competitions</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Club settings</p>
              <p className="mt-2">Manage club settings, banner, and deletion from the dashboard.</p>
            </div>
          </section>
        )}

        {activeTab === 'members' && (
          <section className="mt-8 space-y-4">
            {canManage && (
              <form action={addMember} className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Add a Riot ID</h2>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Owner-managed roster
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Riot SSO approvals will come later. For now, add members manually by Riot ID.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                  <input
                    name="riot_id"
                    placeholder="gameName#tagLine"
                    required
                    autoFocus={activeTab === 'members'}
                    className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    Add member
                  </button>
                </div>
              </form>
            )}

            {members.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="text-base font-bold text-slate-600 dark:text-slate-200">No members yet</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add Riot IDs to build the roster.</p>
              </div>
            ) : (
              members.map((member, idx) => {
                const riotId = member.game_name && member.tag_line ? `${member.game_name}#${member.tag_line}` : null
                const profileIconId = member.player_puuid ? riotStateByPuuid.get(member.player_puuid) ?? null : null
                const iconUrl = profileIconId
                  ? `https://ddragon.leagueoflegends.com/cdn/${process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'}/img/profileicon/${profileIconId}.png`
                  : null
                const joinedLabel = formatDate(member.joined_at)
                const profileName = member.user_id ? profilesByUserId.get(member.user_id) : null
                const displayName = riotId ?? profileName ?? (member.user_id ? 'Owner' : 'Member')
                const isOwnerMember = member.role?.toUpperCase() === 'OWNER'

                return (
                  <div
                    key={member.id}
                    className="flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      {iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={iconUrl}
                          alt=""
                          className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-xl border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">#{idx + 1}</span>
                          <h3 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">{displayName}</h3>
                          <MemberBadge role={member.role} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                          {riotId && <span>Riot ID</span>}
                          {joinedLabel && <span>Joined {joinedLabel}</span>}
                        </div>
                      </div>
                    </div>

                    {canManage && !isOwnerMember && (
                      <form action={removeMember}>
                        <input type="hidden" name="member_id" value={member.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:border-rose-400"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                )
              })
            )}
          </section>
        )}

        {activeTab === 'leaderboards' && (
          <section className="mt-8 space-y-6">
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Attached leaderboards</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Attach competitions from the owner account to represent the club.
                  </p>
                </div>
                {canManage && (
                  <form action={attachLeaderboard} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
                    <select
                      name="leaderboard_id"
                      className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      defaultValue=""
                    >
                      <option value="" disabled>
                        {attachableLeaderboards.length > 0 ? 'Select one of your leaderboards…' : 'No available leaderboards'}
                      </option>
                      {attachableLeaderboards.map((lb) => (
                        <option key={lb.id} value={lb.id}>
                          {lb.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={attachableLeaderboards.length === 0}
                    >
                      Attach
                    </button>
                  </form>
                )}
              </div>
              {!canManage && (
                <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                  The club owner decides which leaderboards are attached here.
                </p>
              )}
            </div>

            <div className="space-y-3">
              {attachedLeaderboards.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
                  <p className="text-base font-bold text-slate-600 dark:text-slate-200">No leaderboards attached</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Attach one to showcase the club’s progress.</p>
                </div>
              ) : (
                attachedLeaderboards.map((item) => {
                  const lb = item.leaderboard
                  const updatedAt = formatDate(lb?.updated_at)
                  const addedAt = formatDate(item.addedAt)

                  return (
                    <div
                      key={item.linkId}
                      className="group overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      {lb?.banner_url && (
                        <div className="h-28 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={lb.banner_url} alt="" className="h-full w-full object-cover" />
                        </div>
                      )}
                      <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">{lb?.name ?? 'Unknown leaderboard'}</h3>
                            {lb?.visibility && (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                                {lb.visibility}
                              </span>
                            )}
                          </div>
                          {lb?.description && (
                            <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{lb.description}</p>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            {updatedAt && <span>Updated {updatedAt}</span>}
                            {addedAt && <span>Attached {addedAt}</span>}
                          </div>
                        </div>

                        <div className="flex flex-col gap-2">
                          {lb?.slug && (
                            <Link
                              href={`/lb/${lb.slug}`}
                              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                            >
                              Open leaderboard
                            </Link>
                          )}
                          {canManage && (
                            <form action={detachLeaderboard}>
                              <input type="hidden" name="link_id" value={item.linkId} />
                              <button
                                type="submit"
                                className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:border-rose-400"
                              >
                                Remove
                              </button>
                            </form>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
