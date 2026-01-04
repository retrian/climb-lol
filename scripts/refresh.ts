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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function riotFetch<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
    const backoff = Math.min(10_000, retryAfter * 1000 * (attempt + 1))
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

async function syncRankByPuuid(puuid: string) {
  const entries = await riotFetch<
    Array<{
      queueType: string
      tier: string
      rank: string
      leaguePoints: number
      wins: number
      losses: number
    }>
  >(`${NA1}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`)

  const now = new Date().toISOString()

  for (const e of entries) {
    if (e.queueType !== 'RANKED_SOLO_5x5' && e.queueType !== 'RANKED_FLEX_SR') continue

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
}

async function syncMatchesRankedOnly(puuid: string) {
  const ids = await riotFetch<string[]>(
    `${AMERICAS}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=10`
  )

  const now = new Date().toISOString()

  if (!ids.length) {
    await upsertRiotState(puuid, { last_matches_sync_at: now, last_error: null })
    return
  }

  const { data: existing } = await supabase.from('matches').select('match_id').in('match_id', ids)
  const existingSet = new Set((existing ?? []).map((r) => r.match_id))
  const newIds = ids.filter((id) => !existingSet.has(id))

  for (const matchId of newIds) {
    const match = await riotFetch<any>(`${AMERICAS}/lol/match/v5/matches/${encodeURIComponent(matchId)}`)

    const info = match.info
    const meta = match.metadata

    const gameEnd = Number(
      info.gameEndTimestamp ?? (info.gameStartTimestamp + info.gameDuration * 1000)
    )
    const queueId = Number(info.queueId ?? 0)
    const durationS = Number(info.gameDuration ?? 0)

    {
      const { error } = await supabase.from('matches').insert({
        match_id: meta.matchId,
        queue_id: queueId,
        game_end_ts: gameEnd,
        game_duration_s: durationS,
      })
      if (error) throw error
    }

    const p = (info.participants as any[]).find((x) => x.puuid === puuid)
    if (p) {
      const cs = Number((p.totalMinionsKilled ?? 0) + (p.neutralMinionsKilled ?? 0))

      const { error } = await supabase.from('match_participants').insert({
        match_id: meta.matchId,
        puuid,
        champion_id: Number(p.championId ?? 0),
        kills: Number(p.kills ?? 0),
        deaths: Number(p.deaths ?? 0),
        assists: Number(p.assists ?? 0),
        cs,
        win: Boolean(p.win),
      })
      if (error) throw error
    }

    await sleep(150)
  }

  await upsertRiotState(puuid, { last_matches_sync_at: now, last_error: null })
}

/**
 * Top 5 champions (ranked-only, Solo queue only)
 * We compute from *your DB* (matches + match_participants), not Riot.
 * Uses last N matches so it stays stable but still reflects "recent" meta.
 */
async function computeTopChampsRankedOnly(puuid: string) {
  const SAMPLE_SIZE = 200 // more stable than 50
  const QUEUE_ID = 420 // Solo/Duo

  const { data, error } = await supabase
    .from('match_participants')
    .select('champion_id, win, matches!inner(game_end_ts, queue_id)')
    .eq('puuid', puuid)
    .eq('matches.queue_id', QUEUE_ID)
    .order('matches.game_end_ts', { ascending: false })
    .limit(SAMPLE_SIZE)

  if (error) throw error

  const rows = (data ?? []) as any[]

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

  // Replace existing rows (simple + safe)
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

async function fetchAndUpsertRankCutoffs() {
  const QUEUE = 'RANKED_SOLO_5x5'

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

    console.log('[cutoffs] Merged entries:', all.length)
    console.log('[cutoffs] Challenger (top 300, min 500):', challenger_lp, 'LP')
    console.log('[cutoffs] Grandmaster (top 1000, min 200):', grandmaster_lp, 'LP')

    const cutoffs = [
      { queue_type: QUEUE, tier: 'CHALLENGER', cutoff_lp: challenger_lp },
      { queue_type: QUEUE, tier: 'GRANDMASTER', cutoff_lp: grandmaster_lp },
    ]

    const { error } = await supabase.from('rank_cutoffs').upsert(
      cutoffs.map((c) => ({
        ...c,
        fetched_at: new Date().toISOString(),
      })),
      { onConflict: 'queue_type,tier' }
    )
    if (error) throw error
    console.log('[cutoffs] Upserted 2 cutoff rows')
  } catch (e: any) {
    console.error('[cutoffs] Error:', e?.message ?? e)
  }
}

function isStale(ts?: string | null) {
  if (!ts) return true
  return Date.now() - new Date(ts).getTime() > 30 * 60 * 1000
}

async function main() {
  await fetchAndUpsertRankCutoffs()

  const { data: lbs, error: lbErr } = await supabase.from('leaderboard_players').select('puuid')
  if (lbErr) throw lbErr

  const puuids = [...new Set((lbs ?? []).map((r) => r.puuid))]
  if (!puuids.length) {
    console.log('No players to refresh.')
    return
  }

  const { data: states } = await supabase
    .from('player_riot_state')
    .select('puuid, summoner_id, last_rank_sync_at, last_matches_sync_at')
    .in('puuid', puuids)

  const stateMap = new Map((states ?? []).map((s: any) => [s.puuid, s]))

  for (const puuid of puuids) {
    const st = stateMap.get(puuid) as any | undefined
    const staleRank = isStale(st?.last_rank_sync_at)
    const staleMatches = isStale(st?.last_matches_sync_at)

    if (!staleRank && !staleMatches) continue

    console.log('Refreshing', puuid.slice(0, 12), { staleRank, staleMatches })

    try {
      await syncSummonerBasics(puuid)
      if (staleRank) await syncRankByPuuid(puuid)
      if (staleMatches) await syncMatchesRankedOnly(puuid)

      // Always compute after match sync so it reflects newest data
      await computeTopChampsRankedOnly(puuid)
    } catch (e: any) {
      console.error('Error for', puuid.slice(0, 12), e?.message ?? e)
      await upsertRiotState(puuid, { last_error: String(e?.message ?? e) })
    }

    await sleep(250)
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
