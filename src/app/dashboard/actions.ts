'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function updateBanner(formData: FormData) {
  const bannerUrl = String(formData.get('banner_url') ?? '').trim()

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) redirect('/sign-in')

  // find the user's single leaderboard
  const { data: lb, error: lbErr } = await supabase
    .from('leaderboards')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (lbErr || !lb) redirect('/dashboard')

  const { error: upErr } = await supabase
    .from('leaderboards')
    .update({
      banner_url: bannerUrl.length ? bannerUrl : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lb.id)
    .eq('user_id', user.id)

  if (upErr) {
    // you can console.error(upErr) if you want, but redirect is fine for now
    redirect('/dashboard?edit=1')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?edit=1')
}
