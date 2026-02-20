'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { resolvePuuid } from '@/lib/riot/resolvePuuid'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from './types'
import { clubUrl, errorMessage, parseRiotId } from './utils'

async function getOwnedClub(client: SupabaseClient, slug: string, userId: string) {
  return client
    .from('clubs')
    .select('id, slug')
    .eq('slug', slug)
    .eq('owner_user_id', userId)
    .maybeSingle()
}

export async function addMember(formData: FormData) {
  const slug = String(formData.get('slug') ?? '').trim()
  const riotIdRaw = String(formData.get('riot_id') ?? '').trim()

  if (!slug) redirect('/clubs')
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

  if (error) redirect(clubUrl(slug, { tab: 'members', err: error.message }))

  revalidatePath('/clubs')
  revalidatePath(`/clubs/${slug}`)
  redirect(clubUrl(slug, { tab: 'members', ok: `Added ${gameName}#${tagLine}` }))
}

export async function removeMember(formData: FormData) {
  const slug = String(formData.get('slug') ?? '').trim()
  const memberId = String(formData.get('member_id') ?? '').trim()

  if (!slug) redirect('/clubs')
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
  if (error) redirect(clubUrl(slug, { tab: 'members', err: error.message }))

  revalidatePath('/clubs')
  revalidatePath(`/clubs/${slug}`)
  redirect(clubUrl(slug, { tab: 'members', ok: 'Member removed' }))
}

export async function attachLeaderboard(formData: FormData) {
  const slug = String(formData.get('slug') ?? '').trim()
  const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()

  if (!slug) redirect('/clubs')
  if (!leaderboardId) redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Select a leaderboard' }))

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

  if (existing?.id) redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard already attached' }))

  const { error } = await supabase.from('club_leaderboards').insert({
    club_id: ownedClub.id,
    leaderboard_id: leaderboard.id,
    added_by_user_id: user.id,
  })

  if (error) redirect(clubUrl(slug, { tab: 'leaderboards', err: error.message }))

  revalidatePath('/clubs')
  revalidatePath(`/clubs/${slug}`)
  redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard attached' }))
}

export async function detachLeaderboard(formData: FormData) {
  const slug = String(formData.get('slug') ?? '').trim()
  const linkId = String(formData.get('link_id') ?? '').trim()

  if (!slug) redirect('/clubs')
  if (!linkId) redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Missing attached leaderboard' }))

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  const { data: ownedClub } = await getOwnedClub(supabase, slug, user.id)
  if (!ownedClub?.id) redirect(clubUrl(slug, { tab: 'leaderboards', err: 'Only the club owner can manage leaderboards' }))

  const { error } = await supabase.from('club_leaderboards').delete().eq('id', linkId).eq('club_id', ownedClub.id)
  if (error) redirect(clubUrl(slug, { tab: 'leaderboards', err: error.message }))

  revalidatePath('/clubs')
  revalidatePath(`/clubs/${slug}`)
  redirect(clubUrl(slug, { tab: 'leaderboards', ok: 'Leaderboard removed' }))
}

export async function addHighlight(formData: FormData) {
  const slug = String(formData.get('slug') ?? '').trim()
  const urlRaw = String(formData.get('video_url') ?? '').trim()
  const resolvedUrl = String(formData.get('resolved_url') ?? '').trim()
  const durationRaw = String(formData.get('duration_seconds') ?? '').trim()

  if (!slug) redirect('/clubs')
  if (!urlRaw) redirect(clubUrl(slug, { tab: 'highlights', err: 'Add a video link first.' }))

  const finalUrl = resolvedUrl || urlRaw
  let durationSeconds = Number(durationRaw)

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    redirect(clubUrl(slug, { tab: 'highlights', err: 'Unable to read video length. Use a direct video link.' }))
  }

  durationSeconds = Math.round(durationSeconds)
  if (durationSeconds > 30) redirect(clubUrl(slug, { tab: 'highlights', err: 'Video must be 30 seconds or less.' }))

  try {
    new URL(finalUrl)
  } catch {
    redirect(clubUrl(slug, { tab: 'highlights', err: 'Invalid video URL.' }))
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  const { data: club } = await supabase.from('clubs').select('id, owner_user_id').eq('slug', slug).maybeSingle()
  if (!club?.id) redirect('/clubs')

  if (club.owner_user_id !== user.id) {
    const { data: member } = await supabase
      .from('club_members')
      .select('id')
      .eq('club_id', club.id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!member?.id) redirect(clubUrl(slug, { tab: 'highlights', err: 'Only club members can post highlights.' }))
  }

  const { error } = await supabase.from('club_highlights').insert({
    club_id: club.id,
    user_id: user.id,
    url: finalUrl,
    duration_seconds: durationSeconds,
  })

  if (error) redirect(clubUrl(slug, { tab: 'highlights', err: error.message }))

  revalidatePath(`/clubs/${slug}`)
  redirect(clubUrl(slug, { tab: 'highlights', ok: 'Highlight added.' }))
}

export async function deleteHighlight(formData: FormData) {
  const slug = String(formData.get('slug') ?? '').trim()
  const highlightId = String(formData.get('highlight_id') ?? '').trim()

  if (!slug) redirect('/clubs')
  if (!highlightId) redirect(clubUrl(slug, { tab: 'highlights', err: 'Missing highlight to delete.' }))

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  const { data: club } = await supabase.from('clubs').select('id').eq('slug', slug).maybeSingle()
  if (!club?.id) redirect('/clubs')

  const { data: highlight, error: highlightError } = await supabase
    .from('club_highlights')
    .select('id, club_id, user_id')
    .eq('id', highlightId)
    .eq('club_id', club.id)
    .maybeSingle()

  if (highlightError || !highlight) {
    redirect(clubUrl(slug, { tab: 'highlights', err: highlightError?.message ?? 'Highlight not found.' }))
  }

  if (highlight.user_id !== user.id) {
    redirect(clubUrl(slug, { tab: 'highlights', err: 'You can only delete your own highlights.' }))
  }

  const { error } = await supabase
    .from('club_highlights')
    .delete()
    .eq('id', highlight.id)
    .eq('club_id', club.id)
    .eq('user_id', user.id)

  if (error) redirect(clubUrl(slug, { tab: 'highlights', err: error.message }))

  revalidatePath(`/clubs/${slug}`)
  redirect(clubUrl(slug, { tab: 'highlights', ok: 'Highlight deleted.' }))
}
