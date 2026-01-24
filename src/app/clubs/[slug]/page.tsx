import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

const TABS = ['home', 'members', 'leaderboards'] as const
type ClubTab = (typeof TABS)[number]

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

type ClubRow = {
  id: string
  name: string
  slug: string
  description: string | null
  visibility: string | null
  created_at: string | null
  updated_at: string | null
  owner_user_id: string | null
}

type MemberRow = {
  id: string
  user_id: string | null
  role: string | null
  joined_at: string | null
  player_puuid: string | null
}

type PlayerRow = {
  puuid: string
  game_name: string | null
  tag_line: string | null
}

type ClubLeaderboardRow = {
  id: string
  leaderboard_id: string
  created_at: string | null
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

function MemberBadge({ role }: { role?: string | null }) {
  if (!role) return null
  const isOwner = role.toUpperCase() === 'OWNER'
  return (
    <span
      className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${
        isOwner
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
      }`}
    >
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
  const [{ data: auth }, { data: clubRaw, error: clubError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('clubs')
      .select('id, name, slug, description, visibility, created_at, updated_at, owner_user_id')
      .eq('slug', slug)
      .maybeSingle(),
  ])

  const user = auth.user

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

  const [membersRes, linksRes, userLeaderboardsRes] = await Promise.all([
    supabase
      .from('club_members')
      .select('id, user_id, role, joined_at, player_puuid')
      .eq('club_id', club.id)
      .order('joined_at', { ascending: true }),
    supabase
      .from('club_leaderboards')
      .select('id, leaderboard_id, created_at')
      .eq('club_id', club.id)
      .order('created_at', { ascending: false }),
    user
      ? supabase
          .from('leaderboards')
          .select('id, name, slug, description, updated_at, banner_url, visibility')
          .eq('user_id', user.id)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [] as LeaderboardRow[], error: null }),
  ])

  const members = (membersRes.data ?? []) as MemberRow[]
  const memberError = membersRes.error

  const memberPuuids = Array.from(new Set(members.map((m) => m.player_puuid).filter((v): v is string => !!v)))
  const playersRes = memberPuuids.length
    ? await supabase.from('players').select('puuid, game_name, tag_line').in('puuid', memberPuuids)
    : { data: [] as PlayerRow[], error: null }
  const playersByPuuid = new Map((playersRes.data ?? []).map((p) => [p.puuid, p as PlayerRow]))

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

  const currentMembership = user ? members.find((member) => member.user_id === user.id) ?? null : null
  const isOwner = user ? club.owner_user_id === user.id || currentMembership?.role?.toUpperCase() === 'OWNER' : false
  const canManage = !!user && (isOwner || !!currentMembership)

  const userLeaderboards = (userLeaderboardsRes.data ?? []) as LeaderboardRow[]
  const userLeaderboardsError = userLeaderboardsRes.error
  const attachedIds = new Set(attachedLeaderboards.map((item) => item.leaderboard?.id).filter((v): v is string => !!v))
  const attachableLeaderboards = userLeaderboards.filter((lb) => !attachedIds.has(lb.id))

  const memberCount = members.length
  const leaderboardCount = attachedLeaderboards.filter((item) => item.leaderboard).length
  const updatedLabel = formatDate(club.updated_at ?? club.created_at)

  async function joinClub() {
    'use server'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: club, error: clubError } = await supabase.from('clubs').select('id, slug, owner_user_id').eq('slug', slug).maybeSingle()
    if (clubError || !club?.id) {
      redirect(clubUrl(slug, { tab: 'members', err: clubError?.message ?? 'Club not found' }))
    }

    if (club.owner_user_id === user.id) {
      redirect(clubUrl(slug, { tab: 'members', ok: 'You are already the owner' }))
    }

    const { data: existing } = await supabase
      .from('club_members')
      .select('id')
      .eq('club_id', club.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (existing?.id) {
      redirect(clubUrl(slug, { tab: 'members', ok: 'You are already a member' }))
    }

    const { error } = await supabase.from('club_members').insert({
      club_id: club.id,
      user_id: user.id,
      role: 'MEMBER',
    })

    if (error) {
      redirect(clubUrl(slug, { tab: 'members', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'members', ok: 'Joined club' }))
  }

  async function leaveClub() {
    'use server'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: club, error: clubError } = await supabase.from('clubs').select('id, slug, owner_user_id').eq('slug', slug).maybeSingle()
    if (clubError || !club?.id) {
      redirect(clubUrl(slug, { tab: 'members', err: clubError?.message ?? 'Club not found' }))
    }

    if (club.owner_user_id === user.id) {
      redirect(clubUrl(slug, { tab: 'members', err: 'Owners cannot leave their club' }))
    }

    const { error } = await supabase.from('club_members').delete().eq('club_id', club.id).eq('user_id', user.id)

    if (error) {
      redirect(clubUrl(slug, { tab: 'members', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'members', ok: 'Left club' }))
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

    const { data: club, error: clubError } = await supabase.from('clubs').select('id, slug, owner_user_id').eq('slug', slug).maybeSingle()
    if (clubError || !club?.id) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: clubError?.message ?? 'Club not found' }))
    }

    const { data: membership } = await supabase
      .from('club_members')
      .select('id, role')
      .eq('club_id', club.id)
      .eq('user_id', user.id)
      .maybeSingle()

    const isOwner = club.owner_user_id === user.id || membership?.role?.toUpperCase() === 'OWNER'
    if (!membership?.id && !isOwner) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Join the club to attach leaderboards' }))
    }

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
      .eq('club_id', club.id)
      .eq('leaderboard_id', leaderboard.id)
      .maybeSingle()

    if (existing?.id) {
      redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard already attached' }))
    }

    const { error } = await supabase.from('club_leaderboards').insert({
      club_id: club.id,
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

    const { data: club, error: clubError } = await supabase.from('clubs').select('id, slug, owner_user_id').eq('slug', slug).maybeSingle()
    if (clubError || !club?.id) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: clubError?.message ?? 'Club not found' }))
    }

    const { data: membership } = await supabase
      .from('club_members')
      .select('id, role')
      .eq('club_id', club.id)
      .eq('user_id', user.id)
      .maybeSingle()

    const isOwner = club.owner_user_id === user.id || membership?.role?.toUpperCase() === 'OWNER'
    if (!membership?.id && !isOwner) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Join the club to manage leaderboards' }))
    }

    const { error } = await supabase.from('club_leaderboards').delete().eq('id', linkId).eq('club_id', club.id)

    if (error) {
      redirect(clubUrl(slug, { tab: 'leaderboards', err: error.message }))
    }

    revalidatePath('/clubs')
    revalidatePath(`/clubs/${slug}`)
    redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard removed' }))
  }

  const hasMemberError = !!memberError || !!playersRes.error
  const hasLeaderboardError = !!linksError || !!leaderboardsRes.error
  const hasAttachError = !!userLeaderboardsError

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 lg:py-16">
        <div className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100 lg:text-4xl">
                  {club.name}
                </h1>
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white dark:bg-slate-100 dark:text-slate-900">
                  {club.visibility ?? 'PUBLIC'}
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
              {user && !currentMembership && !isOwner && (
                <form action={joinClub}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500"
                  >
                    Join club
                  </button>
                </form>
              )}
              {user && currentMembership && !isOwner && (
                <form action={leaveClub}>
                  <button
                    type="submit"
                    className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:border-rose-400"
                  >
                    Leave club
                  </button>
                </form>
              )}
              {user && isOwner && (
                <span className="inline-flex items-center justify-center rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  You own this club
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
                Member data is unavailable right now. {memberError?.message ?? playersRes.error?.message}
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
          <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club home</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Use clubs to organize multiple leaderboards under one banner. Invite friends, keep tabs on members, and attach competitions that matter to the group.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Members</p>
                  <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{memberCount}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Active club roster</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leaderboards</p>
                  <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{leaderboardCount}</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Attached competitions</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Quick links</h2>
              <div className="mt-4 space-y-3">
                <Link
                  href={clubUrl(club.slug, { tab: 'members' })}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  View members
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href={clubUrl(club.slug, { tab: 'leaderboards' })}
                  className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  Manage leaderboards
                  <span aria-hidden>→</span>
                </Link>
              </div>
              {!user && (
                <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                  Sign in to join the club and attach your own leaderboards.
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'members' && (
          <section className="mt-8 space-y-4">
            {members.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="text-base font-bold text-slate-600 dark:text-slate-200">No members yet</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Invite friends or be the first to join.</p>
              </div>
            ) : (
              members.map((member, idx) => {
                const player = member.player_puuid ? playersByPuuid.get(member.player_puuid) ?? null : null
                const riotId = player?.game_name && player?.tag_line ? `${player.game_name}#${player.tag_line}` : null
                const joinedLabel = formatDate(member.joined_at)
                const displayName = riotId ?? (member.user_id ? `User ${member.user_id.slice(0, 8)}` : 'Unknown member')

                return (
                  <div
                    key={member.id}
                    className="flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">#{idx + 1}</span>
                        <h3 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">{displayName}</h3>
                        <MemberBadge role={member.role} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                        {riotId && <span>Linked Riot ID</span>}
                        {joinedLabel && <span>Joined {joinedLabel}</span>}
                      </div>
                    </div>
                    {member.user_id === club.owner_user_id && (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        Club owner
                      </span>
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
                    Link the competitions that define this club.
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
                  Join the club to attach leaderboards from your account.
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
                      className="group rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
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
