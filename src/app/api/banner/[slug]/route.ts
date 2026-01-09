import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

const BUCKET = 'leaderboard-banners'

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const supabase = await createClient()
  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, visibility, banner_path, banner_updated_at')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb || !lb.banner_path) {
    return NextResponse.json({ url: null })
  }

  // OPTIMIZATION: Early return for PRIVATE before auth check
  const isPrivate = lb.visibility === 'PRIVATE'

  // auth for PRIVATE
  if (isPrivate) {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) {
      return NextResponse.json({ url: null }, { status: 404 })
    }
  }

  // OPTIMIZATION: Use existing service client instead of creating new one
  const admin = createServiceClient()

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(lb.banner_path, 60 * 60) // 1 hour

  if (error) return NextResponse.json({ url: null }, { status: 500 })

  const res = NextResponse.json({
    url: data.signedUrl,
    updatedAt: lb.banner_updated_at ?? null,
  })

  // Cache public/unlisted responses at the edge
  if (!isPrivate) {
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
  }

  return res
}