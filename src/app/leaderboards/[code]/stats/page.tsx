import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LeaderboardStatsPageBySlug from '@/app/lb/[slug]/stats/page'

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

export default async function LeaderboardStatsPageByCode({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const slug = await resolveSlugFromCode(code)
  return LeaderboardStatsPageBySlug({ params: Promise.resolve({ slug }), fromCodeRoute: true })
}

