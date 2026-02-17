import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import LeaderboardPageBySlug, { generateMetadata as generateMetadataBySlug } from '@/app/lb/[slug]/page'

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

export const revalidate = 30

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const slug = await resolveSlugFromCode(code)
  return generateMetadataBySlug({ params: Promise.resolve({ slug }) })
}

export default async function LeaderboardPageByCode({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const slug = await resolveSlugFromCode(code)
  return LeaderboardPageBySlug({ params: Promise.resolve({ slug }), fromCodeRoute: true })
}

