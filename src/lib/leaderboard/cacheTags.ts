import { revalidateTag } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service'

const LATEST_ACTIVITY_TAG_PREFIX = 'lb-latest-activity'
const MOVERS_TAG_PREFIX = 'lb-movers'

export function latestActivityTag(lbId: string) {
  return `${LATEST_ACTIVITY_TAG_PREFIX}:${lbId}`
}

export function moversTag(lbId: string) {
  return `${MOVERS_TAG_PREFIX}:${lbId}`
}

export function leaderboardCacheTags(lbId: string) {
  return [latestActivityTag(lbId), moversTag(lbId)]
}

export function revalidateLeaderboardCachesById(lbIds: Iterable<string>) {
  const unique = Array.from(new Set(Array.from(lbIds).filter(Boolean)))
  for (const lbId of unique) {
    revalidateTag(latestActivityTag(lbId), 'max')
    revalidateTag(moversTag(lbId), 'max')
  }
}

export async function revalidateLeaderboardCachesForPuuids(puuids: Iterable<string>) {
  const uniquePuuids = Array.from(new Set(Array.from(puuids).filter(Boolean)))
  if (uniquePuuids.length === 0) return

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('leaderboard_players')
    .select('leaderboard_id')
    .in('puuid', uniquePuuids)

  if (error) {
    console.warn('[cache-tags] failed to resolve leaderboard ids by puuid', {
      count: uniquePuuids.length,
      error: error.message,
    })
    return
  }

  const lbIds = (data ?? [])
    .map((row: { leaderboard_id: string | null }) => row.leaderboard_id)
    .filter((id): id is string => Boolean(id))

  revalidateLeaderboardCachesById(lbIds)
}

