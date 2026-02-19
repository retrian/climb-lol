import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getLatestGamesFresh } from '@/lib/leaderboard/latestGames'

const DEFAULT_DDRAGON_VERSION = '15.24.1'

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'Missing leaderboard id' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: leaderboard } = await supabase
      .from('leaderboards')
      .select('id, user_id, visibility')
      .eq('id', id)
      .maybeSingle()

    if (!leaderboard) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const visibility = leaderboard.visibility as Visibility
    if (visibility === 'PRIVATE') {
      const { data: auth } = await supabase.auth.getUser()
      const user = auth.user
      if (!user || user.id !== leaderboard.user_id) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
    }

    const { searchParams } = new URL(req.url)
    const requestedVersion = searchParams.get('ddVersion')?.trim()
    const ddVersion = requestedVersion || process.env.NEXT_PUBLIC_DDRAGON_VERSION || DEFAULT_DDRAGON_VERSION

    const games = await getLatestGamesFresh(id, ddVersion)
    const response = NextResponse.json({ games })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    console.error('[latest-games route] error:', error)
    return NextResponse.json({ error: 'Failed to fetch latest games' }, { status: 500 })
  }
}

