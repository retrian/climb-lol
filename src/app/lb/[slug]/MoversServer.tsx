import { getMoversDataCached } from '@/lib/leaderboard/movers'

interface Player {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
}

function LpChangePill({ lpChange }: { lpChange: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums ${
        lpChange === 0
          ? 'text-slate-500 bg-slate-100 dark:text-slate-300 dark:bg-slate-700/50'
          : lpChange > 0
            ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/20'
            : 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/20'
      }`}
    >
      {lpChange === 0 ? (
        '— 0 LP'
      ) : (
        <>
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            {lpChange > 0 ? <path d="M10 4l6 8H4l6-8z" /> : <path d="M10 16l-6-8h12l-6 8z" />}
          </svg>
          {Math.abs(lpChange)} LP
        </>
      )}
    </span>
  )
}

function MoverCard({
  puuid,
  lpDelta,
  timeframeLabel,
  borderTone,
  playersByPuuid,
  playerIconsByPuuid,
  ddVersion,
}: {
  puuid: string
  lpDelta: number
  timeframeLabel: string
  borderTone: 'emerald' | 'rose' | 'amber'
  playersByPuuid: Record<string, Player>
  playerIconsByPuuid: Record<string, number | null>
  ddVersion: string
}) {
  const player = playersByPuuid[puuid]
  const iconId = playerIconsByPuuid[puuid]
  const iconSrc = iconId ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${iconId}.png` : null
  const displayId = player ? (player.game_name ?? 'Unknown').trim() : 'Unknown Player'

  const borderClass =
    borderTone === 'emerald'
      ? 'border-slate-200 dark:border-slate-800 border-l-emerald-400 dark:border-l-emerald-500/70'
      : borderTone === 'rose'
        ? 'border-slate-200 dark:border-slate-800 border-l-rose-400 dark:border-l-rose-500/70'
        : 'border-slate-200 dark:border-slate-800 border-l-amber-400 dark:border-l-amber-500/70'

  return (
    <a
      href="#"
      data-open-pmh={puuid}
      className={`block rounded-xl border-l-4 border-y border-r bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:bg-slate-900 ${borderClass}`}
    >
      <div className="group w-full text-left">
        <div className="flex items-center gap-3">
          {iconSrc ? (
            <div className="relative h-11 w-11 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={iconSrc} alt="" width={44} height={44} loading="lazy" className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800" />
            </div>
          ) : null}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                <span className="truncate">{displayId}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">{timeframeLabel}</span>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300" />
              <LpChangePill lpChange={lpDelta} />
            </div>
          </div>
        </div>
      </div>
    </a>
  )
}

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

  const orderedCutoffs = [
    cutoffs.find((c) => c.label.toLowerCase() === 'challenger'),
    cutoffs.find((c) => c.label.toLowerCase() === 'grandmaster'),
  ].filter((c): c is { label: string; lp: number; icon: string } => Boolean(c))

  return (
    <aside className="hidden lg:block lg:sticky lg:top-6 order-3">
      <div className="space-y-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Cutoffs</div>
          <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
        </div>

        {orderedCutoffs.length > 0 ? (
          orderedCutoffs.map((cutoff) => {
            const isChallenger = cutoff.label.toLowerCase() === 'challenger'
            const isGrandmaster = cutoff.label.toLowerCase() === 'grandmaster'
            const cutoffBorderClass = isChallenger
              ? 'border-l-4 border-l-amber-400 border-amber-100 dark:border-amber-500/40'
              : isGrandmaster
                ? 'border-l-4 border-l-rose-400 border-rose-100 dark:border-rose-500/40'
                : 'border border-slate-200 dark:border-slate-800'

            return (
              <div
                key={cutoff.label}
                className={`rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-slate-900 ${cutoffBorderClass}`}
              >
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cutoff.icon} alt={cutoff.label} width={28} height={28} className="h-7 w-7 object-contain" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{cutoff.label}</div>
                  <div className="text-sm font-black text-slate-900 dark:text-slate-100">{cutoff.lp} LP</div>
                </div>
              </div>
              </div>
            )
          })
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No cutoff data available.
          </div>
        )}

        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Daily Movers</div>
          <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
        </div>
        {data.dailyTopGain ? (() => {
          const lpDelta = Math.round(data.dailyTopGain[1])
          return (
            <MoverCard
              puuid={data.dailyTopGain[0]}
              lpDelta={lpDelta}
              timeframeLabel="24 hours"
              borderTone="emerald"
              playersByPuuid={data.playersByPuuidRecord}
              playerIconsByPuuid={data.playerIconsByPuuidRecord}
              ddVersion={ddVersion}
            />
          )
        })() : (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No one has gained any LP today yet.
          </div>
        )}

        {data.resolvedTopLoss ? (() => {
          const isLoss = data.resolvedTopLoss[1] < 0
          const lpDelta = Math.round(data.resolvedTopLoss[1])
          return (
            <MoverCard
              puuid={data.resolvedTopLoss[0]}
              lpDelta={lpDelta}
              timeframeLabel="24 hours"
              borderTone={isLoss ? 'rose' : 'amber'}
              playersByPuuid={data.playersByPuuidRecord}
              playerIconsByPuuid={data.playerIconsByPuuidRecord}
              ddVersion={ddVersion}
            />
          )
        })() : null}

        <div className="pt-2">
          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Weekly Movers</div>
          <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
        </div>

        {data.weeklyTopGain ? (() => {
          const lpDelta = Math.round(data.weeklyTopGain[1])
          return (
            <MoverCard
              puuid={data.weeklyTopGain[0]}
              lpDelta={lpDelta}
              timeframeLabel="7 days"
              borderTone="emerald"
              playersByPuuid={data.playersByPuuidRecord}
              playerIconsByPuuid={data.playerIconsByPuuidRecord}
              ddVersion={ddVersion}
            />
          )
        })() : (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-xs font-semibold text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No weekly LP changes yet.
          </div>
        )}

        {data.resolvedWeeklyTopLoss ? (() => {
          const isLoss = data.resolvedWeeklyTopLoss[1] < 0
          const lpDelta = Math.round(data.resolvedWeeklyTopLoss[1])
          return (
            <MoverCard
              puuid={data.resolvedWeeklyTopLoss[0]}
              lpDelta={lpDelta}
              timeframeLabel="7 days"
              borderTone={isLoss ? 'rose' : 'amber'}
              playersByPuuid={data.playersByPuuidRecord}
              playerIconsByPuuid={data.playerIconsByPuuidRecord}
              ddVersion={ddVersion}
            />
          )
        })() : null}

      </div>
    </aside>
  )
}

