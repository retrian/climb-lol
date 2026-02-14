const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RIOT_API_KEY = (process.env.RIOT_API_KEY || '').trim().replace(/^['"]|['"]$/g, '')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RIOT_API_KEY) {
  console.error('Missing env: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const AMERICAS = 'https://americas.api.riotgames.com'
const QUEUE_SOLO_ID = 420

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function riotFetch(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') || '1')
    await sleep(Math.max(1000, retryAfter * 1000))
    return riotFetch(url)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Riot ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

function getEndType(info) {
  if (!info) return 'NORMAL'
  if (Number(info.gameDuration || 0) < 300) return 'REMAKE'
  if (info.gameEndedInEarlySurrender) return 'EARLY_SURRENDER'
  if (info.gameEndedInSurrender) return 'SURRENDER'
  return 'NORMAL'
}

async function fetchAllRiotIds(puuid, seasonStartUnix) {
  const ids = []
  for (let page = 0; page < 80; page += 1) {
    const start = page * 100
    const params = new URLSearchParams({
      queue: String(QUEUE_SOLO_ID),
      start: String(start),
      count: '100',
      startTime: String(seasonStartUnix),
    })
    const url = `${AMERICAS}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params.toString()}`
    const list = await riotFetch(url)
    if (!Array.isArray(list) || list.length === 0) break
    ids.push(...list)
    if (list.length < 100) break
  }
  return ids
}

async function main() {
  const puuid = process.argv[2]
  const seasonStartIso = process.argv[3] || process.env.RANKED_SEASON_START || '2026-01-08T20:00:00.000Z'
  if (!puuid) {
    console.error('Usage: node scripts/backfillOnePlayerSeason.js <puuid> [seasonStartIso]')
    process.exit(1)
  }

  const seasonStartMs = new Date(seasonStartIso).getTime()
  const seasonStartUnix = Math.floor(seasonStartMs / 1000)

  const { data: playerIdentity } = await supabase
    .from('players')
    .select('game_name, tag_line')
    .eq('puuid', puuid)
    .maybeSingle()

  const identityGameName = String(playerIdentity?.game_name || '').trim().toLowerCase()
  const identityTagLine = String(playerIdentity?.tag_line || '').trim().toLowerCase()

  const riotIds = await fetchAllRiotIds(puuid, seasonStartUnix)
  const riotSet = new Set(riotIds)

  const { data: existingRows, error: existingErr } = await supabase
    .from('match_participants')
    .select('match_id, matches!inner(queue_id, game_end_ts)')
    .eq('puuid', puuid)
    .eq('matches.queue_id', QUEUE_SOLO_ID)
    .gte('matches.game_end_ts', seasonStartMs)

  if (existingErr) throw existingErr

  const existingSet = new Set((existingRows || []).map((r) => r.match_id))
  const missingIds = riotIds.filter((id) => !existingSet.has(id))

  const matchUpserts = []
  const partUpserts = []

  for (let i = 0; i < missingIds.length; i += 1) {
    const matchId = missingIds[i]
    const match = await riotFetch(`${AMERICAS}/lol/match/v5/matches/${encodeURIComponent(matchId)}`)
    const info = match?.info
    const meta = match?.metadata
    if (!info || !meta?.matchId) continue

    matchUpserts.push({
      match_id: meta.matchId,
      queue_id: Number(info.queueId || 0),
      game_end_ts: Number(info.gameEndTimestamp || (info.gameStartTimestamp + info.gameDuration * 1000)),
      game_duration_s: Number(info.gameDuration || 0),
    })

    const participants = info.participants || []
    let participant = participants.find((p) => p.puuid === puuid)

    // Fallback for legacy/migrated PUUID rows: map by Riot ID when available.
    if (!participant && identityGameName && identityTagLine) {
      participant = participants.find((p) => {
        const gn = String(p?.riotIdGameName || '').trim().toLowerCase()
        const tl = String(p?.riotIdTagline || '').trim().toLowerCase()
        return gn === identityGameName && tl === identityTagLine
      })
    }
    if (participant) {
      partUpserts.push({
        match_id: meta.matchId,
        puuid,
        champion_id: Number(participant.championId || 0),
        kills: Number(participant.kills || 0),
        deaths: Number(participant.deaths || 0),
        assists: Number(participant.assists || 0),
        cs: Number((participant.totalMinionsKilled || 0) + (participant.neutralMinionsKilled || 0)),
        win: Boolean(participant.win),
        vision_score: Number(participant.visionScore || 0),
        end_type: getEndType(info),
      })
    }

    if ((i + 1) % 25 === 0) {
      console.log(`[backfill] fetched ${i + 1}/${missingIds.length}`)
    }

    await sleep(120)
  }

  if (matchUpserts.length > 0) {
    const { error } = await supabase.from('matches').upsert(matchUpserts, { onConflict: 'match_id' })
    if (error) throw error
  }

  if (partUpserts.length > 0) {
    const { error } = await supabase.from('match_participants').upsert(partUpserts, { onConflict: 'match_id,puuid' })
    if (error) throw error
  }

  await supabase
    .from('player_riot_state')
    .upsert({ puuid, last_matches_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'puuid' })

  const { data: afterRows } = await supabase
    .from('match_participants')
    .select('match_id, win, matches!inner(queue_id, game_end_ts)')
    .eq('puuid', puuid)
    .eq('matches.queue_id', QUEUE_SOLO_ID)
    .gte('matches.game_end_ts', seasonStartMs)

  const afterUnique = [...new Map((afterRows || []).map((r) => [r.match_id, r])).values()]
  const wins = afterUnique.reduce((n, r) => n + (r.win ? 1 : 0), 0)
  const losses = afterUnique.length - wins

  console.log(
    JSON.stringify(
      {
        puuid,
        seasonStartIso,
        riotIds: riotSet.size,
        missingBefore: missingIds.length,
        insertedParticipants: partUpserts.length,
        finalUniqueMatches: afterUnique.length,
        finalRecord: `${wins}W ${losses}L`,
      },
      null,
      2
    )
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

