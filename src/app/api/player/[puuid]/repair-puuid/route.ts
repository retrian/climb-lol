import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { resolvePuuid } from '@/lib/riot/resolvePuuid'
import { revalidateLeaderboardCachesForPuuids } from '@/lib/leaderboard/cacheTags'

type RepairBody = {
  gameName?: string
  tagLine?: string
  candidatePuuid?: string
}

async function migrateMatchParticipantsPuuid(oldPuuid: string, newPuuid: string) {
  const service = createServiceClient()

  const { error: firstUpdateError } = await service
    .from('match_participants')
    .update({ puuid: newPuuid })
    .eq('puuid', oldPuuid)

  if (!firstUpdateError) return

  const msg = firstUpdateError.message?.toLowerCase() ?? ''
  const isConflict = msg.includes('duplicate key') || msg.includes('unique constraint')
  if (!isConflict) {
    throw new Error(`[PUUID Repair] match_participants: ${firstUpdateError.message}`)
  }

  const [oldRowsRes, newRowsRes] = await Promise.all([
    service.from('match_participants').select('match_id').eq('puuid', oldPuuid),
    service.from('match_participants').select('match_id').eq('puuid', newPuuid),
  ])

  if (oldRowsRes.error) {
    throw new Error(`[PUUID Repair] match_participants old select: ${oldRowsRes.error.message}`)
  }
  if (newRowsRes.error) {
    throw new Error(`[PUUID Repair] match_participants new select: ${newRowsRes.error.message}`)
  }

  const newMatchIds = new Set((newRowsRes.data ?? []).map((r: any) => String(r.match_id)))
  const overlappingMatchIds = (oldRowsRes.data ?? [])
    .map((r: any) => String(r.match_id))
    .filter((id: string) => newMatchIds.has(id))

  if (overlappingMatchIds.length > 0) {
    const { error: deleteError } = await service
      .from('match_participants')
      .delete()
      .eq('puuid', oldPuuid)
      .in('match_id', overlappingMatchIds)

    if (deleteError) {
      throw new Error(`[PUUID Repair] match_participants overlap delete: ${deleteError.message}`)
    }
  }

  const { error: retryUpdateError } = await service
    .from('match_participants')
    .update({ puuid: newPuuid })
    .eq('puuid', oldPuuid)

  if (retryUpdateError) {
    throw new Error(`[PUUID Repair] match_participants retry: ${retryUpdateError.message}`)
  }
}

async function resolveRiotIdFromDb(oldPuuid: string) {
  const service = createServiceClient()

  const [playersRes, leaderboardRes, clubRes] = await Promise.all([
    service
      .from('players')
      .select('game_name, tag_line')
      .eq('puuid', oldPuuid)
      .maybeSingle(),
    service
      .from('leaderboard_players')
      .select('game_name, tag_line')
      .eq('puuid', oldPuuid)
      .maybeSingle(),
    service
      .from('club_members')
      .select('game_name, tag_line')
      .eq('player_puuid', oldPuuid)
      .maybeSingle(),
  ])

  const rows = [playersRes.data, leaderboardRes.data, clubRes.data]
  for (const row of rows) {
    const gameName = row?.game_name?.trim()
    const tagLine = row?.tag_line?.trim()
    if (gameName && tagLine) {
      return { gameName, tagLine }
    }
  }

  return null
}

async function migratePuuid(oldPuuid: string, newPuuid: string) {
  const service = createServiceClient()

  await migrateMatchParticipantsPuuid(oldPuuid, newPuuid)

  const updates: Array<{ table: string; column: string }> = [
    { table: 'players', column: 'puuid' },
    { table: 'club_members', column: 'player_puuid' },
    { table: 'leaderboard_players', column: 'puuid' },
    { table: 'player_lp_events', column: 'puuid' },
    { table: 'player_lp_history', column: 'puuid' },
    { table: 'player_rank_history', column: 'puuid' },
    { table: 'player_rank_snapshot', column: 'puuid' },
    { table: 'player_riot_state', column: 'puuid' },
    { table: 'player_top_champions', column: 'puuid' },
    { table: 'player_top_champions_snapshot', column: 'puuid' },
  ]

  for (const target of updates) {
    const { error } = await service
      .from(target.table)
      .update({ [target.column]: newPuuid })
      .eq(target.column, oldPuuid)

    if (error) {
      throw new Error(`[PUUID Repair] ${target.table}: ${error.message}`)
    }
  }

  const { error: mappingError } = await service
    .from('puuid_migration_map')
    .upsert({ old_puuid: oldPuuid, new_puuid: newPuuid }, { onConflict: 'old_puuid' })

  if (mappingError) {
    console.warn('[PUUID Repair] mapping upsert failed:', mappingError.message)
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ puuid: string }> }) {
  try {
    const { puuid: oldPuuid } = await params
    if (!oldPuuid) {
      return NextResponse.json({ error: 'Missing puuid' }, { status: 400 })
    }

    const body = (await req.json().catch(() => null)) as RepairBody | null
    let gameName = body?.gameName?.trim() ?? ''
    let tagLine = body?.tagLine?.trim() ?? ''
    const candidatePuuid = body?.candidatePuuid?.trim() ?? ''

    if (!gameName || !tagLine) {
      const fromDb = await resolveRiotIdFromDb(oldPuuid)
      if (fromDb) {
        gameName = fromDb.gameName
        tagLine = fromDb.tagLine
      }
    }

    if (!gameName || !tagLine) {
      return NextResponse.json(
        { error: 'Missing Riot ID (gameName/tagLine) for this player' },
        { status: 400 }
      )
    }

    const newPuuid = candidatePuuid || (await resolvePuuid(gameName, tagLine))

    if (!newPuuid || newPuuid === oldPuuid) {
      return NextResponse.json({
        updated: false,
        oldPuuid,
        newPuuid: oldPuuid,
        reason: candidatePuuid
          ? 'Candidate PUUID matched existing PUUID'
          : 'No updated PUUID returned by Riot for this Riot ID',
      })
    }

    await migratePuuid(oldPuuid, newPuuid)
    await revalidateLeaderboardCachesForPuuids([oldPuuid, newPuuid])

    return NextResponse.json({
      updated: true,
      oldPuuid,
      newPuuid,
      gameName,
      tagLine,
    })
  } catch (error) {
    console.error('[PUUID Repair API]', error)
    const message = error instanceof Error ? error.message : 'Failed to repair puuid'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

