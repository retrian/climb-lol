import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const rawRiotApiKey = process.env.RIOT_API_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !rawRiotApiKey) {
  throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RIOT_API_KEY')
}

const RIOT_API_KEY = rawRiotApiKey.trim().replace(/^['"]|['"]$/g, '')
if (!RIOT_API_KEY) {
  throw new Error('RIOT_API_KEY is empty after trimming quotes')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const AMERICAS = 'https://americas.api.riotgames.com'

async function riotFetch<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_API_KEY } })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`Riot ${res.status}: ${t}`.slice(0, 240))
  }
  return (await res.json()) as T
}

type RiotAccount = {
  puuid?: string
  gameName?: string | null
  tagLine?: string | null
}

type RiotIdRow = {
  puuid: string
  game_name: string | null
  tag_line: string | null
}

const MIGRATION_TABLE = 'puuid_migration_map'

async function main() {
  // Mapping table must be created manually in SQL editor when RPC isn't available.

  const [playersRes, leaderboardRes, clubRes] = await Promise.all([
    supabase.from('players').select('puuid, game_name, tag_line'),
    supabase.from('leaderboard_players').select('puuid, game_name, tag_line'),
    supabase.from('club_members').select('player_puuid, game_name, tag_line'),
  ])

  if (playersRes.error) throw playersRes.error
  if (leaderboardRes.error) throw leaderboardRes.error
  if (clubRes.error) throw clubRes.error

  const combined: RiotIdRow[] = [
    ...((playersRes.data ?? []) as RiotIdRow[]),
    ...((leaderboardRes.data ?? []) as RiotIdRow[]),
    ...((clubRes.data ?? []) as Array<{ player_puuid: string; game_name: string | null; tag_line: string | null }>).map((r) => ({
      puuid: r.player_puuid,
      game_name: r.game_name,
      tag_line: r.tag_line,
    })),
  ]

  const uniqueByPuuid = new Map<string, RiotIdRow>()
  for (const row of combined) {
    if (!row?.puuid) continue
    if (!uniqueByPuuid.has(row.puuid)) uniqueByPuuid.set(row.puuid, row)
  }

  const rows = Array.from(uniqueByPuuid.values())
  console.log(`[fixPuuids] Riot IDs loaded: ${rows.length}`)

  for (const row of rows) {
    const gameName = row.game_name?.trim()
    const tagLine = row.tag_line?.trim()
    if (!gameName || !tagLine) {
      console.warn(`[fixPuuids] missing Riot ID for puuid ${row.puuid.slice(0, 8)}`)
      continue
    }

    try {
      const account = await riotFetch<RiotAccount>(
        `${AMERICAS}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`
      )

      const newPuuid = account.puuid
      if (!newPuuid || newPuuid === row.puuid) {
        continue
      }

      console.log(`[fixPuuids] ${gameName}#${tagLine} old=${row.puuid.slice(0, 8)} new=${newPuuid.slice(0, 8)}`)
      const { error: upsertError } = await supabase
        .from(MIGRATION_TABLE)
        .upsert({ old_puuid: row.puuid, new_puuid: newPuuid }, { onConflict: 'old_puuid' })
      if (upsertError) {
        throw new Error(`[${MIGRATION_TABLE}] ${upsertError.message}`)
      }
    } catch (err: any) {
      console.warn(`[fixPuuids] failed ${gameName}#${tagLine}: ${err?.message ?? err}`)
    }
  }

  const { count, error: mapCountError } = await supabase
    .from(MIGRATION_TABLE)
    .select('*', { count: 'exact', head: true })
  if (mapCountError) {
    console.warn(`[fixPuuids] map count error: ${mapCountError.message}`)
  } else {
    console.log(`[fixPuuids] mapping rows: ${count ?? 0}`)
  }

  console.log('[fixPuuids] done')
}

main().catch((err) => {
  console.error('[fixPuuids] fatal', err)
  process.exit(1)
})
