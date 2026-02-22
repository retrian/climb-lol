import { getMoversDataCached } from '@/lib/leaderboard/movers'
import MoversClient from './MoversClient'

export default async function MoversServer({
  lbId,
  ddVersion,
  cutoffs,
}: {
  lbId: string
  ddVersion: string
  cutoffs: Array<{ label: string; lp: number; icon: string }>
}) {
  const data = await getMoversDataCached(lbId)
  return <MoversClient lbId={lbId} ddVersion={ddVersion} cutoffs={cutoffs} initialMovers={data} />
}

