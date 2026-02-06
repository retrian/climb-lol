import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const rawRiotApiKey = process.env.RIOT_API_KEY
const RANKED_SEASON_START = process.env.RANKED_SEASON_START

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !rawRiotApiKey) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RIOT_API_KEY')
}

const RIOT_API_KEY = rawRiotApiKey.trim().replace(/^['"]|['"]$/g, '')
if (!RIOT_API_KEY) {
  throw new Error('RIOT_API_KEY is empty after trimming quotes')
}

console.log('[env] RIOT_API_KEY prefix=', RIOT_API_KEY.slice(0, 5), 'len=', RIOT_API_KEY.length)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const NA1 = 'https://na1.api.riotgames.com'
const AMERICAS = 'https://americas.api.riotgames.com'

const CUTOFF_POLL_MS = 60 * 60 * 1000 // hourly

const QUEUE_SOLO = 'RANKED_SOLO_5x5'
const QUEUE_FLEX = 'RANKED_FLEX_SR'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function resetSeasonDataIfNeeded() {
  if (!RANKED_SEASON_START) return

  const seasonStartMs = new Date(RANKED_SEASON_START).getTime()
  if (Number.isNaN(seasonStartMs)) {
    console.warn('[season] invalid RANKED_SEASON_START:', RANKED_SEASON_START)
    return
  }

  const { data: oldMatch, error: oldMatchErr } = await supabase
    .from('matches')
    .select('match_id')
    .lt('game_end_ts', seasonStartMs)
    .limit(1)
    .maybeSingle()

  if (oldMatchErr) throw oldMatchErr
  if (!oldMatch) {
    console.log('[season] no pre-season matches found; still resetting rank data')
  }

  console.log('[season] clearing data before', RANKED_SEASON_START)

  const chunkSize = 500
  let offset = 0

  while (true) {
    const { data: matches, error: matchErr } = await supabase
      .from('matches')
      .select('match_id')
      .lt('game_end_ts', seasonStartMs)
      .range(offset, offset + chunkSize - 1)

    if (matchErr) throw matchErr
    if (!matches || matches.length === 0) break

    const matchIds = matches.map((m: any) => m.match_id).filter(Boolean)
    if (!matchIds.length) break

    await Promise.all([
      supabase.from('match_participants').delete().in('match_id', matchIds),
      supabase.from('player_lp_events').delete().in('match_id', matchIds),
      supabase.from('matches').delete().in('match_id', matchIds)
    ]).then(results => {
      for (const { error } of results) {
        if (error) throw error
      }
    })

    offset += chunkSize
  }

  await Promise.all([
    supabase.from('player_lp_history').delete().neq('puuid', ''),
    supabase.from('player_rank_snapshot').delete().neq('puuid', ''),
    supabase.from('player_top_champions').delete().neq('puuid', ''),
    supabase
      .from('player_riot_state')
      .update({
        last_solo_lp: null,
        last_solo_tier: null,
        last_solo_rank: null,
        last_solo_wins: null,
        last_solo_losses: null,
        last_solo_match_id: null,
        last_poll_at: null,
      })
      .neq('puuid', '')
  ]).then(results => {
    for (const { error } of results) {
      if (error) throw error
    }
  })

  console.log('[season] reset complete')
}

async function riotFetch<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
    // Wait the full retry-after time as specified by Riot
    const backoff = Math.max(retryAfter * 1000, 1000)
    console.warn('[riotFetch] 429 retryAfter=', retryAfter, 'backoff=', backoff, 'url=', url)
    
    // Only retry a limited number of times to avoid infinite loops
    if (attempt >= 3) {
      throw new Error(`Rate limited after ${attempt + 1} attempts. Wait before retrying.`)
    }
    
    await sleep(backoff)
    return riotFetch<T>(url, attempt + 1)
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    if (res.status === 401) {
      throw new Error('Riot API key invalid or missing. Check RIOT_API_KEY (no quotes).')
    }
    if (res.status === 403) {
      throw new Error('Riot API key forbidden. Key may be expired or blocked.')
    }
    console.error('[riotFetch] FAIL', res.status, url, t.slice(0, 200))
    throw new Error(`Riot ${res.status}: ${t}`.slice(0, 240))
  }

  return (await res.json()) as T
}

async function upsertRiotState(puuid: string, patch: Record<string, any>) {
  const { error } = await supabase.from('player_riot_state').upsert(
    { puuid, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'puuid' }
  )
  if (error) throw error
}

async function migratePuuid(oldPuuid: string, newPuuid: string) {
  console.log(`[migrate] Starting PUUID migration...`)
  console.log(`  Old: ${oldPuuid.slice(0, 12)}...`)
  console.log(`  New: ${newPuuid.slice(0, 12)}...`)

  try {
    // Update all tables with the new PUUID
    const updates = await Promise.allSettled([
      supabase.from('players').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('club_members').update({ player_puuid: newPuuid }).eq('player_puuid', oldPuuid),
      supabase.from('leaderboard_players').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('match_participants').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_lp_events').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_lp_history').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_rank_history').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_rank_snapshot').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_riot_state').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_top_champions').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
      supabase.from('player_top_champions_snapshot').update({ puuid: newPuuid }).eq('puuid', oldPuuid),
    ])

    // Check for errors
    const errors = updates
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === 'rejected')
    
    if (errors.length > 0) {
      console.error('[migrate] Some updates failed:', errors)
      throw new Error('PUUID migration partially failed')
    }

    // Check if any updates actually modified rows
    const successfulUpdates = updates.filter(result => 
      result.status === 'fulfilled' && result.value.error === null
    )

    console.log(`[migrate] ✅ Successfully updated ${successfulUpdates.length} tables`)
  } catch (error: any) {
    console.error('[migrate] ❌ Migration failed:', error.message)
    throw error
  }
}

async function syncSummonerBasics(puuid: string) {
  const data = await riotFetch<{ id: string; profileIconId: number }>(
    `${NA1}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`
  )

  await upsertRiotState(puuid, {
    summoner_id: data.id,
    profile_icon_id: data.profileIconId,
    last_account_sync_at: new Date().toISOString(),
    last_error: null,
  })

  return data.id
}

type RiotAccount = {
  puuid?: string
  gameName?: string | null
  tagLine?: string | null
}

async function syncAccountIdentity(puuid: string) {
  const { data: player } = await supabase
    .from('players')
    .select('game_name, tag_line')
    .eq('puuid', puuid)
    .maybeSingle()
  
  let account: RiotAccount | null = null
  let newPuuid = puuid
  
  // Strategy 1: Try by Riot ID first (if we have it)
  if (player?.game_name && player?.tag_line) {
    try {
      account = await riotFetch<RiotAccount>(
        `${AMERICAS}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(player.game_name)}/${encodeURIComponent(player.tag_line)}`
      )
      newPuuid = account.puuid || puuid
      console.log(`[sync] ✅ Fetched by Riot ID: ${player.game_name}#${player.tag_line}`)
    } catch (e: any) {
      // Name changed or doesn't exist - fall through to Strategy 2
      console.warn(`[sync] ⚠️ Riot ID fetch failed for ${player.game_name}#${player.tag_line}:`, e.message)
      account = null
    }
  }
  
  // Strategy 2: If Riot ID failed, try by PUUID (might fail with production key)
  if (!account) {
    try {
      account = await riotFetch<RiotAccount>(
        `${AMERICAS}/riot/account/v1/accounts/by-puuid/${encodeURIComponent(puuid)}`
      )
      newPuuid = account.puuid || puuid
      console.log(`[sync] ✅ Fetched by PUUID: ${puuid.slice(0, 12)}`)
    } catch (e: any) {
      // PUUID decryption failed (production key mismatch)
      console.error(`[sync] ❌ Both strategies failed for ${puuid.slice(0, 12)}:`, e.message)
      
      // Strategy 3: Manual intervention needed
      await upsertRiotState(puuid, { 
        last_error: `MIGRATION_NEEDED: Cannot fetch account. Riot ID may have changed and PUUID is encrypted with different key. Last known: ${player?.game_name}#${player?.tag_line}`
      })
      
      throw new Error(`Cannot sync ${puuid.slice(0, 12)} - manual intervention needed`)
    }
  }
  
  const gameName = String(account?.gameName ?? '').trim()
  const tagLine = String(account?.tagLine ?? '').trim()
  
  if (!gameName || !tagLine) {
    throw new Error('Account fetch succeeded but missing gameName/tagLine')
  }
  
  // If PUUID changed (due to encryption), migrate it
  if (newPuuid !== puuid) {
    console.log(`[sync] 🔄 Migrating PUUID for ${gameName}#${tagLine}`)
    await migratePuuid(puuid, newPuuid)
  }
  
  // Update stored Riot ID (in case it changed)
  const now = new Date().toISOString()
  
  const [lbRes, clubRes, playerRes] = await Promise.all([
    supabase
      .from('leaderboard_players')
      .update({ game_name: gameName, tag_line: tagLine, updated_at: now })
      .eq('puuid', newPuuid),
    supabase
      .from('club_members')
      .update({ game_name: gameName, tag_line: tagLine, updated_at: now })
      .eq('player_puuid', newPuuid),
    supabase
      .from('players')
      .upsert({ puuid: newPuuid, game_name: gameName, tag_line: tagLine, updated_at: now }, { onConflict: 'puuid' }),
  ])

  if (lbRes.error) throw lbRes.error
  if (clubRes.error) throw clubRes.error
  if (playerRes.error) throw playerRes.error

  await upsertRiotState(newPuuid, { last_account_sync_at: now, last_error: null })
}

type RankEntry = {
  queueType: string
  tier: string
  rank: string
  leaguePoints: number
  wins: number
  losses: number
}

type SoloSnapshot = {
  queue_type: typeof QUEUE_SOLO
  tier: string
  rank: string
  lp: number
  wins: number
  losses: number
  fetched_at: string
}

const NON_APEX_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'] as const
const APEX_TIERS = new Set(['MASTER', 'GRANDMASTER', 'CHALLENGER'])
const DIVISION_ORDER = ['IV', 'III', 'II', 'I'] as const
const APEX_STEP_INDEX = NON_APEX_TIERS.length * DIVISION_ORDER.length

function rankStepIndex(tier?: string | null, rank?: string | null): number | null {
  const tierKey = tier?.toUpperCase?.() ?? ''
  if (!tierKey) return null
  if (APEX_TIERS.has(tierKey)) return APEX_STEP_INDEX
  const tierIndex = NON_APEX_TIERS.indexOf(tierKey as (typeof NON_APEX_TIERS)[number])
  if (tierIndex === -1) return null
  const rankKey = rank?.toUpperCase?.() ?? ''
  const divisionIndex = DIVISION_ORDER.indexOf(rankKey as (typeof DIVISION_ORDER)[number])
  if (divisionIndex === -1) return null
  return tierIndex * DIVISION_ORDER.length + divisionIndex
}

const TIER_WEIGHT: Record<string, number> = {
  CHALLENGER: 10,
  GRANDMASTER: 9,
  MASTER: 8,
  DIAMOND: 7,
  EMERALD: 6,
  PLATINUM: 5,
  GOLD: 4,
  SILVER: 3,
  BRONZE: 2,
  IRON: 1,
}

function tierWeight(tier?: string | null): number {
  if (!tier) return 0
  return TIER_WEIGHT[tier.toUpperCase()] ?? 0
}

function computeLpDelta(opts: {
  lastTier?: string | null
  lastRank?: string | null
  lastLp: number
  nextTier?: string | null
  nextRank?: string | null
  nextLp: number
}): number {
  const { lastTier, lastRank, lastLp, nextTier, nextRank, nextLp } = opts
  const lastStep = rankStepIndex(lastTier, lastRank)
  const nextStep = rankStepIndex(nextTier, nextRank)
  if (lastStep === null || nextStep === null) return nextLp - lastLp
  return (nextStep - lastStep) * 100 + (nextLp - lastLp)
}

function pickSolo(entries: RankEntry[]): RankEntry | null {
  return entries.find((e) => e.queueType === QUEUE_SOLO) ?? null
}

async function syncRankByPuuid(puuid: string): Promise<SoloSnapshot | null> {
  const entries = await riotFetch<RankEntry[]>(
    `${NA1}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
  )

  const now = new Date().toISOString()

  if (!entries.length) {
    await Promise.all([
      supabase.from('player_rank_snapshot').delete().eq('puuid', puuid),
      upsertRiotState(puuid, {
        last_rank_sync_at: now,
        last_solo_lp: null,
        last_solo_tier: null,
        last_solo_rank: null,
        last_solo_wins: null,
        last_solo_losses: null,
        last_solo_match_id: null,
        last_error: null,
      })
    ]).then(([snapResult]) => {
      if (snapResult.error) throw snapResult.error
    })

    return null
  }

  const solo = pickSolo(entries)

  const upserts = entries
    .filter((e) => e.queueType === QUEUE_SOLO || e.queueType === QUEUE_FLEX)
    .map((e) => ({
      puuid,
      queue_type: e.queueType,
      tier: e.tier,
      rank: e.rank,
      league_points: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
      fetched_at: now,
    }))

  if (upserts.length > 0) {
    const { error } = await supabase
      .from('player_rank_snapshot')
      .upsert(upserts, { onConflict: 'puuid,queue_type' })
    if (error) throw error
  }

  await upsertRiotState(puuid, { last_rank_sync_at: now, last_error: null })

  if (!solo) return null

  return {
    queue_type: QUEUE_SOLO,
    tier: solo.tier,
    rank: solo.rank,
    lp: solo.leaguePoints,
    wins: solo.wins,
    losses: solo.losses,
    fetched_at: now,
  }
}

const MATCHLIST_PAGE_SIZE = Math.min(Math.max(Number(process.env.MATCHLIST_PAGE_SIZE ?? 100), 1), 100)
const MATCHLIST_MAX_PAGES = Math.max(Number(process.env.MATCHLIST_MAX_PAGES ?? 5), 1)
const MATCHLIST_QUEUE = (process.env.MATCHLIST_QUEUE ?? '').trim()
const MATCHDETAIL_MAX_PER_RUN = Math.max(Number(process.env.MATCHDETAIL_MAX_PER_RUN ?? 60), 1)
const MATCHDETAIL_SLEEP_MS = Math.max(Number(process.env.MATCHDETAIL_SLEEP_MS ?? 400), 0)

async function fetchMatchIdsPage(puuid: string, start: number, count: number): Promise<string[]> {
  const params = new URLSearchParams({ start: String(start), count: String(count) })
  if (MATCHLIST_QUEUE) params.set('queue', MATCHLIST_QUEUE)
  return riotFetch<string[]>(
    `${AMERICAS}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params.toString()}`
  )
}

async function syncMatchesAll(puuid: string): Promise<{ ids: string[]; newIds: string[] }> {
  const now = new Date().toISOString()

  const ids: string[] = []
  const idsSet = new Set<string>()
  const matchIdsToFetch = new Set<string>()
  let consecutiveFullPages = 0

  for (let page = 0; page < MATCHLIST_MAX_PAGES; page += 1) {
    const start = page * MATCHLIST_PAGE_SIZE
    const pageIds = await fetchMatchIdsPage(puuid, start, MATCHLIST_PAGE_SIZE)
    if (!pageIds.length) break

    for (const id of pageIds) {
      if (!idsSet.has(id)) {
        idsSet.add(id)
        ids.push(id)
      }
    }

    const { data: existingParticipants, error: participantsErr } = await supabase
      .from('match_participants')
      .select('match_id')
      .in('match_id', pageIds)
      .eq('puuid', puuid)
    if (participantsErr) throw participantsErr

    const existingParticipantsSet = new Set((existingParticipants ?? []).map((r) => r.match_id))
    const missing = pageIds.filter((id) => !existingParticipantsSet.has(id))

    if (missing.length === 0) consecutiveFullPages += 1
    else consecutiveFullPages = 0

    for (const id of missing) matchIdsToFetch.add(id)

    if (consecutiveFullPages >= 2) break
  }

  if (!ids.length) {
    await upsertRiotState(puuid, { last_matches_sync_at: now, last_error: null })
    return { ids: [], newIds: [] }
  }

  const matchIdsArray = Array.from(matchIdsToFetch)
  const limitedIds = matchIdsArray.slice(0, MATCHDETAIL_MAX_PER_RUN)

  const matchUpserts = []
  const participantUpserts = []

  for (const matchId of limitedIds) {
    const match = await riotFetch<any>(`${AMERICAS}/lol/match/v5/matches/${encodeURIComponent(matchId)}`)

    const info = match.info
    const meta = match.metadata

    matchUpserts.push({
      match_id: meta.matchId,
      queue_id: Number(info.queueId ?? 0),
      game_end_ts: Number(info.gameEndTimestamp ?? (info.gameStartTimestamp + info.gameDuration * 1000)),
      game_duration_s: Number(info.gameDuration ?? 0),
    })

    const part = (info.participants as any[]).find((x) => x.puuid === puuid)
    if (part) {
      // Determine end type
      let endType: 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL' = 'NORMAL'
      if (info.gameDuration < 300) { // Less than 5 minutes
        endType = 'REMAKE'
      } else if (info.gameEndedInEarlySurrender) {
        endType = 'EARLY_SURRENDER'
      } else if (info.gameEndedInSurrender) {
        endType = 'SURRENDER'
      }

      participantUpserts.push({
        match_id: meta.matchId,
        puuid,
        champion_id: Number(part.championId ?? 0),
        kills: Number(part.kills ?? 0),
        deaths: Number(part.deaths ?? 0),
        assists: Number(part.assists ?? 0),
        cs: Number((part.totalMinionsKilled ?? 0) + (part.neutralMinionsKilled ?? 0)),
        win: Boolean(part.win),
        vision_score: Number(part.visionScore ?? 0),
        end_type: endType,
        // LP data will be populated by updateMatchParticipantsWithLpData after all matches are fetched
      })
    }

    if (MATCHDETAIL_SLEEP_MS > 0) await sleep(MATCHDETAIL_SLEEP_MS)
  }

  if (matchUpserts.length > 0) {
    const { error } = await supabase
      .from('matches')
      .upsert(matchUpserts, { onConflict: 'match_id' })
    if (error) throw error
  }

  if (participantUpserts.length > 0) {
    const { error } = await supabase
      .from('match_participants')
      .upsert(participantUpserts, { onConflict: 'match_id,puuid' })
    if (error) throw error
  }

  await upsertRiotState(puuid, { last_matches_sync_at: now, last_error: null })
  return { ids, newIds: limitedIds }
}

async function updateMatchParticipantsWithLpData(puuid: string, matchIds: string[]) {
  if (!matchIds.length) return

  // Get LP events for these matches
  const { data: lpEvents, error: lpError } = await supabase
    .from('player_lp_events')
    .select('match_id, lp_before, lp_after, lp_delta, note')
    .eq('puuid', puuid)
    .in('match_id', matchIds)

  if (lpError) {
    console.warn('[updateLpData] error fetching lp_events:', lpError.message)
    return
  }

  if (!lpEvents || lpEvents.length === 0) return

  // Get LP history to find rank snapshots
  const { data: lpHistory, error: histError } = await supabase
    .from('player_lp_history')
    .select('tier, rank, lp, fetched_at')
    .eq('puuid', puuid)
    .eq('queue_type', QUEUE_SOLO)
    .order('fetched_at', { ascending: true })

  if (histError) {
    console.warn('[updateLpData] error fetching lp_history:', histError.message)
    return
  }

  // Get match timestamps
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('match_id, game_end_ts')
    .in('match_id', matchIds)

  if (matchError) {
    console.warn('[updateLpData] error fetching matches:', matchError.message)
    return
  }

  const matchTimestamps = new Map(matches?.map(m => [m.match_id, m.game_end_ts]) || [])

  // Update each match participant with LP data
  for (const event of lpEvents) {
    const matchEndTs = matchTimestamps.get(event.match_id)
    if (!matchEndTs) continue

    // Find rank snapshot before this match
    const beforeSnapshot = lpHistory
      ?.filter(h => new Date(h.fetched_at).getTime() <= matchEndTs)
      ?.slice(-1)[0] // Get the most recent one before match

    if (!beforeSnapshot) continue

    const { error: updateError } = await supabase
      .from('match_participants')
      .update({
        lp_change: event.lp_delta,
        lp_note: event.note,
        rank_tier: beforeSnapshot.tier,
        rank_division: beforeSnapshot.rank,
      })
      .eq('match_id', event.match_id)
      .eq('puuid', puuid)

    if (updateError) {
      console.warn('[updateLpData] error updating participant:', updateError.message)
    }
  }

  console.log('[updateLpData]', puuid.slice(0, 12), 'updated', lpEvents.length, 'matches')
}

async function insertLpHistory(puuid: string, snap: SoloSnapshot) {
  const { error } = await supabase.from('player_lp_history').insert({
    puuid,
    queue_type: snap.queue_type,
    tier: snap.tier,
    rank: snap.rank,
    lp: snap.lp,
    wins: snap.wins,
    losses: snap.losses,
    fetched_at: snap.fetched_at,
  })
  if (error) throw error
}

async function maybeInsertPerGameLpEvent(opts: {
  puuid: string
  snap: SoloSnapshot
  ids: string[]
  state: any | undefined
}) {
  const { puuid, snap, ids, state } = opts

  const lastLp = typeof state?.last_solo_lp === 'number' ? Number(state.last_solo_lp) : null
  const lastW = typeof state?.last_solo_wins === 'number' ? Number(state.last_solo_wins) : null
  const lastL = typeof state?.last_solo_losses === 'number' ? Number(state.last_solo_losses) : null
  const lastMatch = state?.last_solo_match_id ? String(state.last_solo_match_id) : null
  const lastTier = state?.last_solo_tier ? String(state.last_solo_tier) : null
  const lastRank = state?.last_solo_rank ? String(state.last_solo_rank) : null

  let newSince: string[] = []
  if (ids.length && lastMatch) {
    const idx = ids.indexOf(lastMatch)
    newSince = idx === -1 ? ids.slice(0, 1) : ids.slice(0, idx)
  }

  const newest = ids[0] ?? null

  if (lastLp === null || lastW === null || lastL === null) {
    await upsertRiotState(puuid, {
      last_solo_lp: snap.lp,
      last_solo_tier: snap.tier,
      last_solo_rank: snap.rank,
      last_solo_wins: snap.wins,
      last_solo_losses: snap.losses,
      last_solo_match_id: newest,
      last_poll_at: new Date().toISOString(),
    })
    return
  }

  const gamesDelta = (snap.wins + snap.losses) - (lastW + lastL)

  if (gamesDelta === 1 && newSince.length === 1) {
    const matchId = newSince[0]
    const lastStep = rankStepIndex(lastTier, lastRank)
    const nextStep = rankStepIndex(snap.tier, snap.rank)
    const stepDelta = lastStep !== null && nextStep !== null ? nextStep - lastStep : 0
    const lpDelta = computeLpDelta({
      lastTier,
      lastRank,
      lastLp,
      nextTier: snap.tier,
      nextRank: snap.rank,
      nextLp: snap.lp,
    })

    const { error } = await supabase.from('player_lp_events').insert({
      puuid,
      queue_type: snap.queue_type,
      match_id: matchId,
      lp_before: lastLp,
      lp_after: snap.lp,
      lp_delta: lpDelta,
      wins_before: lastW,
      wins_after: snap.wins,
      losses_before: lastL,
      losses_after: snap.losses,
      recorded_at: snap.fetched_at,
      note: stepDelta > 0 ? 'PROMOTED' : stepDelta < 0 ? 'DEMOTED' : null,
    })

    if (error && !String(error.message ?? '').toLowerCase().includes('duplicate')) {
      throw error
    }

    console.log('[lp_event]', puuid.slice(0, 12), matchId.slice(0, 10), 'delta', lpDelta)
  }

  await upsertRiotState(puuid, {
    last_solo_lp: snap.lp,
    last_solo_tier: snap.tier,
    last_solo_rank: snap.rank,
    last_solo_wins: snap.wins,
    last_solo_losses: snap.losses,
    last_solo_match_id: newest,
    last_poll_at: new Date().toISOString(),
  })
}

async function computeTopChamps(puuid: string) {
  const q = supabase
    .from('match_participants')
    .select('champion_id, win, matches!inner(game_end_ts)')
    .eq('puuid', puuid) as any

  const { data, error } = await q
    .order('game_end_ts', { referencedTable: 'matches', ascending: false })
    .limit(200)

  if (error) throw error

  const rows = (data ?? []) as Array<{ champion_id: number; win: boolean; matches?: { game_end_ts?: number } }>
  const agg = new Map<number, { games: number; wins: number; last: number }>()

  for (const r of rows) {
    const champ = Number(r.champion_id)
    if (!champ) continue
    const cur = agg.get(champ) ?? { games: 0, wins: 0, last: 0 }
    cur.games += 1
    cur.wins += r.win ? 1 : 0
    cur.last = Math.max(cur.last, Number(r.matches?.game_end_ts ?? 0))
    agg.set(champ, cur)
  }

  const top5 = [...agg.entries()]
    .map(([champion_id, v]) => ({ champion_id, ...v }))
    .sort((a, b) => b.games - a.games || b.wins - a.wins || b.last - a.last)
    .slice(0, 5)

  await supabase.from('player_top_champions').delete().eq('puuid', puuid)

  if (top5.length) {
    const { error: insErr } = await supabase.from('player_top_champions').insert(
      top5.map((t) => ({
        puuid,
        champion_id: t.champion_id,
        games: t.games,
        wins: t.wins,
        last_played_ts: t.last,
        computed_at: new Date().toISOString(),
      }))
    )
    if (insErr) throw insErr
  }
}

async function fetchAndUpsertRankCutoffsIfDue() {
  const QUEUE = QUEUE_SOLO

  const { data: lastRow, error: lastErr } = await supabase
    .from('rank_cutoffs')
    .select('fetched_at')
    .eq('queue_type', QUEUE)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastErr) {
    console.warn('[cutoffs] unable to read last fetched_at:', lastErr.message)
  } else if (lastRow?.fetched_at) {
    const age = Date.now() - new Date(lastRow.fetched_at).getTime()
    if (age < CUTOFF_POLL_MS) {
      console.log('[cutoffs] skip (fresh)', Math.round(age / 1000), 's')
      return
    }
  }

  type Entry = { leaguePoints: number; inactive?: boolean }
  type LeagueList = { entries: Entry[] }

  function cutoff(entries: Entry[], slots: number, floorLp: number): number {
    const eligible = entries
      .filter((e) => !e.inactive && (e.leaguePoints ?? 0) >= floorLp)
      .sort((a, b) => (b.leaguePoints ?? 0) - (a.leaguePoints ?? 0))

    return eligible.length >= slots ? eligible[slots - 1].leaguePoints : floorLp
  }

  try {
    const [chall, gm, master] = await Promise.all([
      riotFetch<LeagueList>(`${NA1}/lol/league/v4/challengerleagues/by-queue/${QUEUE}`),
      riotFetch<LeagueList>(`${NA1}/lol/league/v4/grandmasterleagues/by-queue/${QUEUE}`),
      riotFetch<LeagueList>(`${NA1}/lol/league/v4/masterleagues/by-queue/${QUEUE}`),
    ])

    const all = [...(chall.entries ?? []), ...(gm.entries ?? []), ...(master.entries ?? [])]
    const challenger_lp = cutoff(all, 300, 500)
    const grandmaster_lp = cutoff(all, 1000, 200)

    const { error } = await supabase.from('rank_cutoffs').upsert(
      [
        { queue_type: QUEUE, tier: 'CHALLENGER', cutoff_lp: challenger_lp, fetched_at: new Date().toISOString() },
        { queue_type: QUEUE, tier: 'GRANDMASTER', cutoff_lp: grandmaster_lp, fetched_at: new Date().toISOString() },
      ],
      { onConflict: 'queue_type,tier' }
    )
    if (error) throw error

    console.log('[cutoffs] updated', { challenger_lp, grandmaster_lp, mergedEntries: all.length })
  } catch (e: any) {
    console.error('[cutoffs] Error:', e?.message ?? e)
  }
}

async function hasTopChamps(puuid: string) {
  const { count, error } = await supabase
    .from('player_top_champions')
    .select('puuid', { count: 'exact', head: true })
    .eq('puuid', puuid)

  if (error) throw error
  return (count ?? 0) > 0
}

async function refreshOnePlayer(puuid: string, state: any | undefined) {
  console.log('[player] refresh', puuid.slice(0, 12))

  try {
    await syncAccountIdentity(puuid)
    
    // After syncAccountIdentity, the puuid might have been migrated
    // We need to get the potentially new puuid from the database
    const { data: playerData } = await supabase
      .from('players')
      .select('puuid')
      .eq('puuid', puuid)
      .maybeSingle()
    
    const actualPuuid = playerData?.puuid || puuid
    
    await syncSummonerBasics(actualPuuid)

    const { ids, newIds } = await syncMatchesAll(actualPuuid)

    const soloSnap = await syncRankByPuuid(actualPuuid)

    if (soloSnap) {
      await insertLpHistory(actualPuuid, soloSnap)
      await maybeInsertPerGameLpEvent({ puuid: actualPuuid, snap: soloSnap, ids, state })
      
      // Update LP data for newly fetched matches
      if (newIds.length > 0) {
        await updateMatchParticipantsWithLpData(actualPuuid, newIds)
      }
    }

    const missingTop = !(await hasTopChamps(actualPuuid))
    if (missingTop) await computeTopChamps(actualPuuid)

    await upsertRiotState(actualPuuid, { last_error: null })
  } catch (e: any) {
    console.error('[player] error', puuid.slice(0, 12), e?.message ?? e)
    await upsertRiotState(puuid, { last_error: String(e?.message ?? e) })
  }
}

async function main() {
  await resetSeasonDataIfNeeded()

  await fetchAndUpsertRankCutoffsIfDue()

  const { data: lbs, error: lbErr } = await supabase
    .from('leaderboard_players')
    .select('puuid, leaderboards(goal_mode, race_start_at, race_end_at, lp_goal, rank_goal_tier, goal_completed_at)')
  if (lbErr) throw lbErr

  const now = Date.now()
  const activePuuids = new Set<string>()

  for (const row of lbs ?? []) {
    const puuid = String((row as any).puuid ?? '').trim()
    if (!puuid) continue

    const lb = (row as any).leaderboards ?? null
    const mode = String(lb?.goal_mode ?? 'LIVE').toUpperCase()

    if (lb?.goal_completed_at) continue

    if (mode === 'RACE') {
      const startMs = lb?.race_start_at ? new Date(lb.race_start_at).getTime() : null
      const endMs = lb?.race_end_at ? new Date(lb.race_end_at).getTime() : null
      if (startMs && now < startMs) continue
      if (endMs && now > endMs) continue
    }

    activePuuids.add(puuid)
  }

  const puuids = [...activePuuids]
  if (!puuids.length) {
    console.log('No players to refresh.')
    return
  }

  const { data: states, error: stErr } = await supabase
    .from('player_riot_state')
    .select(
      'puuid, last_poll_at, last_solo_lp, last_solo_tier, last_solo_rank, last_solo_wins, last_solo_losses, last_solo_match_id'
    )
    .in('puuid', puuids)

  if (stErr) throw stErr
  const stateMap = new Map<string, any>((states ?? []).map((s: any) => [s.puuid, s]))

  const ordered = [...puuids].sort((a, b) => {
    const ta = stateMap.get(a)?.last_poll_at ? new Date(stateMap.get(a).last_poll_at).getTime() : 0
    const tb = stateMap.get(b)?.last_poll_at ? new Date(stateMap.get(b).last_poll_at).getTime() : 0
    return ta - tb
  })

  for (const puuid of ordered) {
    await refreshOnePlayer(puuid, stateMap.get(puuid))
    await sleep(1000)
  }

  await finalizeLeaderboardGoalsIfNeeded()

  console.log('Done.')
}

async function finalizeLeaderboardGoalsIfNeeded() {
  const { data: leaderboards, error } = await supabase
    .from('leaderboards')
    .select('id, goal_mode, lp_goal, rank_goal_tier, goal_completed_at')
    .in('goal_mode', ['LP_GOAL', 'RANK_GOAL'])
    .is('goal_completed_at', null)

  if (error) throw error
  if (!leaderboards || leaderboards.length === 0) return

  for (const lb of leaderboards) {
    const { data: players, error: plErr } = await supabase
      .from('leaderboard_players')
      .select('puuid')
      .eq('leaderboard_id', lb.id)

    if (plErr) throw plErr
    const puuids = (players ?? []).map((p: any) => p.puuid).filter(Boolean)
    if (!puuids.length) continue

    if (lb.goal_mode === 'LP_GOAL' && typeof lb.lp_goal === 'number' && lb.lp_goal > 0) {
      const { data: history, error: histErr } = await supabase
        .from('player_lp_history')
        .select('puuid, tier, rank, lp, fetched_at')
        .in('puuid', puuids)
        .eq('queue_type', QUEUE_SOLO)
        .gte('lp', lb.lp_goal)
        .in('tier', ['MASTER', 'GRANDMASTER', 'CHALLENGER'])
        .order('fetched_at', { ascending: true })

      if (histErr) throw histErr
      const rows = history ?? []
      if (!rows.length) continue

      let winner = rows[0]
      let winnerTs = new Date(winner.fetched_at).getTime()

      for (const row of rows) {
        const ts = new Date(row.fetched_at).getTime()
        if (Number.isNaN(ts)) continue
        if (ts < winnerTs || (ts === winnerTs && (row.lp ?? 0) > (winner.lp ?? 0))) {
          winner = row
          winnerTs = ts
        }
      }

      await supabase
        .from('leaderboards')
        .update({
          goal_completed_at: new Date(winnerTs).toISOString(),
          goal_winner_puuid: winner.puuid,
          goal_winner_lp: winner.lp ?? null,
          goal_winner_tier: winner.tier ?? null,
          goal_winner_rank: winner.rank ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lb.id)
    }

    if (lb.goal_mode === 'RANK_GOAL' && lb.rank_goal_tier) {
      const targetWeight = tierWeight(lb.rank_goal_tier)
      if (!targetWeight) continue

      const { data: history, error: histErr } = await supabase
        .from('player_lp_history')
        .select('puuid, tier, rank, lp, fetched_at')
        .in('puuid', puuids)
        .eq('queue_type', QUEUE_SOLO)
        .order('fetched_at', { ascending: true })

      if (histErr) throw histErr
      const rows = (history ?? []).filter((row: any) => tierWeight(row.tier) >= targetWeight)
      if (!rows.length) continue

      let earliestDay: string | null = null
      let winner = rows[0]

      for (const row of rows) {
        const dayKey = new Date(row.fetched_at).toISOString().slice(0, 10)
        if (!earliestDay || dayKey < earliestDay) {
          earliestDay = dayKey
          winner = row
        } else if (dayKey === earliestDay && (row.lp ?? 0) > (winner.lp ?? 0)) {
          winner = row
        }
      }

      const completionAt = earliestDay ? `${earliestDay}T23:59:59.999Z` : null
      if (!completionAt) continue

      await supabase
        .from('leaderboards')
        .update({
          goal_completed_at: completionAt,
          goal_winner_puuid: winner.puuid,
          goal_winner_lp: winner.lp ?? null,
          goal_winner_tier: winner.tier ?? null,
          goal_winner_rank: winner.rank ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', lb.id)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})