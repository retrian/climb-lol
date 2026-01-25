import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid } = await params
    if (!puuid) return NextResponse.json({ error: 'Missing puuid' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const limitParam = searchParams.get('limit')
    const limit = Math.min(Math.max(Number(limitParam ?? 50), 1), 200)

    const supabase = await createClient()

    const seasonStartIso = process.env.NEXT_PUBLIC_SEASON_START || process.env.RANKED_SEASON_START || '2026-01-08T20:00:00.000Z'
    const seasonStartMs = new Date(seasonStartIso).getTime()

    const { data: rows, error } = await supabase
      .from('match_participants')
      .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win, matches!inner(game_end_ts, game_duration_s, queue_id)')
      .eq('puuid', puuid)
      .eq('matches.queue_id', 420)
      .gte('matches.game_end_ts', seasonStartMs)
      .order('game_end_ts', { ascending: false, referencedTable: 'matches' })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const matches = (rows ?? []).map((row: any) => ({
      matchId: row.match_id,
      puuid: row.puuid,
      championId: row.champion_id,
      win: row.win,
      k: row.kills ?? 0,
      d: row.deaths ?? 0,
      a: row.assists ?? 0,
      cs: row.cs ?? 0,
      endTs: row.matches?.game_end_ts ?? null,
      durationS: row.matches?.game_duration_s ?? null,
      queueId: row.matches?.queue_id ?? null,
    }))

    return NextResponse.json({ matches })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch matches' }, { status: 500 })
  }
}
