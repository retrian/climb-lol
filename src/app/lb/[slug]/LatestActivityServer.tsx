import LatestGamesFeedClient from './LatestGamesFeedClient'
import { getLatestActivityDataCached } from '@/lib/leaderboard/latestGames'

export default async function LatestActivityServer({
  lbId,
  ddVersion,
}: {
  lbId: string
  ddVersion: string
}) {
  const data = await getLatestActivityDataCached(lbId, ddVersion)

  return (
    <aside className="lg:sticky lg:top-6 order-2 lg:order-1">
      <div className="flex items-center gap-2 mb-6">
        <div className="h-1 w-8 bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600 rounded-full shadow-sm" />
        <h3 className="text-xs font-black uppercase tracking-widest text-slate-600 dark:text-slate-300">Latest Activity</h3>
      </div>
      <LatestGamesFeedClient
        lbId={lbId}
        ddVersion={ddVersion}
        initialGames={data.latestGames}
        playersByPuuid={data.playersByPuuidRecord}
        champMap={data.champMap}
        rankByPuuid={data.rankByPuuidRecord}
        playerIconsByPuuid={data.playerIconsByPuuidRecord}
        participantsByMatch={data.participantsByMatchRecord}
        preloadedMatchData={data.preloadedMatchDataRecord}
      />
    </aside>
  )
}

