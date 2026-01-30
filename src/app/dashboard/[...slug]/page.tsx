import DashboardPage from '../page'

type DashboardSearchParams = {
  delete_confirm?: string
  club_delete_confirm?: string
  section?: string
  lb?: string
}

export default async function DashboardSlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>
  searchParams?: Promise<DashboardSearchParams> | DashboardSearchParams
}) {
  const { slug = [] } = await params
  const sp = await Promise.resolve(searchParams ?? {})

  let section = 'profile'
  let leaderboardId = sp.lb ?? undefined

  if (slug[0] === 'leaderboards') {
    section = 'settings'
    if (slug[1]) leaderboardId = slug[1]
  } else if (slug[0] === 'club') {
    section = 'club'
  } else if (slug[0] === 'billing') {
    section = 'billing'
  } else if (slug[0] === 'profile') {
    section = 'profile'
  }

  return DashboardPage({
    searchParams: {
      ...sp,
      section,
      lb: leaderboardId,
    },
  })
}
