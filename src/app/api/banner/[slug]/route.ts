import { NextResponse } from 'next/server'
import { createClient as createSb } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BUCKET = 'leaderboard-banners'

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

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

  // auth for PRIVATE
  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) {
      return NextResponse.json({ url: null }, { status: 404 })
    }
  }

  const admin = createSb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(lb.banner_path, 60 * 60) // 1 hour

  if (error) return NextResponse.json({ url: null }, { status: 500 })

  const res = NextResponse.json({
    url: data.signedUrl,
    // optional: helps you bust client caches if you add ?v=
    updatedAt: lb.banner_updated_at ?? null,
  })

  // Cache public/unlisted responses at the edge a bit
  if (lb.visibility !== 'PRIVATE') {
    res.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
  }

  return res
}
