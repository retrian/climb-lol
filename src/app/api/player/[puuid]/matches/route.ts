import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSeasonStartIso } from '@/lib/riot/season'

export async function GET(request: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid } = await params
    if (!puuid) return NextResponse.json({ error: 'Missing puuid' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const fetchAll = limitParam === 'all'
    const limit = fetchAll ? null : Math.min(Math.max(Number(limitParam ?? 50), 1), 200)

    const supabase = await createClient()

    const seasonStartIso = getSeasonStartIso()
    const seasonStartMs = new Date(seasonStartIso).getTime()

    const matches: any[] = []
    const pageSize = 1000
    let from = 0
    let to = pageSize - 1
    let done = false

    while (!done) {
      const query = supabase
        .from('match_participants')
        .select(`
          match_id, 
          puuid, 
          champion_id, 
          kills, 
          deaths, 
          assists, 
          cs, 
          win, 
          vision_score,
          lp_change,
          lp_note,
          rank_tier,
          rank_division,
          end_type,
          matches!inner(game_end_ts, game_duration_s, queue_id)
        `)
        .eq('puuid', puuid)
        .eq('matches.queue_id', 420)
        .gte('matches.game_end_ts', seasonStartMs)
        .order('game_end_ts', { ascending: false, referencedTable: 'matches' })

      const { data: rows, error } = fetchAll
        ? await query.range(from, to)
        : await query.limit(limit ?? 50)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      if (!rows || rows.length === 0) {
        done = true
      } else {
        matches.push(...rows)
        if (!fetchAll || rows.length < pageSize) {
          done = true
        } else {
          from += pageSize
          to += pageSize
        }
      }

      if (!fetchAll) done = true
    }

    // Defensive de-duplication: keep one row per match_id for this player.
    // Historical backfills/migrations can leave duplicate participant rows.
    const uniqueRows = new Map<string, any>()
    for (const row of matches) {
      const matchId = String(row?.match_id ?? '')
      if (!matchId || uniqueRows.has(matchId)) continue
      uniqueRows.set(matchId, row)
    }

    const payload = Array.from(uniqueRows.values()).map((row: any) => ({
      matchId: row.match_id,
      puuid: row.puuid,
      championId: row.champion_id,
      win: row.win,
      k: row.kills ?? 0,
      d: row.deaths ?? 0,
      a: row.assists ?? 0,
      cs: row.cs ?? 0,
      visionScore: row.vision_score ?? null,
      endTs: row.matches?.game_end_ts ?? null,
      durationS: row.matches?.game_duration_s ?? null,
      queueId: row.matches?.queue_id ?? null,
      // ✅ NEW: LP and rank snapshot fields
      lp_change: row.lp_change ?? null,
      lp_note: row.lp_note ?? null,
      rank_tier: row.rank_tier ?? null,
      rank_division: row.rank_division ?? null,
      end_type: row.end_type ?? null,
    }))

    return NextResponse.json({ matches: payload })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 })
  }
}
