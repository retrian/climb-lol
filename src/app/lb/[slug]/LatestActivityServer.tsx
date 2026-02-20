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
      <div className="mb-6">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Latest Activity</div>
        <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
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

