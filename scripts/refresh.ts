import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const RIOT_API_KEY = process.env.RIOT_API_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RIOT_API_KEY) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RIOT_API_KEY')
}

console.log('[env] RIOT_API_KEY prefix=', RIOT_API_KEY.slice(0, 5), 'len=', RIOT_API_KEY.length)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const NA1 = 'https://na1.api.riotgames.com'
const AMERICAS = 'https://americas.api.riotgames.com'

const PLAYER_POLL_MS = 10_000 // your request (single worker, sequential)
const CUTOFF_POLL_MS = 60 * 60 * 1000 // hourly

const QUEUE_SOLO = 'RANKED_SOLO_5x5'
const QUEUE_FLEX = 'RANKED_FLEX_SR'

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function riotFetch<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
    const backoff = Math.min(30_000, retryAfter * 1000 * (attempt + 1))
    console.warn('[riotFetch] 429 retryAfter=', retryAfter, 'backoff=', backoff, 'url=', url)
    await sleep(backoff)
    return riotFetch<T>(url, attempt + 1)
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '')
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

function pickSolo(entries: RankEntry[]): RankEntry | null {
  return entries.find((e) => e.queueType === QUEUE_SOLO) ?? null
}

async function syncRankByPuuid(puuid: string): Promise<SoloSnapshot | null> {
  const entries = await riotFetch<RankEntry[]>(
    `${NA1}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`
  )

  const now = new Date().toISOString()

  for (const e of entries) {
    if (e.queueType !== QUEUE_SOLO && e.queueType !== QUEUE_FLEX) continue

    const { error } = await supabase.from('player_rank_snapshot').upsert(
      {
        puuid,
        queue_type: e.queueType,
        tier: e.tier,
        rank: e.rank,
        league_points: e.leaguePoints,
        wins: e.wins,
        losses: e.losses,
        fetched_at: now,
      },
      { onConflict: 'puuid,queue_type' }
    )
    if (error) throw error
  }

  await upsertRiotState(puuid, { last_rank_sync_at: now, last_error: null })

  const solo = pickSolo(entries)
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

/**
 * Ranked-only match ingest.
 * Returns the full ids list + which ones were newly inserted.
 */
async function syncMatchesRankedOnly(puuid: string): Promise<{ ids: string[]; newIds: string[] }> {
  const ids = await riotFetch<string[]>(
    `${AMERICAS}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=10`
  )

  const now = new Date().toISOString()

  if (!ids.length) {
    await upsertRiotState(puuid, { last_matches_sync_at: now, last_error: null })
    return { ids: [], newIds: [] }
  }

  const { data: existing, error: exErr } = await supabase.from('matches').select('match_id').in('match_id', ids)
  if (exErr) throw exErr
  const existingSet = new Set((existing ?? []).map((r) => r.match_id))
  const newIds = ids.filter((id) => !existingSet.has(id))

  for (const matchId of newIds) {
    const match = await riotFetch<any>(`${AMERICAS}/lol/match/v5/matches/${encodeURIComponent(matchId)}`)

    const info = match.info
    const meta = match.metadata

    const gameEnd = Number(info.gameEndTimestamp ?? (info.gameStartTimestamp + info.gameDuration * 1000))
    const queueId = Number(info.queueId ?? 0)
    const durationS = Number(info.gameDuration ?? 0)

    // upsert match row
    {
      const { error } = await supabase.from('matches').upsert(
        {
          match_id: meta.matchId,
          queue_id: queueId,
          game_end_ts: gameEnd,
          game_duration_s: durationS,
        },
        { onConflict: 'match_id' }
      )
      if (error) throw error
    }

    // upsert participant row for this puuid
    const part = (info.participants as any[]).find((x) => x.puuid === puuid)
    if (part) {
      const cs = Number((part.totalMinionsKilled ?? 0) + (part.neutralMinionsKilled ?? 0))
      const { error } = await supabase.from('match_participants').upsert(
        {
          match_id: meta.matchId,
          puuid,
          champion_id: Number(part.championId ?? 0),
          kills: Number(part.kills ?? 0),
          deaths: Number(part.deaths ?? 0),
          assists: Number(part.assists ?? 0),
          cs,
          win: Boolean(part.win),
        },
        { onConflict: 'match_id,puuid' }
      )
      if (error) throw error
    }

    // small pacing
    await sleep(150)
  }

  await upsertRiotState(puuid, { last_matches_sync_at: now, last_error: null })
  return { ids, newIds }
}

/**
 * LP history: always useful for a line graph.
 */
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

/**
 * Per-game LP events:
 * We ONLY attribute when there is EXACTLY ONE new ranked match between checks
 * and wins+losses increased by exactly 1.
 */
async function maybeInsertPerGameLpEvent(opts: {
  puuid: string
  snap: SoloSnapshot
  ids: string[] // newest -> oldest
  state: any | undefined
}) {
  const { puuid, snap, ids, state } = opts

  const lastLp = typeof state?.last_solo_lp === 'number' ? Number(state.last_solo_lp) : null
  const lastW = typeof state?.last_solo_wins === 'number' ? Number(state.last_solo_wins) : null
  const lastL = typeof state?.last_solo_losses === 'number' ? Number(state.last_solo_losses) : null
  const lastMatch = state?.last_solo_match_id ? String(state.last_solo_match_id) : null

  // find new matches since lastMatch (ids are newest-first)
  let newSince: string[] = []
  if (ids.length) {
    if (!lastMatch) {
      // first time: don't pretend we know per-game deltas
      newSince = []
    } else {
      const idx = ids.indexOf(lastMatch)
      newSince = idx === -1 ? ids.slice(0, 1) : ids.slice(0, idx) // if missing, treat as 1 unknown newest
    }
  }

  // always update last seen match id to newest (so we progress)
  const newest = ids[0] ?? null

  // if we don't have a baseline, just store baseline and move on
  if (lastLp === null || lastW === null || lastL === null) {
    await upsertRiotState(puuid, {
      last_solo_lp: snap.lp,
      last_solo_wins: snap.wins,
      last_solo_losses: snap.losses,
      last_solo_match_id: newest,
      last_poll_at: new Date().toISOString(),
    })
    return
  }

  const gamesDelta = (snap.wins + snap.losses) - (lastW + lastL)

  // only attribute if exactly 1 new game occurred AND we can point to exactly 1 new match
  if (gamesDelta === 1 && newSince.length === 1) {
    const matchId = newSince[0]
    const lpDelta = snap.lp - lastLp

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
      note: null,
    })

    // ignore unique constraint duplicates (reruns)
    if (error && !String(error.message ?? '').toLowerCase().includes('duplicate')) {
      throw error
    }

    console.log('[lp_event]', puuid.slice(0, 12), matchId.slice(0, 10), 'delta', lpDelta)
  } else {
    // we still update the rolling baseline; we just can't attribute per match reliably
    // (could be multiple games, dodges, decay, etc.)
  }

  await upsertRiotState(puuid, {
    last_solo_lp: snap.lp,
    last_solo_wins: snap.wins,
    last_solo_losses: snap.losses,
    last_solo_match_id: newest,
    last_poll_at: new Date().toISOString(),
  })
}

/**
 * Top 5 champs (ranked-only in practice because you only ingest queue=420)
 */
async function computeTopChamps(puuid: string) {
  const SAMPLE_SIZE = 200

  // (cast to any to allow ordering by referenced table without TS drama)
  const q = supabase
    .from('match_participants')
    .select('champion_id, win, matches!inner(game_end_ts)')
    .eq('puuid', puuid) as any

  const { data, error } = await q
    .order('game_end_ts', { referencedTable: 'matches', ascending: false })
    .limit(SAMPLE_SIZE)

  if (error) throw error

  const rows = (data ?? []) as Array<{ champion_id: number; win: boolean; matches?: { game_end_ts?: number } }>
  const agg = new Map<number, { games: number; wins: number; last: number }>()

  for (const r of rows) {
    const champ = Number(r.champion_id)
    if (!champ) continue
    const win = Boolean(r.win)
    const ts = Number(r.matches?.game_end_ts ?? 0)
    const cur = agg.get(champ) ?? { games: 0, wins: 0, last: 0 }
    cur.games += 1
    cur.wins += win ? 1 : 0
    cur.last = Math.max(cur.last, ts)
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

  // check last fetched_at
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
      .filter((e) => !e.inactive)
      .filter((e) => (e.leaguePoints ?? 0) >= floorLp)
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

    const cutoffs = [
      { queue_type: QUEUE, tier: 'CHALLENGER', cutoff_lp: challenger_lp },
      { queue_type: QUEUE, tier: 'GRANDMASTER', cutoff_lp: grandmaster_lp },
    ]

    const { error } = await supabase.from('rank_cutoffs').upsert(
      cutoffs.map((c) => ({ ...c, fetched_at: new Date().toISOString() })),
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
    // summoner basics can be expensive; if you want, you can gate this by time later
    await syncSummonerBasics(puuid)

    const { ids } = await syncMatchesRankedOnly(puuid)

    // Always fetch rank after match sync so LP history stays usable
    const soloSnap = await syncRankByPuuid(puuid)

    if (soloSnap) {
      // 1) always insert LP history point (line graph)
      await insertLpHistory(puuid, soloSnap)

      // 2) attempt per-game attribution (only when exactly 1 new match occurred)
      await maybeInsertPerGameLpEvent({ puuid, snap: soloSnap, ids, state })
    }

    // keep top champs filled
    const missingTop = !(await hasTopChamps(puuid))
    if (missingTop) await computeTopChamps(puuid)

    await upsertRiotState(puuid, { last_error: null })
  } catch (e: any) {
    console.error('[player] error', puuid.slice(0, 12), e?.message ?? e)
    await upsertRiotState(puuid, { last_error: String(e?.message ?? e) })
  }
}

async function main() {
  // hourly cutoffs
  await fetchAndUpsertRankCutoffsIfDue()

  const { data: lbs, error: lbErr } = await supabase.from('leaderboard_players').select('puuid')
  if (lbErr) throw lbErr

  const puuids = [...new Set((lbs ?? []).map((r) => r.puuid))]
  if (!puuids.length) {
    console.log('No players to refresh.')
    return
  }

  const { data: states, error: stErr } = await supabase
    .from('player_riot_state')
    .select('puuid, last_poll_at, last_solo_lp, last_solo_wins, last_solo_losses, last_solo_match_id')
    .in('puuid', puuids)

  if (stErr) throw stErr
  const stateMap = new Map<string, any>((states ?? []).map((s: any) => [s.puuid, s]))

  // pick the stalest first (simple scheduling)
  const ordered = [...puuids].sort((a, b) => {
    const ta = stateMap.get(a)?.last_poll_at ? new Date(stateMap.get(a).last_poll_at).getTime() : 0
    const tb = stateMap.get(b)?.last_poll_at ? new Date(stateMap.get(b).last_poll_at).getTime() : 0
    return ta - tb
  })

  // One pass: refresh everyone sequentially with pacing.
  // If you want true "every 10s per player", you need a long-running worker or multiple workers.
  for (const puuid of ordered) {
    await refreshOnePlayer(puuid, stateMap.get(puuid))
    await sleep(250) // pacing between players to reduce burst rate-limit risk
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
