import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  addHighlight,
  addMember,
  attachLeaderboard,
  deleteHighlight,
  detachLeaderboard,
  removeMember,
} from './actions'
import AlertBanner from './components/AlertBanner'
import ClubHeader from './components/ClubHeader'
import HighlightsTab from './tabs/HighlightsTab'
import HomeTab from './tabs/HomeTab'
import LeaderboardsTab from './tabs/LeaderboardsTab'
import MembersTab from './tabs/MembersTab'
import type {
  AttachedLeaderboard,
  ClubLeaderboardRow,
  ClubNameRow,
  ClubRow,
  ClubShowdownRow,
  HighlightRow,
  LeaderboardRow,
  MemberRow,
} from './types'
import { resolveTab } from './utils'

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

  const user = auth.user
  const ownerId = user?.id ?? null
  const canManage = !!ownerId && club.owner_user_id === ownerId

  const [membersRes, linksRes, userLeaderboardsRes, highlightsRes, showdownsRes] = await Promise.all([
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
          .select('id, name, slug, leaderboard_code, description, updated_at, banner_url, visibility')
          .eq('user_id', ownerId!)
          .order('name', { ascending: true })
      : Promise.resolve({ data: [] as LeaderboardRow[], error: null }),
    supabase
      .from('club_highlights')
      .select('id, club_id, user_id, url, duration_seconds, created_at')
      .eq('club_id', club.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('club_showdown_requests')
      .select('id, requester_club_id, target_club_id, status, created_at')
      .or(`requester_club_id.eq.${club.id},target_club_id.eq.${club.id}`)
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  const members = (membersRes.data ?? []) as MemberRow[]
  const memberError = membersRes.error

  const memberPuuids = members.map((member) => member.player_puuid).filter((v): v is string => !!v)
  const { data: riotStateRaw } = memberPuuids.length
    ? await supabase.from('player_riot_state').select('puuid, profile_icon_id').in('puuid', memberPuuids)
    : { data: [] as Array<{ puuid: string; profile_icon_id: number | null }> }

  const riotStateByPuuid = new Map((riotStateRaw ?? []).map((row) => [row.puuid, row.profile_icon_id]))
  const profilesByUserId = new Map((profilesRaw ?? []).map((row: { user_id: string; username: string }) => [row.user_id, row.username]))

  const links = (linksRes.data ?? []) as ClubLeaderboardRow[]
  const linksError = linksRes.error
  const leaderboardIds = links.map((link) => link.leaderboard_id)

  const leaderboardsRes = leaderboardIds.length
    ? await supabase
        .from('leaderboards')
        .select('id, name, slug, leaderboard_code, description, updated_at, banner_url, visibility')
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

  const highlights = (highlightsRes.data ?? []) as HighlightRow[]
  const highlightsError = highlightsRes.error

  const showdowns = (showdownsRes.data ?? []) as ClubShowdownRow[]
  const showdownsError = showdownsRes.error
  const showdownClubIds = Array.from(new Set(showdowns.flatMap((showdown) => [showdown.requester_club_id, showdown.target_club_id])))
  const showdownClubsRes = showdownClubIds.length
    ? await supabase.from('clubs').select('id, name').in('id', showdownClubIds)
    : { data: [] as ClubNameRow[], error: null }
  const showdownClubsById = new Map((showdownClubsRes.data ?? []).map((row) => [row.id, row.name]))

  const memberCount = members.length
  const leaderboardCount = attachedLeaderboards.filter((item) => item.leaderboard).length
  const latestMembers = [...members]
    .sort((a, b) => {
      const aTs = a.joined_at ? new Date(a.joined_at).getTime() : 0
      const bTs = b.joined_at ? new Date(b.joined_at).getTime() : 0
      return bTs - aTs
    })
    .slice(0, 8)

  const canPostHighlight = !!user && (club.owner_user_id === user.id || members.some((member) => member.user_id === user.id))

  const hasMemberError = !!memberError
  const hasLeaderboardError = !!linksError || !!leaderboardsRes.error
  const hasAttachError = !!userLeaderboardsError
  const hasHighlightsError = !!highlightsError
  const hasShowdownError = !!showdownsError

  return (
    <main className="lb-less-rounded min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full space-y-8 px-6 py-8 lg:px-10 lg:py-12">
        <ClubHeader club={club} activeTab={activeTab} canManage={canManage} />

        {(clubOk || clubErr || hasMemberError || hasLeaderboardError || hasAttachError || hasHighlightsError || hasShowdownError) && (
          <div className="mt-6 space-y-3">
            {clubOk && <AlertBanner tone="success">{clubOk}</AlertBanner>}
            {clubErr && <AlertBanner tone="error">{clubErr}</AlertBanner>}
            {hasMemberError && <AlertBanner tone="warning">Member data is unavailable right now. {memberError?.message}</AlertBanner>}
            {hasLeaderboardError && (
              <AlertBanner tone="warning">Attached leaderboards could not be loaded. {linksError?.message ?? leaderboardsRes.error?.message}</AlertBanner>
            )}
            {hasAttachError && <AlertBanner tone="warning">Your leaderboards are not available to attach. {userLeaderboardsError?.message}</AlertBanner>}
            {hasHighlightsError && <AlertBanner tone="warning">Highlights could not be loaded. {highlightsError?.message}</AlertBanner>}
            {hasShowdownError && <AlertBanner tone="warning">Showdown log could not be loaded. {showdownsError?.message}</AlertBanner>}
          </div>
        )}

        {activeTab === 'home' && (
          <HomeTab
            clubId={club.id}
            latestMembers={latestMembers}
            memberCount={memberCount}
            leaderboardCount={leaderboardCount}
            riotStateByPuuid={riotStateByPuuid}
            profilesByUserId={profilesByUserId}
            showdowns={showdowns}
            showdownClubsById={showdownClubsById}
          />
        )}

        {activeTab === 'members' && (
          <MembersTab
            slug={slug}
            canManage={canManage}
            members={members}
            riotStateByPuuid={riotStateByPuuid}
            profilesByUserId={profilesByUserId}
            addMemberAction={addMember}
            removeMemberAction={removeMember}
          />
        )}

        {activeTab === 'leaderboards' && (
          <LeaderboardsTab
            slug={slug}
            canManage={canManage}
            attachableLeaderboards={attachableLeaderboards}
            attachedLeaderboards={attachedLeaderboards}
            attachLeaderboardAction={attachLeaderboard}
            detachLeaderboardAction={detachLeaderboard}
          />
        )}

        {activeTab === 'highlights' && (
          <HighlightsTab
            slug={slug}
            userId={user?.id ?? null}
            canPostHighlight={canPostHighlight}
            highlights={highlights}
            members={members}
            profilesByUserId={profilesByUserId}
            riotStateByPuuid={riotStateByPuuid}
            addHighlightAction={addHighlight}
            deleteHighlightAction={deleteHighlight}
          />
        )}
      </div>
    </main>
  )
}
