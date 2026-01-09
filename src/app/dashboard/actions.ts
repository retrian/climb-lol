'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function updateBanner(formData: FormData) {
  const bannerUrl = String(formData.get('banner_url') ?? '').trim()

  const supabase = await createClient()

  const [{ data: auth }, { data: lb, error: lbErr }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from('leaderboards')
      .select('id')
      .limit(1)
      .maybeSingle()
  ])

  const user = auth.user
  if (!user) redirect('/sign-in')
  
  if (lbErr || !lb) redirect('/dashboard')

  const { error: upErr } = await supabase
    .from('leaderboards')
    .update({
      banner_url: bannerUrl.length ? bannerUrl : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lb.id)

  if (upErr) {
    console.error('[updateBanner] Error:', upErr.message)
    redirect('/dashboard?edit=1&error=update_failed')
  }

  revalidatePath('/dashboard')
  redirect('/dashboard?edit=1')
}