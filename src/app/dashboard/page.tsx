import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePuuid } from '@/lib/riot/resolvePuuid'
import { buildClubSlug, CLUB_SLUG_PART_MAX, normalizeSlugPart, parseClubSlug, validateSlugPart } from '@/lib/clubSlug'
import { AddPlayerButton } from './AddPlayerButton'
import GoalModeFields from './GoalModeFields'
import BannerUploadField from './BannerUploadField'

// --- Constants & Types ---
const VISIBILITY = ['PUBLIC', 'UNLISTED', 'PRIVATE'] as const
type Visibility = (typeof VISIBILITY)[number]

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUP'] as const
const MAX_PLAYERS = 30
const CLUB_BANNER_BUCKET = 'leaderboard-banners'
const BASE_LEADERBOARD_SLOTS = 1
const CLUB_MEMBER_LIMIT = 3

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

function generateClubTagParts(name: string) {
  const cleaned = slugify(name).replace(/-/g, '').replace(/[^a-z0-9]/g, '')
  const seed = cleaned || Math.random().toString(36).slice(2, 8)
  const prefixLen = Math.min(5, Math.max(1, Math.ceil(seed.length / 2)))
  const prefix = seed.slice(0, prefixLen)
  const tag = seed.slice(prefixLen, prefixLen + 5) || seed.slice(0, Math.min(5, seed.length))
  return { prefix, tag }
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
  section: 'settings' | 'banner' | 'players' | 'club' | 'profile' | 'billing' | 'top'
  ok?: string
  err?: string
  clubOk?: string
  clubErr?: string
  billingOk?: string
  billingErr?: string
  deleteConfirm?: boolean
  clubDeleteConfirm?: boolean
  leaderboardId?: string
}) {
  const params = new URLSearchParams()
  if (opts.ok) params.set('player_ok', opts.ok)
  if (opts.err) params.set('player_err', opts.err)
  if (opts.deleteConfirm) params.set('delete_confirm', '1')
  if (opts.clubOk) params.set('club_ok', opts.clubOk)
  if (opts.clubErr) params.set('club_err', opts.clubErr)
  if (opts.billingOk) params.set('billing_ok', opts.billingOk)
  if (opts.billingErr) params.set('billing_err', opts.billingErr)
  if (opts.clubDeleteConfirm) params.set('club_delete_confirm', '1')
  if (opts.leaderboardId) params.set('lb', opts.leaderboardId)
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
    | {
        player_err?: string
        player_ok?: string
        delete_confirm?: string
        club_err?: string
        club_ok?: string
        club_delete_confirm?: string
        billing_err?: string
        billing_ok?: string
        section?: string
        lb?: string
      }
    | Promise<{
        player_err?: string
        player_ok?: string
        delete_confirm?: string
        club_err?: string
        club_ok?: string
        club_delete_confirm?: string
        billing_err?: string
        billing_ok?: string
        section?: string
        lb?: string
      }>
}) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  const sp = await Promise.resolve(searchParams ?? {})
  const playerErr = sp.player_err ? normalizePlayerError(decodeURIComponent(sp.player_err)) : null
  const playerOk = sp.player_ok ? decodeURIComponent(sp.player_ok) : null
  const deleteForId = sp.lb ? decodeURIComponent(sp.lb) : null
  const showDeleteConfirm = sp.delete_confirm === '1'
  const clubErr = sp.club_err ? decodeURIComponent(sp.club_err) : null
  const clubOk = sp.club_ok ? decodeURIComponent(sp.club_ok) : null
  const showClubDeleteConfirm = sp.club_delete_confirm === '1'
  const section = (sp.section ?? 'top').toString()
  const billingErr = sp.billing_err ? decodeURIComponent(sp.billing_err) : null
  const billingOk = sp.billing_ok ? decodeURIComponent(sp.billing_ok) : null
  const sectionValues = ['profile', 'settings', 'banner', 'players', 'club', 'billing'] as const
  type DashboardSection = (typeof sectionValues)[number]
  const activeSection: DashboardSection = (sectionValues as readonly string[]).includes(section) ? (section as DashboardSection) : 'profile'
  const effectiveSection: DashboardSection = activeSection === 'banner' || activeSection === 'players' ? 'settings' : activeSection
  const activeLeaderboardId = sp.lb ? decodeURIComponent(sp.lb) : null

  // Fetch Leaderboards
  const { data: leaderboardsRaw } = await supabase
    .from('leaderboards')
    .select('id, name, slug, visibility, description, banner_url, goal_mode, race_start_at, race_end_at, lp_goal, rank_goal_tier, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })

  const leaderboards = (leaderboardsRaw ?? []) as Array<{
    id: string
    name: string
    slug: string
    visibility: string | null
    description: string | null
    banner_url: string | null
    goal_mode: string | null
    race_start_at: string | null
    race_end_at: string | null
    lp_goal: number | null
    rank_goal_tier: string | null
    updated_at: string | null
  }>
  const lb = leaderboards.find((item) => item.id === activeLeaderboardId) ?? leaderboards[0] ?? null

  // Fetch Players (if leaderboard exists)
  const { data: players } = lb
    ? await supabase
        .from('leaderboard_players')
        .select('id, role, game_name, tag_line, puuid, twitch_url, twitter_url, created_at')
        .eq('leaderboard_id', lb.id)
        .order('created_at', { ascending: true })
    : { data: null }

  const { count: totalPlayerCount } = await supabase
    .from('leaderboard_players')
    .select('id', { count: 'exact', head: true })
    .in(
      'leaderboard_id',
      leaderboards.length > 0 ? leaderboards.map((board) => board.id) : ['__none__']
    )

  const [{ data: clubRaw }, { data: profileRaw }, { data: clubMembershipsRaw }] = await Promise.all([
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
    supabase
      .from('club_members')
      .select('club:clubs!club_members_club_id_fkey(id, name, slug, description, banner_url, visibility, updated_at, owner_user_id)')
      .eq('user_id', user.id),
  ])

  const club = (clubRaw ?? null) as ClubRow | null
  const profile = (profileRaw ?? null) as { user_id: string; username: string; updated_at: string | null } | null
  const memberClubs = (clubMembershipsRaw ?? [])
    .flatMap((row) => row.club ?? [])
    .filter(Boolean) as ClubRow[]

  const [{ count: clubMemberCount }, { count: clubLeaderboardCount }] = club
    ? await Promise.all([
        supabase.from('club_members').select('id', { count: 'exact', head: true }).eq('club_id', club.id),
        supabase.from('club_leaderboards').select('id', { count: 'exact', head: true }).eq('club_id', club.id),
      ])
    : [{ count: 0 }, { count: 0 }]

  const { data: entitlementRaw } = await supabase
    .from('user_entitlements')
    .select('extra_leaderboard_slots, subscription_slots')
    .eq('user_id', user.id)
    .maybeSingle()

  // --- Server Actions ---

  async function createLeaderboard(formData: FormData) {
    'use server'

    const name = String(formData.get('name') ?? '').trim()
    if (!name) return

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: existingList } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
    const ownedCount = existingList?.length ?? 0

    const { data: entitlement } = await supabase
      .from('user_entitlements')
      .select('extra_leaderboard_slots, subscription_slots')
      .eq('user_id', user.id)
      .maybeSingle()

    const extraSlots = entitlement?.extra_leaderboard_slots ?? 0
    const subscriptionSlots = entitlement?.subscription_slots ?? 0
    const allowedSlots = BASE_LEADERBOARD_SLOTS + extraSlots + subscriptionSlots

    if (ownedCount >= allowedSlots) {
      redirect(sectionRedirect({ section: 'billing', billingErr: 'Leaderboard limit reached. Purchase more slots to add another.' }))
    }

    const base = slugify(name)
    const slug = `${base}-${Math.random().toString(36).slice(2, 7)}`

    const { data: inserted, error } = await supabase
      .from('leaderboards')
      .insert({
        user_id: user.id,
        name,
        slug,
        visibility: 'PUBLIC',
      })
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('createLeaderboard insert error', {
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      })
      redirect(sectionRedirect({ section: 'top', err: 'Failed to create leaderboard' }))
    }
    redirect(sectionRedirect({ section: 'settings', ok: 'Leaderboard created', leaderboardId: inserted?.id }))
  }

  async function updateLeaderboard(formData: FormData) {
    'use server'

    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
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
      .eq('id', leaderboardId)
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

    redirect(sectionRedirect({ section: 'settings', ok: 'Settings updated', leaderboardId }))
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

    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
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
      .eq('id', leaderboardId)
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

    redirect(sectionRedirect({ section: 'banner', ok: 'Banner updated successfully', leaderboardId }))
  }

  async function addPlayer(formData: FormData) {
    'use server'

    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
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
      .eq('id', leaderboardId)
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
    redirect(sectionRedirect({ section: 'players', ok: `Added ${gameName}#${tagLine}`, leaderboardId }))
  }

  async function updatePlayer(formData: FormData) {
    'use server'

    const playerId = String(formData.get('player_id') ?? '').trim()
    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
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
      .eq('id', leaderboardId)
      .maybeSingle()

    if (!lb) redirect('/dashboard')

    const { error } = await supabase
      .from('leaderboard_players')
      .update({ role, twitch_url: twitchUrl, twitter_url: twitterUrl })
      .eq('id', playerId)
      .eq('leaderboard_id', lb.id)

    if (error) redirect(sectionRedirect({ section: 'players', err: error.message }))

    redirect(sectionRedirect({ section: 'players', ok: 'Player updated', leaderboardId }))
  }

  async function removePlayer(formData: FormData) {
    'use server'

    const playerId = String(formData.get('player_id') ?? '').trim()
    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
    if (!playerId) redirect('/dashboard')

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', leaderboardId)
      .maybeSingle()

    if (!lb) redirect('/dashboard')

    const { error } = await supabase.from('leaderboard_players').delete().eq('id', playerId).eq('leaderboard_id', lb.id)

    if (error) redirect(sectionRedirect({ section: 'players', err: error.message }))

    redirect(sectionRedirect({ section: 'players', ok: 'Player removed', leaderboardId }))
  }

  async function armDeleteLeaderboard(formData: FormData) {
    'use server'

    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    if (!leaderboardId) {
      redirect(sectionRedirect({ section: 'top', err: 'Missing leaderboard' }))
    }

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', leaderboardId)
      .maybeSingle()
    if (!lb) redirect(sectionRedirect({ section: 'top', err: 'No leaderboard to delete' }))

    redirect(sectionRedirect({ section: 'settings', deleteConfirm: true, leaderboardId }))
  }

  async function deleteLeaderboard(formData: FormData) {
    'use server'

    const confirm = String(formData.get('confirm') ?? '').trim()
    const leaderboardId = String(formData.get('leaderboard_id') ?? '').trim()
    if (confirm !== 'DELETE') {
      redirect(sectionRedirect({ section: 'settings', err: 'Type DELETE to confirm deletion', deleteConfirm: true, leaderboardId }))
    }

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: lb } = await supabase
      .from('leaderboards')
      .select('id')
      .eq('user_id', user.id)
      .eq('id', leaderboardId)
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
    const quickCreate = String(formData.get('quick_create') ?? '') === '1'
    let visibilityRaw = String(formData.get('club_visibility') ?? '').trim()
    let prefixRaw = String(formData.get('club_slug_prefix') ?? '').trim()
    let tagRaw = String(formData.get('club_slug_tag') ?? '').trim()

    if (quickCreate) {
      const generated = generateClubTagParts(name)
      prefixRaw = generated.prefix
      tagRaw = generated.tag
      visibilityRaw = 'PUBLIC'
    }

    if (!quickCreate && (!prefixRaw || !tagRaw)) {
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

    const { count: membershipCount } = await supabase
      .from('club_members')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if ((membershipCount ?? 0) >= CLUB_MEMBER_LIMIT) {
      redirect(sectionRedirect({ section: 'club', clubErr: `Club membership limit reached (${CLUB_MEMBER_LIMIT} max).` }))
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

  async function startStripeCheckoutOneTime() {
    'use server'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://cwf.lol'}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'payment' }),
      cache: 'no-store',
    })

    if (!response.ok) {
      redirect(sectionRedirect({ section: 'billing', billingErr: 'Unable to start checkout.' }))
    }

    const data = (await response.json()) as { url?: string }
    if (!data.url) {
      redirect(sectionRedirect({ section: 'billing', billingErr: 'Unable to start checkout.' }))
    }

    redirect(data.url)
  }

  async function startStripeCheckoutSubscription() {
    'use server'

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://cwf.lol'}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'subscription' }),
      cache: 'no-store',
    })

    if (!response.ok) {
      redirect(sectionRedirect({ section: 'billing', billingErr: 'Unable to start checkout.' }))
    }

    const data = (await response.json()) as { url?: string }
    if (!data.url) {
      redirect(sectionRedirect({ section: 'billing', billingErr: 'Unable to start checkout.' }))
    }

    redirect(data.url)
  }

  // --- JSX Render ---
  const shareUrl = lb ? `https://cwf.lol/lb/${lb.slug}` : null
  const playerCount = players?.length ?? 0
  const clubSlugParts = parseClubSlug(club?.slug)
  const clubShareUrl = club ? `https://cwf.lol/clubs/${club.slug}` : null
  const clubMembers = clubMemberCount ?? 0
  const clubLeaderboards = clubLeaderboardCount ?? 0
  const hasBanner = Boolean(lb?.banner_url)
  const hasClubBanner = Boolean(club?.banner_url)
  const openGoalSettings = lb?.goal_mode && lb.goal_mode !== 'LIVE'
  const userLeaderboardCount = leaderboards.length
  const { count: clubMembershipCount } = await supabase
    .from('club_members')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
  const extraLeaderboardSlots = entitlementRaw?.extra_leaderboard_slots ?? 0
  const subscriptionSlots = entitlementRaw?.subscription_slots ?? 0
  const allowedLeaderboards = BASE_LEADERBOARD_SLOTS + extraLeaderboardSlots + subscriptionSlots
  const remainingLeaderboardSlots = Math.max(allowedLeaderboards - userLeaderboardCount, 0)
  const atLeaderboardLimit = userLeaderboardCount >= allowedLeaderboards
  const atClubMembershipLimit = (clubMembershipCount ?? 0) >= CLUB_MEMBER_LIMIT
  const playerErrMessage = playerErr
  const goalModeLabel = lb
    ? (
        {
          LIVE: 'Live ladder',
          RACE: 'Race window',
          LP_GOAL: 'LP goal',
          RANK_GOAL: 'Rank goal',
        } as Record<string, string>
      )[lb.goal_mode ?? 'LIVE'] ?? 'Live ladder'
    : null

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-10 lg:py-16">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-6 lg:mb-10 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400 lg:text-5xl">
              Dashboard
            </h1>
            <p className="text-base font-medium text-slate-600 dark:text-slate-300">
              Manage your leaderboard, players, and club details from one place.
            </p>
          </div>

          {lb && null}
        </div>

        {lb && (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-none border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur transition-all duration-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800/80 dark:bg-slate-900/80">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leaderboards used</p>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {userLeaderboardCount}/{allowedLeaderboards}
              </p>
            </div>
            <div className="rounded-none border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur transition-all duration-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800/80 dark:bg-slate-900/80">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Clubs joined</p>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {clubMembershipCount ?? 0}/{CLUB_MEMBER_LIMIT}
              </p>
            </div>
            <div className="rounded-none border border-slate-200/80 bg-white/90 p-4 shadow-sm backdrop-blur transition-all duration-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800/80 dark:bg-slate-900/80">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total players</p>
              <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
                {totalPlayerCount ?? 0}
              </p>
            </div>
          </div>
        )}

        {/* Feedback Messages */}
        {(playerErrMessage || playerOk) && (
          <div
            className={`mb-6 rounded-none border-2 px-4 py-3 text-sm shadow-sm ${
              playerErrMessage
              ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200'
            }`}
          >
            {playerErrMessage ?? playerOk}
          </div>
        )}

        {(clubErr || clubOk || billingErr || billingOk) && (
          <div
            className={`mb-6 rounded-none border-2 px-4 py-3 text-sm shadow-sm ${
              clubErr || billingErr
                ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/30 dark:text-emerald-200'
            }`}
          >
            {clubErr ?? billingErr ?? clubOk ?? billingOk}
          </div>
        )}

        {lb ? (
          <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
            <aside className="space-y-4 lg:sticky lg:top-6">
              <div className="rounded-none border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Profile</div>
                <Link
                  href={sectionRedirect({ section: 'profile', leaderboardId: lb?.id })}
                  scroll={false}
                  className={`mt-3 flex items-center justify-between rounded-none px-3 py-2 text-sm font-semibold transition-all duration-200 ease-out ${
                    effectiveSection === 'profile'
                      ? 'bg-slate-900 text-white shadow-sm ring-1 ring-slate-900/20 dark:bg-white dark:text-slate-900 dark:ring-white/20'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-sm dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>Profile settings</span>
                  <span className="text-xs opacity-70 transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
              <div className="rounded-none border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leaderboards</div>
                <div className="mt-3">
                  {leaderboards.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No leaderboards yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {leaderboards.map((board) => {
                        const isActive = lb?.id === board.id
                        return (
                          <Link
                            key={board.id}
                            href={sectionRedirect({ section: 'settings', leaderboardId: board.id })}
                            scroll={false}
                            className={`group relative aspect-[4/3] overflow-hidden rounded-xl border transition-all duration-200 ease-out ${
                              isActive
                                ? 'border-slate-900 ring-2 ring-slate-900/30 dark:border-white dark:ring-white/40'
                                : 'border-slate-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:hover:border-slate-600'
                            }`}
                            aria-label={`Select ${board.name}`}
                          >
                            {board.banner_url ? (
                              <div
                                className="absolute inset-0 bg-cover bg-center"
                                style={{ backgroundImage: `url(${board.banner_url})` }}
                              />
                            ) : (
                              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 dark:from-slate-200 dark:via-slate-300 dark:to-slate-100" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent dark:from-slate-900/60" />
                            <div className="relative flex h-full flex-col justify-end p-3 text-white">
                              <div className="text-sm font-semibold leading-tight drop-shadow-sm">
                                {board.name}
                              </div>
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                                {isActive ? 'Selected' : 'Select'}
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
                <form action={createLeaderboard} className="mt-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      name="name"
                      placeholder="Leaderboard name"
                      className="min-w-0 h-10 flex-1 rounded-none border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-900"
                      disabled={atLeaderboardLimit}
                    />
                    <button
                      type="submit"
                      className="h-10 w-10 rounded-none border border-slate-200 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                      aria-label="Create new leaderboard"
                      disabled={atLeaderboardLimit}
                    >
                      →
                    </button>
                  </div>
                  {atLeaderboardLimit ? (
                    <div className="rounded-none border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                      Limit reached. Upgrade to add more leaderboards.
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {remainingLeaderboardSlots} slots remaining.
                    </div>
                  )}
                </form>
                <div className="mt-6">
                  {memberClubs.length > 0 && (
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Clubs</div>
                  )}
                  {memberClubs.length > 0 && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {memberClubs.map((clubItem) => {
                        const isSelected = club?.id === clubItem.id
                        return (
                          <Link
                            key={clubItem.id}
                            href={sectionRedirect({ section: 'club', leaderboardId: lb?.id })}
                            className={`group relative aspect-[4/3] overflow-hidden rounded-xl border transition-all duration-200 ease-out ${
                              isSelected
                                ? 'border-slate-900 ring-2 ring-slate-900/30 dark:border-white dark:ring-white/40'
                                : 'border-slate-200 hover:border-slate-300 hover:shadow-md dark:border-slate-800 dark:hover:border-slate-600'
                            }`}
                            aria-label={`Open ${clubItem.name}`}
                          >
                            {clubItem.banner_url ? (
                              <div
                                className="absolute inset-0 bg-cover bg-center"
                                style={{ backgroundImage: `url(${clubItem.banner_url})` }}
                              />
                            ) : (
                              <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-700 to-slate-500 dark:from-slate-200 dark:via-slate-300 dark:to-slate-100" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent dark:from-slate-900/60" />
                            <div className="relative flex h-full flex-col justify-end p-3 text-white">
                              <div className="text-sm font-semibold leading-tight drop-shadow-sm">
                                {clubItem.name}
                              </div>
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-white/70">
                                {isSelected ? 'Owned' : 'Open'}
                              </div>
                            </div>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                  <div className="mt-3">
                    <form action={createClub} className="space-y-2">
                      <input type="hidden" name="quick_create" value="1" />
                      <div className="flex items-center gap-2">
                        <input
                          name="club_name"
                          placeholder="Club name"
                          className="min-w-0 h-10 flex-1 rounded-none border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:disabled:bg-slate-900"
                          disabled={atClubMembershipLimit}
                        />
                        <button
                          type="submit"
                          className="h-10 w-10 rounded-none border border-slate-200 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                          aria-label="Create club"
                          disabled={atClubMembershipLimit}
                        >
                          →
                        </button>
                      </div>
                    </form>
                    {atClubMembershipLimit ? (
                      <div className="mt-2 rounded-none border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-400">
                        Limit reached. Please leave a club.
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Up to {CLUB_MEMBER_LIMIT} clubs total.
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-none border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Billing</div>
                <Link
                  href={sectionRedirect({ section: 'billing', leaderboardId: lb?.id })}
                  scroll={false}
                  className={`mt-3 flex items-center justify-between rounded-none px-3 py-2 text-sm font-semibold transition-all duration-200 ease-out ${
                    effectiveSection === 'billing'
                      ? 'bg-slate-900 text-white shadow-sm ring-1 ring-slate-900/20 dark:bg-white dark:text-slate-900 dark:ring-white/20'
                      : 'bg-slate-50 text-slate-700 hover:bg-slate-100 hover:shadow-sm dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>Billing settings</span>
                  <span className="text-xs opacity-70 transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </Link>
              </div>
            </aside>

            <div className="min-w-0 space-y-8">
              {effectiveSection === 'profile' && (
              <section id="profile" className="scroll-mt-24">
                <div className="mx-auto max-w-2xl overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                  <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Profile</h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Set the name shown on club rosters</p>
                  </div>
                  <div className="p-6">
                    <form action={updateProfile} className="space-y-4">
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Username</label>
                          <input
                            name="username"
                            defaultValue={profile?.username ?? ''}
                            required
                            maxLength={24}
                            placeholder="e.g., Retr1"
                            className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                        <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">Max 24 characters</div>
                      </div>

                      <button
                        type="submit"
                        className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                      >
                        Save profile
                      </button>
                    </form>
                  </div>
                </div>
              </section>
              )}

              {effectiveSection === 'settings' && (
              <section id="settings" className="scroll-mt-24">
                <div className="mx-auto max-w-3xl overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                  <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Leaderboard settings</h2>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Name, description, and visibility</p>
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <form key={lb.id} action={updateLeaderboard} className="space-y-6">
                      <input type="hidden" name="leaderboard_id" value={lb.id} />
                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Name</label>
                        <input
                          name="name"
                          defaultValue={lb.name}
                          required
                          className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
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
                          className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                        />
                        <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">Max 250 characters</div>
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                        <select
                          name="visibility"
                          defaultValue={lb.visibility ?? 'PUBLIC'}
                          className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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

                      <button
                        type="submit"
                        className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                      >
                        Save Settings
                      </button>
                    </form>
                    <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                      {!showDeleteConfirm || deleteForId !== lb?.id ? (
                        <Link
                          href={sectionRedirect({ section: 'settings', deleteConfirm: true, leaderboardId: lb?.id })}
                          scroll={false}
                          className="rounded-none border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
                          title="Delete leaderboard"
                        >
                          Delete
                        </Link>
                      ) : (
                        <form action={deleteLeaderboard} className="flex items-center gap-2">
                          <input type="hidden" name="leaderboard_id" value={lb?.id ?? ''} />
                          <input
                            name="confirm"
                            placeholder="DELETE"
                            className="w-24 rounded-none border border-red-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-400/10 transition-all duration-200 shadow-sm dark:border-red-500/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                          <button
                            type="submit"
                            className="rounded-none bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all duration-200 hover:bg-red-700 hover:-translate-y-0.5 dark:bg-red-500 dark:hover:bg-red-400"
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
                        className="rounded-none bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 transition-all duration-200 hover:bg-slate-50 hover:shadow-lg hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800"
                      >
                        View Leaderboard →
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="mt-8 space-y-8">
                  <div id="banner" className="scroll-mt-24 overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                    <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Leaderboard banner</h2>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Customize the header background</p>
                        </div>
                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {hasBanner ? 'Banner set' : 'No banner'}
                        </div>
                      </div>
                    </div>
                    <div className="p-6">
                      <form action={updateBanner} className="space-y-4">
                        <input type="hidden" name="leaderboard_id" value={lb.id} />
                        <BannerUploadField
                          name="banner"
                          previewUrl={lb.banner_url}
                          placeholder="No banner set"
                          helperText="PNG/JPG/WEBP • Max 4MB • Recommended 1600×400"
                        />

                        <button
                          type="submit"
                          className="rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                          Upload & Save Banner
                        </button>
                      </form>
                    </div>
                  </div>

                  <div id="players" className="scroll-mt-24 overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                    <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Players</h2>
                          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Add and manage up to {MAX_PLAYERS} players</p>
                        </div>
                        <div className="rounded-none bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {playerCount}/{MAX_PLAYERS}
                        </div>
                      </div>
                    </div>
                    <div className="p-6 space-y-6">
                      <form action={addPlayer}>
                        <input type="hidden" name="leaderboard_id" value={lb.id} />
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Add player</div>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {playerCount}/{MAX_PLAYERS}
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <input
                              name="riot_id"
                              placeholder="Riot ID (gameName#tagLine)"
                              required
                              autoFocus={section === 'players'}
                              className="w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                            />
                            <select
                              name="role"
                              className="w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            >
                              <option value="">Role (optional)</option>
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
                              className="w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                            />
                            <input
                              name="twitter_url"
                              placeholder="Twitter/X URL (optional)"
                              className="w-full rounded-none border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                            />
                          </div>

                          <AddPlayerButton isAtLimit={playerCount >= MAX_PLAYERS} />

                        </div>
                      </form>

                      <div className="rounded-none border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                        {playerCount === 0 ? (
                          <div className="p-10 text-center">
                            <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">No players yet</p>
                            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Add your first player above.</p>
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-200/80 dark:divide-slate-800">
                            <div className="hidden sm:grid grid-cols-[56px_2.4fr_90px_120px_90px] items-center gap-3 px-6 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              <span>#</span>
                              <span>Riot ID</span>
                              <span>Role</span>
                              <span>Socials</span>
                              <span className="text-right">Actions</span>
                            </div>
                            {players!.map((p, index) => {
                              const editId = `player-edit-${p.id}`
                              return (
                                <details key={p.id} className="group">
                                  <summary className="grid cursor-pointer grid-cols-[56px_2.4fr_90px_120px_90px] items-center gap-3 px-6 py-5 text-base text-slate-900 list-none dark:text-slate-100">
                                    <span className="text-slate-500 dark:text-slate-400">{index + 1}</span>
                                    <span className="truncate font-semibold text-slate-900 dark:text-slate-50">{p.game_name}#{p.tag_line}</span>
                                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                      {p.role ?? '—'}
                                    </span>
                                      <span className="text-sm text-slate-500 dark:text-slate-400">
                                        {p.twitch_url || p.twitter_url ? (
                                          <span className="flex items-center gap-2">
                                            {p.twitch_url ? (
                                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-none bg-purple-500/10 text-purple-500 dark:bg-purple-500/20">
                                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                                                  <path
                                                    fill="currentColor"
                                                    d="M4.5 3h15v9.75l-4.5 4.5h-4.5l-2.5 2.5H6v-2.5H4.5V3zm13.5 9V4.5h-12v10h3v2.5l2.5-2.5h5L18 12zM9 7.5h1.5v4H9v-4zm4.5 0H15v4h-1.5v-4z"
                                                  />
                                                </svg>
                                              </span>
                                            ) : null}
                                            {p.twitter_url ? (
                                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-none bg-sky-500/10 text-sky-500 dark:bg-sky-500/20">
                                                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                                                  <path
                                                    fill="currentColor"
                                                    d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.9-6.5L5.7 22H2.6l7.3-8.3L1 2h6.4l4.4 6L18.9 2zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20z"
                                                  />
                                                </svg>
                                              </span>
                                            ) : null}
                                          </span>
                                        ) : (
                                          '—'
                                        )}
                                      </span>
                                    <span className="text-right text-sm font-semibold text-slate-700 dark:text-slate-200">Edit</span>
                                  </summary>
                                  <div className="border-t border-slate-100 bg-slate-50 px-6 py-5 dark:border-slate-800 dark:bg-slate-900/60">
                                    <form id={editId} action={updatePlayer} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr] sm:items-end">
                                      <input type="hidden" name="leaderboard_id" value={lb.id} />
                                      <input type="hidden" name="player_id" value={p.id} />
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Role</label>
                                          <select
                                            name="role"
                                            defaultValue={p.role ?? ''}
                                            className="h-10 w-full rounded-none border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                          >
                                          <option value="">No role</option>
                                          {ROLES.map((role) => (
                                            <option key={role} value={role}>
                                              {role}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Twitch URL</label>
                                          <input
                                            name="twitch_url"
                                            defaultValue={p.twitch_url ?? ''}
                                            placeholder="https://twitch.tv/..."
                                            className="h-10 w-full rounded-none border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                                          />
                                      </div>
                                      <div>
                                        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">Twitter/X URL</label>
                                          <input
                                            name="twitter_url"
                                            defaultValue={p.twitter_url ?? ''}
                                            placeholder="https://twitter.com/..."
                                            className="h-10 w-full rounded-none border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                                          />
                                      </div>
                                    </form>
                                    <div className="mt-4 flex flex-wrap items-center justify-end gap-4">
                                      <form action={removePlayer}>
                                        <input type="hidden" name="leaderboard_id" value={lb.id} />
                                        <input type="hidden" name="player_id" value={p.id} />
                                        <button
                                          type="submit"
                                          className="text-sm font-semibold text-red-600 hover:text-red-700"
                                        >
                                          Remove
                                        </button>
                                      </form>
                                      <button
                                        type="submit"
                                        form={editId}
                                        className="rounded-none bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                                      >
                                        Save changes
                                      </button>
                                    </div>
                                  </div>
                                </details>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
              )}

              {effectiveSection === 'club' && (
              <section id="club" className="scroll-mt-24">
                {club ? (
                  <div className="space-y-8">
                    <div className="mx-auto max-w-3xl overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                      <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club settings</h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Name, description, visibility, and tag</p>
                          </div>
                        </div>
                      </div>
                      <div className="p-6 space-y-6">
                        <form action={updateClubSettings} className="space-y-6">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club name</label>
                              <input
                                name="club_name"
                                defaultValue={club.name}
                                required
                                className="h-12 w-full rounded-none border-2 border-slate-200 bg-white px-4 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                              />
                            </div>

                            <div>
                              <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                              <select
                                name="club_visibility"
                                defaultValue={club.visibility ?? 'PUBLIC'}
                                className="h-12 w-full rounded-none border-2 border-slate-200 bg-white px-4 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
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
                              className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                            />
                            <div className="mt-1 text-right text-xs text-slate-400 dark:text-slate-500">Max 250 characters</div>
                          </div>

                          <div>
                            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
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
                                    className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                  />
                                  <span className="text-lg font-black text-slate-400">-</span>
                                  <input
                                    name="club_slug_tag"
                                    defaultValue={clubSlugParts.tag}
                                    maxLength={CLUB_SLUG_PART_MAX}
                                    pattern="[A-Za-z0-9]{1,5}"
                                    required
                                    className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                                  />
                                </div>
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                  Two parts, up to {CLUB_SLUG_PART_MAX} letters or numbers each.
                                </p>
                              </div>
                            </div>
                          </div>

                          <button
                            type="submit"
                            className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                          >
                            Save club settings
                          </button>
                        </form>
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          {!showClubDeleteConfirm ? (
                            <Link
                              href={sectionRedirect({ section: 'club', clubDeleteConfirm: true })}
                              scroll={false}
                              className="rounded-none border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/40 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
                            >
                              Delete
                            </Link>
                          ) : (
                            <form action={deleteClub} className="flex items-center gap-2">
                              <input type="hidden" name="club_confirm" value="1" />
                              <button
                                type="submit"
                                className="rounded-none bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-red-700"
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

                          <Link
                            href={`/clubs/${club.slug}`}
                            className="rounded-none bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 transition-all duration-200 hover:bg-slate-50 hover:shadow-lg hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/40 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800"
                          >
                            View Club →
                          </Link>
                        </div>
                      </div>
                    </div>

                    <div className="mx-auto max-w-3xl overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                      <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club banner</h2>
                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Customize the header background</p>
                          </div>
                          <span className="rounded-none bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {hasClubBanner ? 'Banner set' : 'No banner'}
                          </span>
                        </div>
                      </div>
                      <div className="p-6">
                        <form action={updateClubBanner} className="space-y-4">
                          <BannerUploadField
                            name="club_banner"
                            previewUrl={club.banner_url}
                            placeholder="No club banner set"
                            helperText="PNG/JPG/WEBP • Max 4MB • Recommended 1600×400"
                          />

                          <button
                            type="submit"
                            className="rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                          >
                            Upload & save banner
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                    <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club settings</h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create your club profile.</p>
                    </div>
                    <div className="p-6">
                      <form action={createClub} className="space-y-4">
                        {atClubMembershipLimit && (
                          <div className="rounded-none border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                            You’ve reached the max of {CLUB_MEMBER_LIMIT} club memberships. Leave a club to create a new one.
                          </div>
                        )}
                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club name</label>
                          <input
                            name="club_name"
                            required
                            placeholder="e.g., NA Scrim Club"
                            className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club description</label>
                          <textarea
                            name="club_description"
                            rows={3}
                            maxLength={250}
                            placeholder="What is this club about?"
                            className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                          />
                        </div>

                        <div>
                          <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                          <select
                            name="club_visibility"
                            defaultValue="PUBLIC"
                            className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                          >
                            <option value="PUBLIC">Public - Listed in directory</option>
                            <option value="UNLISTED">Unlisted - Link only</option>
                            <option value="PRIVATE">Private - Owner only</option>
                          </select>
                        </div>

                        <div className="rounded-none border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                          <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club tag</label>
                          <div className="flex items-center gap-2">
                            <input
                              name="club_slug_prefix"
                              defaultValue={clubSlugParts.prefix}
                              maxLength={CLUB_SLUG_PART_MAX}
                              pattern="[A-Za-z0-9]{1,5}"
                              required
                              className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                            <span className="text-lg font-black text-slate-400">-</span>
                            <input
                              name="club_slug_tag"
                              defaultValue={clubSlugParts.tag}
                              maxLength={CLUB_SLUG_PART_MAX}
                              pattern="[A-Za-z0-9]{1,5}"
                              required
                              className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                            />
                          </div>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            Two parts, up to {CLUB_SLUG_PART_MAX} letters or numbers each.
                          </p>
                        </div>

                        <button
                          type="submit"
                          disabled={atClubMembershipLimit}
                          className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                          Create club
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </section>
              )}

              {effectiveSection === 'billing' && (
              <section id="billing" className="scroll-mt-24">
                <div className="mx-auto max-w-3xl overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
                  <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Billing</h2>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Purchase extra leaderboard slots.</p>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Included leaderboards: {BASE_LEADERBOARD_SLOTS}</span>
                        <span>Extra slots: {extraLeaderboardSlots}</span>
                        <span>Subscription slots: {subscriptionSlots}</span>
                        <span>Total: {allowedLeaderboards}</span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {remainingLeaderboardSlots} slot(s) available.
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <form action={startStripeCheckoutOneTime}>
                        <button
                          type="submit"
                          className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                          Buy 1 extra slot ($4.99)
                        </button>
                      </form>
                      <form action={startStripeCheckoutSubscription}>
                        <button
                          type="submit"
                          className="w-full rounded-none border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                        >
                          Subscribe for more slots
                        </button>
                      </form>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Billing is in beta. Subscription management UI coming soon.
                    </p>
                  </div>
                </div>
              </section>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-none border border-slate-200/80 bg-white p-8 shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
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
                  className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>

              <button
                type="submit"
                className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Create Leaderboard
              </button>
            </form>
          </div>
        )}

        {!lb && (
          <section id="club" className="mt-8 scroll-mt-24">
            <div className="overflow-hidden rounded-none border border-slate-200/80 bg-white shadow-sm dark:border-slate-800/80 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-6 dark:border-slate-800">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club</h2>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Create and manage your club profile, members, and attached leaderboards</p>
              </div>
              <div className="p-6">
                {club ? (
                  <div className="space-y-6">
                    <div className="flex flex-col gap-3 rounded-none border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Club page</p>
                        <p className="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">/clubs/{club.slug}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={`/clubs/${club.slug}`}
                          className="inline-flex items-center justify-center rounded-none bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                          Open club →
                        </Link>
                        <Link
                          href="/clubs"
                          className="inline-flex items-center justify-center rounded-none border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                        >
                          View directory
                        </Link>
                      </div>
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
                        className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club description</label>
                      <textarea
                        name="club_description"
                        rows={3}
                        maxLength={250}
                        placeholder="What is this club about?"
                        className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Visibility</label>
                      <select
                        name="club_visibility"
                        defaultValue="PUBLIC"
                        className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      >
                        <option value="PUBLIC">Public - Listed in directory</option>
                        <option value="UNLISTED">Unlisted - Link only</option>
                        <option value="PRIVATE">Private - Owner only</option>
                      </select>
                    </div>

                    <div className="rounded-none border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                      <label className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">Club tag</label>
                      <div className="flex items-center gap-2">
                        <input
                          name="club_slug_prefix"
                          defaultValue={clubSlugParts.prefix}
                          maxLength={CLUB_SLUG_PART_MAX}
                          pattern="[A-Za-z0-9]{1,5}"
                          required
                          className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                        <span className="text-lg font-black text-slate-400">-</span>
                        <input
                          name="club_slug_tag"
                          defaultValue={clubSlugParts.tag}
                          maxLength={CLUB_SLUG_PART_MAX}
                          pattern="[A-Za-z0-9]{1,5}"
                          required
                          className="w-full rounded-none border-2 border-slate-200 bg-white px-4 py-3 text-sm font-semibold uppercase tracking-wide text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                      </div>
                      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Two parts, up to {CLUB_SLUG_PART_MAX} letters or numbers each.
                      </p>
                    </div>

                    <button
                      type="submit"
                      className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                      Create club
                    </button>
                  </form>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

