const { createClient } = require('@supabase/supabase-js')
const dotenv = require('dotenv')

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RIOT_API_KEY = (process.env.RIOT_API_KEY || '').trim().replace(/^['"]|['"]$/g, '')

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !RIOT_API_KEY) {
  console.error('Missing required env vars: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY')
  process.exit(1)
}

const AMERICAS = 'https://americas.api.riotgames.com'
const QUEUE_SOLO_ID = 420

async function riotFetch(url) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Riot ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

async function fetchRiotSeasonIds(puuid, startTimeUnix) {
  const ids = []
  for (let page = 0; page < 80; page += 1) {
    const start = page * 100
    const params = new URLSearchParams({
      queue: String(QUEUE_SOLO_ID),
      start: String(start),
      count: '100',
      startTime: String(startTimeUnix),
    })
    const url = `${AMERICAS}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${params.toString()}`
    const arr = await riotFetch(url)
    if (!Array.isArray(arr) || arr.length === 0) break
    ids.push(...arr)
    if (arr.length < 100) break
  }
  return ids
}

async function main() {
  const puuid = process.argv[2]
  if (!puuid) {
    console.error('Usage: node scripts/debugPlayerConsistency.js <puuid> [seasonStartIso]')
    process.exit(1)
  }

  const seasonStartIso = process.argv[3] || process.env.RANKED_SEASON_START || '2026-01-08T20:00:00.000Z'
  const seasonStartMs = new Date(seasonStartIso).getTime()
  const seasonStartUnix = Math.floor(seasonStartMs / 1000)

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

  const [{ data: playerRow }, { data: rankRows }] = await Promise.all([
    supabase
      .from('players')
      .select('puuid, game_name, tag_line')
      .eq('puuid', puuid)
      .maybeSingle(),
    supabase
      .from('player_rank_snapshot')
      .select('queue_type, wins, losses, fetched_at, tier, rank, league_points')
      .eq('puuid', puuid)
      .eq('queue_type', 'RANKED_SOLO_5x5')
      .order('fetched_at', { ascending: false })
      .limit(1),
  ])

  const riotIds = await fetchRiotSeasonIds(puuid, seasonStartUnix)
  const riotSet = new Set(riotIds)

  const { data: dbRows, error: dbErr } = await supabase
    .from('match_participants')
    .select('match_id, win, end_type, matches!inner(queue_id, game_end_ts)')
    .eq('puuid', puuid)
    .eq('matches.queue_id', QUEUE_SOLO_ID)
    .gte('matches.game_end_ts', seasonStartMs)

  if (dbErr) throw dbErr

  const uniqueByMatch = new Map()
  for (const row of dbRows || []) {
    if (!uniqueByMatch.has(row.match_id)) uniqueByMatch.set(row.match_id, row)
  }
  const uniqueRows = Array.from(uniqueByMatch.values())
  const dbIds = uniqueRows.map((r) => r.match_id)
  const dbSet = new Set(dbIds)

  const dbWins = uniqueRows.reduce((n, r) => n + (r.win ? 1 : 0), 0)
  const dbLosses = uniqueRows.length - dbWins
  const dbRemakes = uniqueRows.filter((r) => String(r.end_type || '').toUpperCase() === 'REMAKE').length

  const extraInDb = dbIds.filter((id) => !riotSet.has(id))
  const missingInDb = riotIds.filter((id) => !dbSet.has(id))

  const rank = rankRows?.[0] || null
  const rankWins = Number(rank?.wins ?? 0)
  const rankLosses = Number(rank?.losses ?? 0)

  console.log(
    JSON.stringify(
      {
        player: playerRow || { puuid },
        seasonStartIso,
        riotCount: riotIds.length,
        dbRows: (dbRows || []).length,
        dbUniqueCount: uniqueRows.length,
        dbRecord: { wins: dbWins, losses: dbLosses },
        rankRecord: rank
          ? {
              wins: rankWins,
              losses: rankLosses,
              tier: rank.tier,
              division: rank.rank,
              lp: rank.league_points,
              fetched_at: rank.fetched_at,
            }
          : null,
        deltas: {
          games: uniqueRows.length - (rankWins + rankLosses),
          wins: dbWins - rankWins,
          losses: dbLosses - rankLosses,
        },
        dbRemakes,
        extraInDbCount: extraInDb.length,
        missingInDbCount: missingInDb.length,
        extraInDbSample: extraInDb.slice(0, 20),
        missingInDbSample: missingInDb.slice(0, 20),
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

