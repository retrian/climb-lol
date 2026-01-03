import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const RIOT_API_KEY = process.env.RIOT_API_KEY!

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RIOT_API_KEY) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RIOT_API_KEY')
}

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
    const backoff = Math.min(10_000, (retryAfter * 1000) * (attempt + 1))
    await sleep(backoff)
    return riotFetch<T>(url, attempt + 1)
  }

  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Riot ${res.status}: ${t || res.statusText}`.slice(0, 200))
  }

  return (await res.json()) as T
}

async function upsertRiotState(puuid: string, patch: Partial<any>) {
  const { error } = await supabase.from('player_riot_state').upsert(
    { puuid, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'puuid' }
  )
  if (error) throw error
}

async function syncSummoner(puuid: string) {
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

async function syncRank(puuid: string, summonerId: string) {
  const entries = await riotFetch<
    Array<{
      queueType: string
      tier: string
      rank: string
      leaguePoints: number
      wins: number
      losses: number
    }>
  >(`${NA1}/lol/league/v4/entries/by-summoner/${encodeURIComponent(summonerId)}`)

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
  // ranked solo only (queue=420). Add 440 if you want flex too.
  const ids = await riotFetch<string[]>(
    `${AMERICAS}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&count=10`
  )

  // If no matches found, just update timestamp and return
  if (!ids || ids.length === 0) {
    await upsertRiotState(puuid, { last_matches_sync_at: new Date().toISOString(), last_error: null })
    return
  }

  // Which matches do we already have?
  const { data: existing } = await supabase
    .from('matches')
    .select('match_id')
    .in('match_id', ids)

  const existingSet = new Set((existing ?? []).map((r) => r.match_id))
  const newIds = ids.filter((id) => !existingSet.has(id))

  for (const matchId of newIds) {
    const match = await riotFetch<any>(`${AMERICAS}/lol/match/v5/matches/${encodeURIComponent(matchId)}`)

    const info = match.info
    const meta = match.metadata

    const gameEnd = Number(info.gameEndTimestamp ?? (info.gameStartTimestamp + info.gameDuration * 1000))
    const queueId = Number(info.queueId ?? 0)
    const durationS = Number(info.gameDuration ?? 0)

    // insert match
    {
      const { error } = await supabase.from('matches').insert({
        match_id: meta.matchId,
        queue_id: queueId,
        game_end_ts: gameEnd,
        game_duration_s: durationS,
      })
      if (error && !error.message?.includes('duplicate')) throw error
    }

    // insert participant for THIS puuid only (enough for leaderboard feed)
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
      if (error && !error.message?.includes('duplicate')) throw error
    }

    // small delay to be polite
    await sleep(150)
  }

  await upsertRiotState(puuid, { last_matches_sync_at: new Date().toISOString(), last_error: null })
}

async function computeTopChamps(puuid: string) {
  // last 50 ranked matches in DB
  const { data } = await supabase
    .from('match_participants')
    .select('champion_id, win, matches!inner(game_end_ts)')
    .eq('puuid', puuid)
    .order('matches.game_end_ts', { ascending: false })
    .limit(50)

  const rows = (data ?? []) as any[]
  const agg = new Map<number, { games: number; wins: number; last: number }>()

  for (const r of rows) {
    const champ = Number(r.champion_id)
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
    .sort((a, b) => b.games - a.games || b.last - a.last)
    .slice(0, 5)

  // replace existing top champs for this puuid
  await supabase.from('player_top_champions').delete().eq('puuid', puuid)

  if (top5.length) {
    const { error } = await supabase.from('player_top_champions').insert(
      top5.map((t) => ({
        puuid,
        champion_id: t.champion_id,
        games: t.games,
        wins: t.wins,
        last_played_ts: t.last,
        computed_at: new Date().toISOString(),
      }))
    )
    if (error) throw error
  }
}

function isStale(ts?: string | null) {
  if (!ts) return true
  const ageMs = Date.now() - new Date(ts).getTime()
  return ageMs > 30 * 60 * 1000
}

async function main() {
  // get all puuids currently on any leaderboard
  const { data: lbs, error: lbErr } = await supabase
    .from('leaderboard_players')
    .select('puuid')

  if (lbErr) throw lbErr

  const puuids = [...new Set((lbs ?? []).map((r) => r.puuid))]
  if (!puuids.length) {
    console.log('No players to refresh.')
    return
  }

  // load state for staleness check
  const { data: states } = await supabase
    .from('player_riot_state')
    .select('puuid, summoner_id, last_rank_sync_at, last_matches_sync_at')
    .in('puuid', puuids)

  const stateMap = new Map((states ?? []).map((s) => [s.puuid, s]))

  // refresh stale only, sequential to respect limits
  for (const puuid of puuids) {
    const st = stateMap.get(puuid) as any | undefined
    const staleRank = isStale(st?.last_rank_sync_at)
    const staleMatches = isStale(st?.last_matches_sync_at)

    if (!staleRank && !staleMatches) continue
    
    console.log('Refreshing', puuid.slice(0, 12), { staleRank, staleMatches })

    try {
      const summonerId = st?.summoner_id ? st.summoner_id : await syncSummoner(puuid)
      if (staleRank) await syncRank(puuid, summonerId)
      if (staleMatches) {
        try {
          await syncMatchesRankedOnly(puuid)
        } catch (e: any) {
          // If 403/404 on match fetch, the PUUID might be invalid or from wrong region
          if (e.message?.includes('403') || e.message?.includes('404')) {
            console.warn(`PUUID ${puuid.slice(0, 12)} returned ${e.message} - might be wrong region or invalid`)
            await upsertRiotState(puuid, { 
              last_error: 'PUUID not found in AMERICAS region - check if player is from NA',
              last_matches_sync_at: new Date().toISOString() 
            })
          } else {
            throw e
          }
        }
      }
      await computeTopChamps(puuid)
    } catch (e: any) {
      console.error('Error for', puuid.slice(0, 12), e?.message ?? e)
      await upsertRiotState(puuid, { last_error: String(e?.message ?? e) })
    }

    // global pacing
    await sleep(250)
  }

  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})