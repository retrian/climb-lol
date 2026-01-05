"use client"

import { useMemo, useRef, useState } from 'react'
import { rankScore } from '@/lib/rankSort'
import { formatRank } from '@/lib/rankFormat'

type PlayerSummary = {
  puuid: string
  name: string
  profileIconUrl: string | null
}

type LpPoint = {
  puuid: string
  tier: string | null
  rank: string | null
  lp: number | null
  wins: number | null
  losses: number | null
  fetched_at: string
}

type NormalizedPoint = LpPoint & {
  score: number
  ts: number
}

type FilteredPoint = NormalizedPoint & {
  gameIndex?: number
}

const TIME_OPTIONS = [
  { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '14d', label: '14d', ms: 14 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '12h', label: '12h', ms: 12 * 60 * 60 * 1000 },
  { id: '6h', label: '6h', ms: 6 * 60 * 60 * 1000 },
]

const GAME_OPTIONS = [10, 20, 30, 40, 50]

const TIER_LABELS = [
  'CHALLENGER',
  'GRANDMASTER',
  'MASTER',
  'DIAMOND',
  'EMERALD',
  'PLATINUM',
  'GOLD',
  'SILVER',
  'BRONZE',
  'IRON',
]

function colorFromString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 70% 50%)`
}

type TooltipState = {
  puuid: string
  x: number
  y: number
}

export default function LeaderboardGraphClient({
  players,
  points,
}: {
  players: PlayerSummary[]
  points: LpPoint[]
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = useState<'time' | 'games'>('time')
  const [timeRange, setTimeRange] = useState(TIME_OPTIONS[0].id)
  const [gameCount, setGameCount] = useState(GAME_OPTIONS[0])
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const playersByPuuid = useMemo(() => {
    return new Map(players.map((p) => [p.puuid, p]))
  }, [players])

  const colorByPuuid = useMemo(() => {
    return new Map(players.map((p) => [p.puuid, colorFromString(p.puuid)]))
  }, [players])

  const normalizedPoints = useMemo<NormalizedPoint[]>(() => {
    return points
      .map((p) => {
        const score = rankScore({
          tier: p.tier ?? undefined,
          rank: p.rank ?? undefined,
          league_points: p.lp ?? 0,
        })
        return {
          ...p,
          score,
          ts: new Date(p.fetched_at).getTime(),
        }
      })
      .filter((p) => !Number.isNaN(p.ts))
  }, [points])

  const filteredPoints = useMemo<FilteredPoint[]>(() => {
    if (mode === 'time') {
      const option = TIME_OPTIONS.find((o) => o.id === timeRange) ?? TIME_OPTIONS[0]
      const cutoff = Date.now() - option.ms
      return normalizedPoints.filter((p) => p.ts >= cutoff)
    }

    const byPlayer = new Map<string, NormalizedPoint[]>()
    for (const point of normalizedPoints) {
      const list = byPlayer.get(point.puuid) ?? []
      list.push(point)
      byPlayer.set(point.puuid, list)
    }
    const clipped: FilteredPoint[] = []
    for (const [puuid, list] of byPlayer.entries()) {
      const sorted = [...list].sort((a, b) => a.ts - b.ts)
      const slice = sorted.slice(-gameCount)
      clipped.push(...slice.map((item, index) => ({ ...item, gameIndex: index })))
    }
    return clipped
  }, [mode, timeRange, gameCount, normalizedPoints])

  const series = useMemo(() => {
    const byPlayer = new Map<string, FilteredPoint[]>()
    for (const point of filteredPoints) {
      const list = byPlayer.get(point.puuid) ?? []
      list.push(point)
      byPlayer.set(point.puuid, list)
    }
    for (const [puuid, list] of byPlayer.entries()) {
      list.sort((a, b) => (mode === 'time' ? a.ts - b.ts : a.gameIndex - b.gameIndex))
      byPlayer.set(puuid, list)
    }
    return byPlayer
  }, [filteredPoints, mode])

  const chart = useMemo(() => {
    const allPoints = [...series.values()].flat()
    if (allPoints.length === 0) {
      return null
    }

    const scores = allPoints.map((p) => p.score)
    const minScore = Math.min(...scores)
    const maxScore = Math.max(...scores)
    const scoreRange = maxScore - minScore || 1

    const xValues = allPoints.map((p) => (mode === 'time' ? p.ts : p.gameIndex ?? 0))
    const minX = Math.min(...xValues)
    const maxX = Math.max(...xValues)
    const xRange = maxX - minX || 1

    return { minScore, maxScore, scoreRange, minX, maxX, xRange }
  }, [series, mode])

  const width = 960
  const height = 420
  const padding = { top: 30, right: 30, bottom: 50, left: 70 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const axisLabels = useMemo(() => {
    if (!chart) return []
    return TIER_LABELS.map((tier) => {
      const score = rankScore({ tier, rank: 'IV', league_points: 0 })
      if (score < chart.minScore || score > chart.maxScore) return null
      const y =
        padding.top +
        innerHeight -
        ((score - chart.minScore) / chart.scoreRange) * innerHeight
      return { tier, y }
    }).filter(Boolean) as Array<{ tier: string; y: number }>
  }, [chart, innerHeight, padding.top])

  const xLabel = mode === 'time' ? 'Time' : 'Games'
  const xStartLabel =
    mode === 'time' && chart
      ? new Date(chart.minX).toLocaleDateString()
      : 'Oldest'
  const xEndLabel =
    mode === 'time' && chart
      ? new Date(chart.maxX).toLocaleDateString()
      : 'Latest'

  const handleHover = (puuid: string, clientX: number, clientY: number) => {
    const container = containerRef.current?.getBoundingClientRect()
    if (!container) return
    setTooltip({
      puuid,
      x: clientX - container.left,
      y: clientY - container.top,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setMode('time')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              mode === 'time'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            Time
          </button>
          <button
            type="button"
            onClick={() => setMode('games')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              mode === 'games'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            Games
          </button>
        </div>

        {mode === 'time' ? (
          <div className="flex flex-wrap gap-2">
            {TIME_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setTimeRange(option.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  timeRange === option.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {GAME_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setGameCount(count)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  gameCount === count
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {count} games
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={containerRef} className="relative rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {chart ? (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
              <rect
                x={padding.left}
                y={padding.top}
                width={innerWidth}
                height={innerHeight}
                className="fill-slate-50 dark:fill-slate-950"
                rx={16}
              />

              {axisLabels.map((label) => (
                <g key={label.tier}>
                  <line
                    x1={padding.left}
                    x2={width - padding.right}
                    y1={label.y}
                    y2={label.y}
                    stroke="currentColor"
                    className="text-slate-200 dark:text-slate-800"
                    strokeDasharray="4 6"
                  />
                  <text
                    x={padding.left - 12}
                    y={label.y + 4}
                    textAnchor="end"
                    className="fill-slate-400 text-[10px] font-semibold uppercase tracking-wide"
                  >
                    {label.tier[0] + label.tier.slice(1).toLowerCase()}
                  </text>
                </g>
              ))}

              {[...series.entries()].map(([puuid, list]) => {
                if (list.length === 0) return null
                const color = colorByPuuid.get(puuid) ?? 'hsl(210 80% 50%)'
                const path = list
                  .map((point, idx) => {
                    const xValue = mode === 'time' ? point.ts : point.gameIndex ?? idx
                    const x =
                      padding.left + ((xValue - chart.minX) / chart.xRange) * innerWidth
                    const y =
                      padding.top +
                      innerHeight -
                      ((point.score - chart.minScore) / chart.scoreRange) * innerHeight
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
                  })
                  .join(' ')

                const lastPoint = list[list.length - 1]
                const lastXValue = mode === 'time' ? lastPoint.ts : lastPoint.gameIndex ?? list.length - 1
                const lastX =
                  padding.left + ((lastXValue - chart.minX) / chart.xRange) * innerWidth
                const lastY =
                  padding.top +
                  innerHeight -
                  ((lastPoint.score - chart.minScore) / chart.scoreRange) * innerHeight

                return (
                  <g key={puuid}>
                    <path d={path} fill="none" stroke={color} strokeWidth={2.5} opacity={0.9} />
                    <circle
                      cx={lastX}
                      cy={lastY}
                      r={5}
                      fill={color}
                      stroke="white"
                      strokeWidth={2}
                      onMouseEnter={(event) => handleHover(puuid, event.clientX, event.clientY)}
                      onMouseMove={(event) => handleHover(puuid, event.clientX, event.clientY)}
                      onMouseLeave={() => setTooltip(null)}
                      className="cursor-pointer"
                    />
                  </g>
                )
              })}

              <text
                x={padding.left}
                y={height - 18}
                textAnchor="start"
                className="fill-slate-400 text-[11px] font-semibold"
              >
                {xStartLabel}
              </text>
              <text
                x={width - padding.right}
                y={height - 18}
                textAnchor="end"
                className="fill-slate-400 text-[11px] font-semibold"
              >
                {xEndLabel}
              </text>
              <text
                x={width / 2}
                y={height - 10}
                textAnchor="middle"
                className="fill-slate-500 text-[11px] font-semibold uppercase tracking-wide"
              >
                {xLabel}
              </text>
            </svg>

            <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
              {[...series.keys()].map((puuid) => {
                const player = playersByPuuid.get(puuid)
                if (!player) return null
                return (
                  <div key={puuid} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 dark:border-slate-700 dark:bg-slate-900">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: colorByPuuid.get(puuid) }}
                    />
                    <span className="font-semibold">{player.name}</span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            No ranking history yet for this range.
          </div>
        )}

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={{ left: tooltip.x, top: tooltip.y - 10 }}
          >
            {(() => {
              const player = playersByPuuid.get(tooltip.puuid)
              const seriesPoints = series.get(tooltip.puuid) ?? []
              const lastPoint = seriesPoints[seriesPoints.length - 1]
              return (
                <div className="flex items-center gap-2">
                  {player?.profileIconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={player.profileIconUrl} alt="" className="h-8 w-8 rounded-full border border-slate-200" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-slate-200" />
                  )}
                  <div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">{player?.name ?? 'Player'}</div>
                    {lastPoint ? (
                      <div className="text-[11px] text-slate-500 dark:text-slate-300">
                        {formatRank(lastPoint.tier, lastPoint.rank, lastPoint.lp)}
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
