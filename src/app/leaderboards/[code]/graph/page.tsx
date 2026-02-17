import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LeaderboardGraphPageBySlug from '@/app/lb/[slug]/graph/page'

async function resolveSlugFromCode(code: string): Promise<string> {
  if (!/^\d{7}$/.test(code)) {
    notFound()
  }

  const supabase = await createClient()
  const { data } = await supabase
    .from('leaderboards')
    .select('slug')
    .eq('leaderboard_code', Number(code))
    .maybeSingle()

  if (!data?.slug) {
    notFound()
  }

  return data.slug
}

export const revalidate = 600

export default async function LeaderboardGraphPageByCode({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const slug = await resolveSlugFromCode(code)
  return LeaderboardGraphPageBySlug({ params: Promise.resolve({ slug }), fromCodeRoute: true })
}

