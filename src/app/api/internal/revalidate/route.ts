import { NextResponse } from 'next/server'
import { revalidateLeaderboardCachesById } from '@/lib/leaderboard/cacheTags'

type RevalidateBody = {
  lbIds?: unknown
}

export async function POST(req: Request) {
  const expectedSecret = process.env.INTERNAL_REVALIDATE_SECRET?.trim()
  if (!expectedSecret) {
    return NextResponse.json({ error: 'Missing INTERNAL_REVALIDATE_SECRET' }, { status: 500 })
  }

  const providedSecret = req.headers.get('x-internal-secret')?.trim()
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as RevalidateBody | null
  const lbIds = Array.isArray(body?.lbIds)
    ? body!.lbIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    : []

  if (lbIds.length === 0) {
    return NextResponse.json({ error: 'lbIds required' }, { status: 400 })
  }

  const uniqueLbIds = Array.from(new Set(lbIds))
  revalidateLeaderboardCachesById(uniqueLbIds)

  return NextResponse.json({ ok: true, revalidated: uniqueLbIds, count: uniqueLbIds.length })
}

