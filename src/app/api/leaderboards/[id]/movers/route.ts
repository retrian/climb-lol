import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMoversDataFresh } from '@/lib/leaderboard/movers'

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const movers = await getMoversDataFresh(id)
    const response = NextResponse.json({ movers })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (error) {
    console.error('[movers route] error:', error)
    return NextResponse.json({ error: 'Failed to fetch movers' }, { status: 500 })
  }
}

