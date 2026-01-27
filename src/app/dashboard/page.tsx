import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePuuid } from '@/lib/riot/resolvePuuid'
import { buildClubSlug, CLUB_SLUG_PART_MAX, normalizeSlugPart, parseClubSlug, validateSlugPart } from '@/lib/clubSlug'
import { AddPlayerButton } from './AddPlayerButton'
import GoalModeFields from './GoalModeFields'

// --- Constants & Types ---
const VISIBILITY = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const
type Visibility = (typeof VISIBILITY)[number]

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
const MAX_PLAYERS = 30
const CLUB_BANNER_BUCKET = 'leaderboard-banners'

type ClubRow = {
  id: string
  name: string
  slug: string
  description: string | null
  visibility: string | null
  banner_url: string | null
  updated_at: string | null
  owner_user_id: string
}

function normalizePlayerError(message: string) {
  if (message.includes('Player limit reached')) {
    return `Player limit reached (${MAX_PLAYERS} max)`
  }
  return message
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

// --- Helper Functions ---
function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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

function sectionRedirect(opts: {
  section: 'settings' | 'banner' | 'players' | 'club' | 'top'
  ok?: string
  err?: string
  clubOk?: string
  clubErr?: string
  deleteConfirm?: boolean
  clubDeleteConfirm?: boolean
}) {
  const params = new URLSearchParams()
  if (opts.ok) params.set('player_ok', opts.ok)
  if (opts.err) params.set('player_err', opts.err)
  if (opts.deleteConfirm) params.set('delete_confirm', '1')
  if (opts.clubOk) params.set('club_ok', opts.clubOk)
  if (opts.clubErr) params.set('club_err', opts.clubErr)
  if (opts.clubDeleteConfirm) params.set('club_delete_confirm', '1')
  if (opts.section !== 'top') params.set('section', opts.section)
  const hash = opts.section !== 'top' ? `#${opts.section}` : ''
  const qs = params.toString()
  return `/dashboard${qs.length ? `?${qs}` : ''}${hash}`
}

// --- Main Page Component ---
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?:
    | { player_err?: string; player_ok?: string; delete_confirm?: string; club_err?: string; club_ok?: string; club_delete_confirm?: string; section?: string }
    | Promise<{ player_err?: string; player_ok?: string; delete_confirm?: string; club_err?: string; club_ok?: string; club_delete_confirm?: string; section?: string }>
}) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  const sp = await Promise.resolve(searchParams ?? {})
  const playerErr = sp.player_err ? normalizePlayerError(decodeURIComponent(sp.player_err)) : null
  const playerOk = sp.player_ok ? decodeURIComponent(sp.player_ok) : null
  const showDeleteConfirm = sp.delete_confirm === '1'
  const clubErr = sp.club_err ? decodeURIComponent(sp.club_err) : null
  const clubOk = sp.club_ok ? decodeURIComponent(sp.club_ok) : null
  const showClubDeleteConfirm = sp.club_delete_confirm === '1'
  const section = (sp.section ?? 'top').toString()

  const openSettings = section === 'settings'
  const openBanner = section === 'banner'
  const openPlayers = section === 'players'
  const openClub = section === 'club'

  // Fetch Leaderboard
  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, name, slug, visibility, description, banner_url, goal_mode, race_start_at, race_end_at, lp_goal, rank_goal_tier')
    .eq('user_id', user.id)
    .maybeSingle()

  // Fetch Players (if leaderboard exists)
  const { data: players } = lb
    ? await supabase
        .from('leaderboard_players')
        .select('id, role, game_name, tag_line, puuid, twitch_url, twitter_url, created_at')
        .eq('leaderboard_id', lb.id)
        .order('created_at', { ascending: true })
    : { data: null }

  const [{ data: clubRaw }, { data: profileRaw }] = await Promise.all([
    supabase
      .from('clubs')
      .select('id, name, slug, description, visibility, banner_url, updated_at, owner_user_id')
      .eq('owner_user_id', user.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('user_id, username, updated_at')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const club = (clubRaw ?? null) as ClubRow | null
  const profile = (profileRaw ?? null) as { user_id: string; username: string; updated_at: string | null } | null

  const [{ count: clubMemberCount }, { count: clubLeaderboardCount }] = club
    ? await Promise.all([
        supabase.from('club_members').select('id', { count: 'exact', head: true }).eq('club_id', club.id),
        supabase.from('club_leaderboards').select('id', { count: 'exact', head: true }).eq('club_id', club.id),
      ])
    : [{ count: 0 }, { count: 0 }]

  // --- Server Actions ---

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

    if (error) redirect(sectionRedirect({ section: 'top', err: 'Failed to create leaderboard' }))
    redirect(sectionRedirect({ section: 'settings', ok: 'Leaderboard created' }))
  }

  async function updateLeaderboard(formData: FormData) {
    'use server'

    const name = String(formData.get('name') ?? '').trim()
    const descriptionRaw = String(formData.get('description') ?? '').trim().slice(0, 250)
    const visibilityRaw = String(formData.get('visibility') ?? '').trim()

    const goalModeRaw = String(formData.get('goal_mode') ?? '').trim().toUpperCase()
    const raceStartRaw = String(formData.get('race_start_at') ?? '').trim()
    const raceEndRaw = String(formData.get('race_end_at') ?? '').trim()
    const lpGoalRaw = String(formData.get('lp_goal') ?? '').trim()
    const rankGoalRaw = String(formData.get('rank_goal_tier') ?? '').trim().toUpperCase()

    const safeVisibility: Visibility = VISIBILITY.includes(visibilityRaw as Visibility)
      ? (visibilityRaw as Visibility)
      : 'PUBLIC'

    const validGoalModes = ['LIVE', 'RACE', 'LP_GOAL', 'RANK_GOAL'] as const
    const safeGoalMode = (validGoalModes.includes(goalModeRaw as (typeof validGoalModes)[number])
      ? goalModeRaw
      : 'LIVE') as (typeof validGoalModes)[number]

    const parsedRaceStart = raceStartRaw ? new Date(raceStartRaw) : null
    const parsedRaceEnd = raceEndRaw ? new Date(raceEndRaw) : null
    const raceStartIso = parsedRaceStart && !Number.isNaN(parsedRaceStart.getTime()) ? parsedRaceStart.toISOString() : null
    const raceEndIso = parsedRaceEnd && !Number.isNaN(parsedRaceEnd.getTime()) ? parsedRaceEnd.toISOString() : null

    const lpGoalVal = lpGoalRaw ? Number(lpGoalRaw) : null
    const safeLpGoal = Number.isFinite(lpGoalVal) && (lpGoalVal as number) > 0 ? Math.floor(lpGoalVal as number) : null

    const safeRankGoal = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankGoalRaw)
      ? rankGoalRaw
      : null

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
        goal_mode: safeGoalMode,
        race_start_at: safeGoalMode === 'RACE' ? raceStartIso : null,
        race_end_at: safeGoalMode === 'RACE' ? raceEndIso : null,
        lp_goal: safeGoalMode === 'LP_GOAL' ? safeLpGoal : null,
        rank_goal_tier: safeGoalMode === 'RANK_GOAL' ? safeRankGoal : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lb.id)
      .eq('user_id', user.id)

    redirect(sectionRedirect({ section: 'settings', ok: 'Settings updated' }))
  }

  async function updateProfile(formData: FormData) {
    'use server'

    const usernameRaw = String(formData.get('username') ?? '').trim()
    if (!usernameRaw) return

    const username = usernameRaw.replace(/\s+/g, ' ').slice(0, 24)

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id: user.id, username, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })

    if (error) {
      redirect(sectionRedirect({ section: 'top', err: error.message }))
    }

    redirect(sectionRedirect({ section: 'top', ok: 'Profile updated' }))
  }

  async function updateBanner(formData: FormData) {
    'use server'

    const file = formData.get('banner')
    if (!(file instanceof File) || file.size === 0) return

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

    const bucketName = 'leaderboard-banners'

    const ext = extFromType(file.type)
    if (!ext) redirect(sectionRedirect({ section: 'banner', err: 'Invalid file type (png/jpg/webp only)' }))

    const MAX_MB = 4
    if (file.size > MAX_MB * 1024 * 1024) {
      redirect(sectionRedirect({ section: 'banner', err: `File too large (max ${MAX_MB}MB)` }))
    }

    const filePath = `${user.id}/${lb.id}/banner.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      redirect(sectionRedirect({ section: 'banner', err: 'Upload failed: ' + uploadError.message }))
    }

    const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(filePath)
    const bannerUrl = `${urlData.publicUrl}?v=${cacheBuster()}`

    const { error: dbError } = await supabase
      .from('leaderboards')
      .update({ banner_url: bannerUrl, updated_at: new Date().toISOString() })
      .eq('id', lb.id)
      .eq('user_id', user.id)

    if (dbError) {
      redirect(sectionRedirect({ section: 'banner', err: 'Database update failed: ' + dbError.message }))
    }

    redirect(sectionRedirect({ section: 'banner', ok: 'Banner updated successfully' }))
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

    if (!riotIdRaw) redirect(sectionRedirect({ section: 'players', err: 'Enter a Riot ID like gameName#tagLine' }))

    let gameName = ''
    let tagLine = ''
    try {
      const parsed = parseRiotId(riotIdRaw)
      gameName = parsed.gameName
      tagLine = parsed.tagLine
    } catch (e) {
      redirect(sectionRedirect({ section: 'players', err: errorMessage(e, 'Invalid Riot ID') }))
    }

    const { count } = await supabase
      .from('leaderboard_players')
      .select('*', { count: 'exact', head: true })
      .eq('leaderboard_id', lb.id)

    if ((count ?? 0) >= MAX_PLAYERS) {
      redirect(sectionRedirect({ section: 'players', err: `Max ${MAX_PLAYERS} players per leaderboard` }))
    }

    let puuid = ''
    try {
      puuid = await resolvePuuid(gameName, tagLine)
    } catch (e) {
      redirect(sectionRedirect({ section: 'players', err: errorMessage(e, 'Riot lookup failed') }))
    }

    const { data: dup } = await supabase
      .from('leaderboard_players')
      .select('id')
      .eq('leaderboard_id', lb.id)
      .eq('puuid', puuid)
      .maybeSingle()

    if (dup) redirect(sectionRedirect({ section: 'players', err: 'That player is already on your leaderboard' }))

    const { error } = await supabase.from('leaderboard_players').insert({
      leaderboard_id: lb.id,
      role,
      game_name: gameName,
      tag_line: tagLine,
      puuid,
      twitch_url: twitchUrl,
      twitter_url: twitterUrl,
    })

    if (error) redirect(sectionRedirect({ section: 'players', err: error.message }))

    revalidatePath('/dashboard')
    // Key change: always land back on Players, open, and scrolled there
    redirect(sectionRedirect({ section: 'players', ok: `Added ${gameName}#${tagLine}` }))
  }

  async function updatePlayer(formData: FormData) {
    'use server'

    const playerId = String(formData.get('player_id') ?? '').trim()
    const role = String(formData.get('role') ?? '').trim() || null
    const twitchUrl = String(formData.get('twitch_url') ?? '').trim() || null
    const twitterUrl = String(formData.get('twitter_url') ?? '').trim() || null

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
      .update({ role, twitch_url: twitchUrl, twitter_url: twitterUrl })
      .eq('id', playerId)
      .eq('leaderboard_id', lb.id)

    if (error) redirect(sectionRedirect({ section: 'players', err: error.message }))

    redirect(sectionRedirect({ section: 'players', ok: 'Player updated' }))
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

    const { error } = await supabase.from('leaderboard_players').delete().eq('id', playerId).eq('leaderboard_id', lb.id)

    if (error) redirect(sectionRedirect({ section: 'players', err: error.message }))

    redirect(sectionRedirect({ section: 'players', ok: 'Player removed' }))
  }

  async function armDeleteLeaderboard() {
    'use server'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase.from('leaderboards').select('id').eq('user_id', user.id).maybeSingle()
    if (!lb) redirect(sectionRedirect({ section: 'top', err: 'No leaderboard to delete' }))

    redirect(sectionRedirect({ section: 'top', deleteConfirm: true }))
  }

  async function deleteLeaderboard(formData: FormData) {
    'use server'

    const confirm = String(formData.get('confirm') ?? '').trim()
    if (confirm !== 'DELETE') {
      redirect(sectionRedirect({ section: 'top', err: 'Type DELETE to confirm deletion', deleteConfirm: true }))
    }

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (!lb) redirect(sectionRedirect({ section: 'top', err: 'No leaderboard found to delete' }))

    // Best-effort: delete banner objects
    const bucketName = 'leaderboard-banners'
    const folder = `${user.id}/${lb.id}`
    try {
      const { data: objects } = await supabase.storage.from(bucketName).list(folder, { limit: 100 })
      if (objects?.length) {
        const paths = objects.map((o) => `${folder}/${o.name}`)
        await supabase.storage.from(bucketName).remove(paths)
      }
    } catch {
      // ignore
    }

    const { error: delPlayersErr } = await supabase.from('leaderboard_players').delete().eq('leaderboard_id', lb.id)
    if (delPlayersErr) {
      redirect(sectionRedirect({ section: 'top', err: 'Failed to delete players: ' + delPlayersErr.message }))
    }

    const { error: delLbErr } = await supabase.from('leaderboards').delete().eq('id', lb.id).eq('user_id', user.id)
    if (delLbErr) {
      redirect(sectionRedirect({ section: 'top', err: 'Failed to delete leaderboard: ' + delLbErr.message }))
    }

    redirect(sectionRedirect({ section: 'top', ok: 'Leaderboard deleted' }))
  }

  async function createClub(formData: FormData) {
    'use server'

    const name = String(formData.get('club_name') ?? '').trim()
    const description = String(formData.get('club_description') ?? '').trim().slice(0, 250) || null
    const visibilityRaw = String(formData.get('club_visibility') ?? '').trim()
    const prefixRaw = String(formData.get('club_slug_prefix') ?? '').trim()
    const tagRaw = String(formData.get('club_slug_tag') ?? '').trim()

    if (!prefixRaw || !tagRaw) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Club tag is required' }))
    }

    const prefixInput = normalizeSlugPart(prefixRaw, 'club')
    const tagInput = normalizeSlugPart(tagRaw, 'club')

    const prefixError = validateSlugPart(prefixInput)
    if (prefixError) {
      redirect(sectionRedirect({ section: 'club', clubErr: `Slug prefix: ${prefixError}` }))
    }

    const tagError = validateSlugPart(tagInput)
    if (tagError) {
      redirect(sectionRedirect({ section: 'club', clubErr: `Slug tag: ${tagError}` }))
    }

    if (!name) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Club name is required' }))
    }

    const safeVisibility: Visibility = VISIBILITY.includes(visibilityRaw as Visibility)
      ? (visibilityRaw as Visibility)
      : 'PUBLIC'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: existingClub } = await supabase
      .from('clubs')
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (existingClub?.id) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'You already own a club' }))
    }

    const slug = buildClubSlug(prefixInput, tagInput)
    const { data: slugTaken } = await supabase.from('clubs').select('id').eq('slug', slug).maybeSingle()
    if (slugTaken?.id) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'That club tag is already taken' }))
    }

    const { data: inserted, error } = await supabase
      .from('clubs')
      .insert({
        owner_user_id: user.id,
        name,
        slug,
        description,
        visibility: safeVisibility,
        updated_at: new Date().toISOString(),
      })
      .select('id, slug')
      .maybeSingle()

    if (error || !inserted?.id) {
      const message = error?.code === '23505' ? 'That club tag is already taken' : error?.message ?? 'Failed to create club'
      redirect(sectionRedirect({ section: 'club', clubErr: message }))
    }

    const { error: memberError } = await supabase.from('club_members').insert({
      club_id: inserted.id,
      user_id: user.id,
      role: 'OWNER',
    })

    if (memberError) {
      redirect(sectionRedirect({ section: 'club', clubErr: memberError.message }))
    }

    revalidatePath('/dashboard')
    revalidatePath('/clubs')
    revalidatePath(`/clubs/${inserted.slug}`)
    redirect(sectionRedirect({ section: 'club', clubOk: 'Club created' }))
  }

  async function updateClubSettings(formData: FormData) {
    'use server'

    const name = String(formData.get('club_name') ?? '').trim()
    const description = String(formData.get('club_description') ?? '').trim().slice(0, 250) || null
    const visibilityRaw = String(formData.get('club_visibility') ?? '').trim()
    const prefixRaw = String(formData.get('club_slug_prefix') ?? '').trim()
    const tagRaw = String(formData.get('club_slug_tag') ?? '').trim()

    if (!prefixRaw || !tagRaw) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Club tag is required' }))
    }

    const prefixInput = normalizeSlugPart(prefixRaw, 'club')
    const tagInput = normalizeSlugPart(tagRaw, 'club')

    const prefixError = validateSlugPart(prefixInput)
    if (prefixError) {
      redirect(sectionRedirect({ section: 'club', clubErr: `Slug prefix: ${prefixError}` }))
    }

    const tagError = validateSlugPart(tagInput)
    if (tagError) {
      redirect(sectionRedirect({ section: 'club', clubErr: `Slug tag: ${tagError}` }))
    }

    if (!name) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Club name is required' }))
    }

    const safeVisibility: Visibility = VISIBILITY.includes(visibilityRaw as Visibility)
      ? (visibilityRaw as Visibility)
      : 'PUBLIC'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: club } = await supabase
      .from('clubs')
      .select('id, slug')
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (!club?.id) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'No club found to update' }))
    }

    const slug = buildClubSlug(prefixInput, tagInput)
    const { data: slugTaken } = await supabase.from('clubs').select('id').eq('slug', slug).neq('id', club.id).maybeSingle()
    if (slugTaken?.id) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'That club tag is already taken' }))
    }

    const { error } = await supabase
      .from('clubs')
      .update({
        name,
        slug,
        description,
        visibility: safeVisibility,
        updated_at: new Date().toISOString(),
      })
      .eq('id', club.id)
      .eq('owner_user_id', user.id)

    if (error) {
      const message = error.code === '23505' ? 'That club tag is already taken' : error.message
      redirect(sectionRedirect({ section: 'club', clubErr: message }))
    }

    revalidatePath('/dashboard')
    revalidatePath('/clubs')
    revalidatePath(`/clubs/${club.slug}`)
    revalidatePath(`/clubs/${slug}`)
    redirect(sectionRedirect({ section: 'club', clubOk: 'Club settings updated' }))
  }

  async function updateClubBanner(formData: FormData) {
    'use server'

    const file = formData.get('club_banner')
    if (!(file instanceof File) || file.size === 0) return

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: club } = await supabase
      .from('clubs')
      .select('id, slug')
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (!club?.id) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'No club found to update' }))
    }

    const ext = extFromType(file.type)
    if (!ext) redirect(sectionRedirect({ section: 'club', clubErr: 'Invalid file type (png/jpg/webp only)' }))

    const MAX_MB = 4
    if (file.size > MAX_MB * 1024 * 1024) {
      redirect(sectionRedirect({ section: 'club', clubErr: `File too large (max ${MAX_MB}MB)` }))
    }

    const filePath = `${user.id}/${club.id}/banner.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(CLUB_BANNER_BUCKET)
      .upload(filePath, file, { upsert: true, contentType: file.type })

    if (uploadError) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Upload failed: ' + uploadError.message }))
    }

    const { data: urlData } = supabase.storage.from(CLUB_BANNER_BUCKET).getPublicUrl(filePath)
    const bannerUrl = `${urlData.publicUrl}?v=${cacheBuster()}`

    const { error: dbError } = await supabase
      .from('clubs')
      .update({ banner_url: bannerUrl, updated_at: new Date().toISOString() })
      .eq('id', club.id)
      .eq('owner_user_id', user.id)

    if (dbError) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Database update failed: ' + dbError.message }))
    }

    revalidatePath('/dashboard')
    revalidatePath('/clubs')
    revalidatePath(`/clubs/${club.slug}`)
    redirect(sectionRedirect({ section: 'club', clubOk: 'Club banner updated successfully' }))
  }

  async function deleteClub(formData: FormData) {
    'use server'

    const confirm = String(formData.get('club_confirm') ?? '') === '1'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: club } = await supabase
      .from('clubs')
      .select('id, slug')
      .eq('owner_user_id', user.id)
      .maybeSingle()

    if (!club?.id) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'No club found to delete' }))
    }

    if (!confirm) {
      redirect(sectionRedirect({ section: 'club', clubDeleteConfirm: true }))
    }

    const folder = `${user.id}/${club.id}`
    try {
      const { data: objects } = await supabase.storage.from(CLUB_BANNER_BUCKET).list(folder, { limit: 100 })
      if (objects?.length) {
        const paths = objects.map((o) => `${folder}/${o.name}`)
        await supabase.storage.from(CLUB_BANNER_BUCKET).remove(paths)
      }
    } catch {
      // ignore storage cleanup errors
    }

    const { error: membersError } = await supabase.from('club_members').delete().eq('club_id', club.id)
    if (membersError) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Failed to delete members: ' + membersError.message }))
    }

    const { error: linksError } = await supabase.from('club_leaderboards').delete().eq('club_id', club.id)
    if (linksError) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Failed to detach leaderboards: ' + linksError.message }))
    }

    const { error: clubError } = await supabase.from('clubs').delete().eq('id', club.id).eq('owner_user_id', user.id)
    if (clubError) {
      redirect(sectionRedirect({ section: 'club', clubErr: 'Failed to delete club: ' + clubError.message }))
    }

    revalidatePath('/dashboard')
    revalidatePath('/clubs')
    revalidatePath(`/clubs/${club.slug}`)
    redirect(sectionRedirect({ section: 'club', clubOk: 'Club deleted' }))
  }

  // --- JSX Render ---
  const shareUrl = lb ? `https://cwf.lol/lb/${lb.slug}` : null
  const playerCount = players?.length ?? 0
  const clubSlugParts = parseClubSlug(club?.slug)
  const clubShareUrl = club ? `https://cwf.lol/clubs/${club.slug}` : null
  const clubMembers = clubMemberCount ?? 0
  const clubLeaderboards = clubLeaderboardCount ?? 0

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-10 lg:py-16">
        {/* Header */}
        <div className="mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400">
              Dashboard
            </h1>
            <p className="mt-2 text-base text-slate-600 font-medium dark:text-slate-300">Manage your leaderboard and players</p>
          </div>

          {lb && (
            <div className="flex items-center gap-2">
              {!showDeleteConfirm ? (
                <form action={armDeleteLeaderboard}>
                  <button
                    type="submit"
                    className="rounded-2xl border-2 border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 hover:-translate-y-0.5 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
                    title="Delete leaderboard"
                  >
                    Delete
                  </button>
                </form>
              ) : (
                <form action={deleteLeaderboard} className="flex items-center gap-2">
                  <input
                    name="confirm"
                    placeholder="DELETE"
                    className="w-24 rounded-2xl border-2 border-red-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-400/10 transition-all duration-200 shadow-sm dark:border-red-500/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <button
                    type="submit"
                    className="rounded-2xl bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all duration-200 hover:bg-red-700 hover:-translate-y-0.5 dark:bg-red-500 dark:hover:bg-red-400"
                  >
                    Confirm
                  </button>
                  <Link href="/dashboard" className="px-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
                    Cancel
                  </Link>
                </form>
              )}

              <Link
                href={`/lb/${lb.slug}`}
                className="rounded-2xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 transition-all duration-200 hover:bg-slate-50 hover:shadow-lg hover:-translate-y-0.5 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800"
              >
                View Leaderboard →
              </Link>
            </div>
          )}
        </div>

        {/* Feedback Messages */}
        {(playerErr || playerOk) && (
          <div
            className={`mb-6 rounded-2xl border-2 px-4 py-3 text-sm shadow-sm ${
              playerErr
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200'
            }`}
          >
            {playerErr ?? playerOk}
          </div>
        )}

        {(clubErr || clubOk) && (
          <div
            className={`mb-6 rounded-2xl border-2 px-4 py-3 text-sm shadow-sm ${
              clubErr
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200'
            }`}
          >
            {clubErr ?? clubOk}
          </div>
        )}

        {lb ? (
          <div className="space-y-3">
            <details
              id="profile"
              open={section === 'profile'}
              className="group rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-slate-50 dark:hover:bg-slate-900/60">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Profile</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Set the name shown on club rosters</p>
                </div>
                <svg
                  className="h-5 w-5 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              <div className="border-t border-slate-100 p-6 dark:border-slate-800">
                <form action={updateProfile} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Username</label>
                    <input
                      name="username"
                      defaultValue={profile?.username ?? ''}
                      required
                      maxLength={24}
                      placeholder="e.g., Retr1"
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">Max 24 characters</div>
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    Save profile
                  </button>
                </form>
              </div>
            </details>
            {/* Settings */}
            <details
              id="settings"
              open={openSettings}
              className="group rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-slate-50 dark:hover:bg-slate-900/60">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Leaderboard Settings</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Name, description, and visibility</p>
                </div>
                <svg
                  className="h-5 w-5 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              <div className="border-t border-slate-100 p-6 dark:border-slate-800">
                <form action={updateLeaderboard} className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Name</label>
                    <input
                      name="name"
                      defaultValue={lb.name}
                      required
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Description</label>
                    <textarea
                      name="description"
                      defaultValue={lb.description ?? ''}
                      rows={2}
                      maxLength={250}
                      placeholder="Optional description for your leaderboard..."
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">Max 250 characters</div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                    <select
                      name="visibility"
                      defaultValue={lb.visibility}
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="PUBLIC">Public - Listed in directory</option>
                      <option value="UNLISTED">Unlisted - Link only</option>
                      <option value="PRIVATE">Private - Owner only</option>
                    </select>
                  </div>

                  <GoalModeFields
                    defaultMode={(lb.goal_mode ?? 'LIVE') as 'LIVE' | 'RACE' | 'LP_GOAL' | 'RANK_GOAL'}
                    defaultLpGoal={lb.lp_goal ?? null}
                    defaultRaceStart={lb.race_start_at ?? null}
                    defaultRaceEnd={lb.race_end_at ?? null}
                    defaultRankGoal={lb.rank_goal_tier ?? null}
                  />

                  <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Share Link</label>
                    <input
                      readOnly
                      value={shareUrl ?? ''}
                      className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    Save Settings
                  </button>
                </form>
              </div>
            </details>

            {/* Banner */}
            <details
              id="banner"
              open={openBanner}
              className="group rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-slate-50 dark:hover:bg-slate-900/60">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Banner Image</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Customize the header background</p>
                </div>
                <svg
                  className="h-5 w-5 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </summary>

              <div className="border-t border-slate-100 p-6 dark:border-slate-800">
                <form action={updateBanner} className="space-y-4">
                  {lb.banner_url ? (
                    <div className="relative mb-4 h-32 w-full overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={lb.banner_url} alt="Banner Preview" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="mb-4 flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                      No banner set
                    </div>
                  )}

                  <div>
                    <input
                      type="file"
                      name="banner"
                      accept="image/png,image/jpeg,image/webp"
                      required
                      className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-2xl file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
                    />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">PNG/JPG/WEBP • Max 4MB • Recommended 1600×400</p>
                  </div>

                  <button
                    type="submit"
                    className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    Upload & Save Banner
                  </button>
                </form>
              </div>
            </details>

            {/* Players */}
            <details
              id="players"
              open={openPlayers}
              className="group rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-slate-50 dark:hover:bg-slate-900/60">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Players</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                    Add and manage up to {MAX_PLAYERS} players
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {playerCount}/{MAX_PLAYERS}
                  </div>
                  <svg
                    className="h-5 w-5 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>

              <div className="border-t border-slate-100 p-6 dark:border-slate-800">
                {/* Add Player Form */}
                <form
                  action={addPlayer}
                  className="mb-6 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-950"
                >
                  <div className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-200">Add New Player</div>

                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        name="riot_id"
                        placeholder="Riot ID (e.g., Doublelift#NA1)"
                        required
                        autoFocus={openPlayers} // helps when you're spamming adds
                        className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                      <select
                        name="role"
                        className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="">Select Role (optional)</option>
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <input
                        name="twitch_url"
                        placeholder="Twitch URL (optional)"
                        className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                      <input
                        name="twitter_url"
                        placeholder="Twitter/X URL (optional)"
                        className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>

                    <AddPlayerButton isAtLimit={playerCount >= MAX_PLAYERS} />

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Tip: after adding, you’ll stay in this section so you can keep adding players fast.
                    </p>
                  </div>
                </form>

                {/* Player List */}
                <div className="space-y-3">
                  {playerCount === 0 ? (
                    <div className="text-center py-12 bg-white rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 dark:bg-slate-900">
                      <p className="text-base font-bold text-slate-500 mb-1 dark:text-slate-300">No players yet</p>
                      <p className="text-sm text-slate-400 dark:text-slate-500">Add your first player above.</p>
                    </div>
                  ) : (
                    players!.map((p, idx) => (
                      <details key={p.id} className="group rounded-2xl border-2 border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
                        <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-900/60">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                              {idx + 1}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 truncate dark:text-slate-100">
                                {p.game_name}#{p.tag_line}
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                {p.role && (
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold dark:bg-slate-800">
                                    {p.role}
                                  </span>
                                )}
                                {p.twitch_url && <span>Twitch</span>}
                                {p.twitter_url && <span>Twitter</span>}
                                {!p.role && !p.twitch_url && !p.twitter_url && (
                                  <span className="text-slate-400 dark:text-slate-500">Click to edit</span>
                                )}
                              </div>
                            </div>
                          </div>
                          <svg
                            className="h-5 w-5 flex-shrink-0 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </summary>

                        <div className="border-t border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                          <form action={updatePlayer} className="space-y-3">
                            <input type="hidden" name="player_id" value={p.id} />

                            <div>
                              <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">Role</label>
                              <select
                                name="role"
                                defaultValue={p.role ?? ''}
                                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                              >
                                <option value="">No Role</option>
                                {ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {role}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">Twitch URL</label>
                              <input
                                name="twitch_url"
                                defaultValue={p.twitch_url ?? ''}
                                placeholder="https://twitch.tv/..."
                                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                              />
                            </div>

                            <div>
                              <label className="mb-1.5 block text-xs font-bold text-slate-700 dark:text-slate-200">Twitter/X URL</label>
                              <input
                                name="twitter_url"
                                defaultValue={p.twitter_url ?? ''}
                                placeholder="https://twitter.com/..."
                                className="w-full rounded-2xl border-2 border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                              />
                            </div>

                            <button
                              type="submit"
                              className="w-full rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                            >
                              Save Changes
                            </button>
                          </form>

                          <form action={removePlayer} className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-800">
                            <input type="hidden" name="player_id" value={p.id} />
                            <button
                              type="submit"
                              className="w-full rounded-2xl border-2 border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 hover:-translate-y-0.5 dark:border-red-500/40 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950/30"
                            >
                              Remove Player
                            </button>
                          </form>
                        </div>
                      </details>
                    ))
                  )}
                </div>
              </div>
            </details>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              Create Your Leaderboard
            </h2>
            <p className="mt-2 text-slate-600 font-medium dark:text-slate-300">
              Get started by creating your first leaderboard (one per account)
            </p>

            <form action={createLeaderboard} className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Leaderboard Name
                </label>
                <input
                  name="name"
                  required
                  placeholder="e.g., NA Climb Squad"
                  className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Create Leaderboard
              </button>
            </form>
          </div>
        )}

        <details
          id="club"
          open={openClub}
          className="group mt-3 rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
        >
          <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-slate-50 dark:hover:bg-slate-900/60">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Create and manage your club profile, members, and attached leaderboards
              </p>
            </div>
            {club ? (
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {clubMembers} members
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {clubLeaderboards} boards
                </div>
                <svg
                  className="h-5 w-5 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            ) : (
              <svg
                className="h-5 w-5 text-slate-400 transition group-open:rotate-180 dark:text-slate-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </summary>

          <div className="border-t border-slate-100 p-6 dark:border-slate-800">
            {club ? (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Club page</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">/clubs/{club.slug}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/clubs/${club.slug}`}
                      className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      Open club →
                    </Link>
                    <Link
                      href="/clubs"
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                    >
                      View directory
                    </Link>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Edit club home</h3>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Update the club name, description, tag, and visibility.</p>
                  </div>
                  <form action={updateClubSettings} className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club name</label>
                      <input
                        name="club_name"
                        defaultValue={club.name}
                        required
                        className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                      <select
                        name="club_visibility"
                        defaultValue={club.visibility ?? 'PUBLIC'}
                        className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="PUBLIC">Public - Listed in directory</option>
                        <option value="UNLISTED">Unlisted - Link only</option>
                        <option value="PRIVATE">Private - Owner only</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club description</label>
                    <textarea
                      name="club_description"
                      defaultValue={club.description ?? ''}
                      rows={3}
                      maxLength={250}
                      placeholder="About this club..."
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">Max 250 characters</div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1">
                        <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
                          Club tag
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            name="club_slug_prefix"
                            defaultValue={clubSlugParts.prefix}
                            maxLength={CLUB_SLUG_PART_MAX}
                            pattern="[A-Za-z0-9]{1,5}"
                            required
                            className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                          <span className="text-lg font-black text-slate-400">-</span>
                          <input
                            name="club_slug_tag"
                            defaultValue={clubSlugParts.tag}
                            maxLength={CLUB_SLUG_PART_MAX}
                            pattern="[A-Za-z0-9]{1,5}"
                            required
                            className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          />
                        </div>
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Two parts, up to {CLUB_SLUG_PART_MAX} letters or numbers each.
                        </p>
                      </div>

                      <div className="sm:w-64">
                        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Share link
                        </label>
                        <input
                          readOnly
                          value={clubShareUrl ?? ''}
                          className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        />
                      </div>
                    </div>
                  </div>

                    <button
                      type="submit"
                      className="w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      Save club settings
                    </button>
                  </form>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">Club banner</h3>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Update the header image shown on the club page.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      Bucket: {CLUB_BANNER_BUCKET}
                    </span>
                  </div>

                  <form action={updateClubBanner} className="mt-4 space-y-4">

                  {club.banner_url ? (
                    <div className="relative h-32 w-full overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={club.banner_url} alt="Club banner preview" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex h-24 items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                      No club banner set
                    </div>
                  )}

                  <div>
                    <input
                      type="file"
                      name="club_banner"
                      accept="image/png,image/jpeg,image/webp"
                      required
                      className="block w-full text-sm text-slate-500 file:mr-4 file:rounded-2xl file:border-0 file:bg-slate-100 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
                    />
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">PNG/JPG/WEBP • Max 4MB • Recommended 1600×400</p>
                  </div>

                    <button
                      type="submit"
                      className="rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      Upload & save banner
                    </button>
                  </form>
                </div>

                <div className="rounded-2xl border border-red-200 bg-red-50 p-5 dark:border-red-500/40 dark:bg-red-950/30">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-base font-bold text-red-800 dark:text-red-200">Delete club</h3>
                      <p className="mt-1 text-sm text-red-700/80 dark:text-red-200/80">
                        This removes the club, its members, and attached leaderboards.
                      </p>
                    </div>
                    {!showClubDeleteConfirm && (
                      <form action={deleteClub}>
                        <button
                          type="submit"
                          className="w-full rounded-2xl border-2 border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-100 hover:-translate-y-0.5 dark:border-red-500/50 dark:bg-slate-950 dark:text-red-300 dark:hover:bg-red-950/40"
                        >
                          Delete club
                        </button>
                      </form>
                    )}
                  </div>

                  {showClubDeleteConfirm && (
                    <form action={deleteClub} className="mt-4 flex flex-wrap items-center gap-3">
                      <input type="hidden" name="club_confirm" value="1" />
                      <button
                        type="submit"
                        className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-red-700"
                      >
                        Confirm delete
                      </button>
                      <Link
                        href={sectionRedirect({ section: 'club' })}
                        className="px-1 text-xs font-semibold text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100"
                      >
                        Cancel
                      </Link>
                    </form>
                  )}
                </div>
              </div>
            ) : (
              <form action={createClub} className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club name</label>
                  <input
                    name="club_name"
                    required
                    placeholder="e.g., NA Scrim Club"
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club description</label>
                  <textarea
                    name="club_description"
                    rows={3}
                    maxLength={250}
                    placeholder="What is this club about?"
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                  <select
                    name="club_visibility"
                    defaultValue="PUBLIC"
                    className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="PUBLIC">Public - Listed in directory</option>
                    <option value="UNLISTED">Unlisted - Link only</option>
                    <option value="PRIVATE">Private - Owner only</option>
                  </select>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                  <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club tag</label>
                  <div className="flex items-center gap-2">
                    <input
                      name="club_slug_prefix"
                      defaultValue={clubSlugParts.prefix}
                      maxLength={CLUB_SLUG_PART_MAX}
                      pattern="[A-Za-z0-9]{1,5}"
                      required
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                    <span className="text-lg font-black text-slate-400">-</span>
                    <input
                      name="club_slug_tag"
                      defaultValue={clubSlugParts.tag}
                      maxLength={CLUB_SLUG_PART_MAX}
                      pattern="[A-Za-z0-9]{1,5}"
                      required
                      className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Two parts, up to {CLUB_SLUG_PART_MAX} letters or numbers each.
                  </p>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-2xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  Create club
                </button>
              </form>
            )}
          </div>
        </details>
      </div>
    </main>
  )
}
