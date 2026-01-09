import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const BUCKET = 'leaderboard-banners'
const MAX_MB = 4

function extFromType(type: string) {
  if (type === 'image/png') return 'png'
  if (type === 'image/webp') return 'webp'
  if (type === 'image/jpeg') return 'jpg'
  return null
}

export async function POST(req: Request) {
  const supabase = await createClient()

  // OPTIMIZATION: Parse form data first (fast operation)
  const form = await req.formData()
  const leaderboardId = String(form.get('leaderboardId') ?? '')
  const file = form.get('file')

  // OPTIMIZATION: Validate inputs before expensive auth/db operations
  if (!leaderboardId) return NextResponse.json({ error: 'Missing leaderboardId' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

  const ext = extFromType(file.type)
  if (!ext) {
    return NextResponse.json({ error: 'Invalid file type (png/jpg/webp only)' }, { status: 400 })
  }

  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File too large (max ${MAX_MB}MB)` }, { status: 400 })
  }

  // OPTIMIZATION: Now do auth + leaderboard fetch in parallel
  const [{ data: auth, error: authErr }, { data: lb, error: lbErr }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('leaderboards')
      .select('id, user_id')
      .eq('id', leaderboardId)
      .maybeSingle()
  ])

  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 401 })
  const user = auth.user
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (lbErr) return NextResponse.json({ error: `leaderboards: ${lbErr.message}` }, { status: 500 })
  if (!lb) return NextResponse.json({ error: 'Leaderboard not found' }, { status: 404 })
  if (lb.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Storage object path must include user.id as first folder
  const path = `${user.id}/${leaderboardId}/banner.${ext}`

  // Upload (overwrite)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true })

  if (upErr) return NextResponse.json({ error: `storage: ${upErr.message}` }, { status: 500 })

  // Update DB pointer (+ cache buster)
  const { error: updErr } = await supabase
    .from('leaderboards')
    .update({
      banner_path: path,
      banner_updated_at: new Date().toISOString(),
    })
    .eq('id', leaderboardId)

  if (updErr) return NextResponse.json({ error: `leaderboards update: ${updErr.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, banner_path: path })
}