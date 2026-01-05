"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
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

type RankCutoffs = {
  grandmaster: number
  challenger: number
}

type NormalizedPoint = LpPoint & {
  score: number
  ts: number
}

type FilteredPoint = NormalizedPoint

const TIME_OPTIONS = [
  { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '14d', label: '14d', ms: 14 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '12h', label: '12h', ms: 12 * 60 * 60 * 1000 },
  { id: '6h', label: '6h', ms: 6 * 60 * 60 * 1000 },
]

const RANGE_SUMMARIES = [
  { id: 'day', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'month', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
]

const ZOOM_LEVELS = [1, 2, 3, 4]

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

const TIER_WEIGHT: Record<string, number> = {
  CHALLENGER: 10,
  GRANDMASTER: 9,
  MASTER: 8,
  DIAMOND: 7,
  EMERALD: 6,
  PLATINUM: 5,
  GOLD: 4,
  SILVER: 3,
  BRONZE: 2,
  IRON: 1,
}

const DIVISION_WEIGHT: Record<string, number> = {
  I: 4,
  II: 3,
  III: 2,
  IV: 1,
}

const SCORE_STEPS = {
  tier: 1_000_000,
  division: 50_000,
  lp: 1_000,
}

function rankScoreWithCutoffs(
  point: Pick<LpPoint, 'tier' | 'rank' | 'lp'>,
  cutoffs: RankCutoffs
) {
  const tier = point.tier?.toUpperCase?.() ?? ''
  const division = point.rank?.toUpperCase?.() ?? ''
  const lp = point.lp ?? 0

  const tierWeight = TIER_WEIGHT[tier] ?? 0
  const divisionWeight = DIVISION_WEIGHT[division] ?? 0

  if (tier === 'MASTER') {
    const cappedLp = Math.min(lp, Math.max(0, cutoffs.grandmaster - 1))
    return tierWeight * SCORE_STEPS.tier + cappedLp * SCORE_STEPS.lp
  }

  if (tier === 'GRANDMASTER') {
    return TIER_WEIGHT.MASTER * SCORE_STEPS.tier + (cutoffs.grandmaster + lp) * SCORE_STEPS.lp
  }

  if (tier === 'CHALLENGER') {
    return TIER_WEIGHT.MASTER * SCORE_STEPS.tier + (cutoffs.challenger + lp) * SCORE_STEPS.lp
  }

  return tierWeight * SCORE_STEPS.tier + divisionWeight * SCORE_STEPS.division + lp * SCORE_STEPS.lp
}

function colorFromString(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 70% 50%)`
}

function formatDelta(delta: number) {
  const rounded = Math.round(delta)
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

type TooltipState = {
  puuid: string
  x: number
  y: number
}

export default function LeaderboardGraphClient({
  players,
  points,
  cutoffs,
}: {
  players: PlayerSummary[]
  points: LpPoint[]
  cutoffs: RankCutoffs
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [timeRange, setTimeRange] = useState(TIME_OPTIONS[0].id)
  const [zoom, setZoom] = useState(1)
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
        const score = rankScoreWithCutoffs(p, cutoffs)
        return {
          ...p,
          score,
          ts: new Date(p.fetched_at).getTime(),
        }
      })
      .filter((p) => !Number.isNaN(p.ts))
  }, [cutoffs, points])

  const availability = useMemo(() => {
    const byPlayer = new Map<string, NormalizedPoint[]>()
    for (const point of normalizedPoints) {
      const list = byPlayer.get(point.puuid) ?? []
      list.push(point)
      byPlayer.set(point.puuid, list)
    }

    const timeAvailability = new Map<string, boolean>()
    for (const option of TIME_OPTIONS) {
      const cutoff = Date.now() - option.ms
      let hasEnough = false
      for (const list of byPlayer.values()) {
        const count = list.filter((p) => p.ts >= cutoff).length
        if (count >= 2) {
          hasEnough = true
          break
        }
      }
      timeAvailability.set(option.id, hasEnough)
    }

    return { timeAvailability }
  }, [normalizedPoints])

  useEffect(() => {
    if (!availability.timeAvailability.get(timeRange)) {
      const fallback = TIME_OPTIONS.find((option) => availability.timeAvailability.get(option.id))
      if (fallback) setTimeRange(fallback.id)
    }
  }, [availability, timeRange])

  const filteredPoints = useMemo<FilteredPoint[]>(() => {
    const option = TIME_OPTIONS.find((o) => o.id === timeRange) ?? TIME_OPTIONS[0]
    const cutoff = Date.now() - option.ms
    return normalizedPoints.filter((p) => p.ts >= cutoff)
  }, [timeRange, normalizedPoints])

  const zoomedPoints = useMemo<FilteredPoint[]>(() => {
    if (filteredPoints.length === 0 || zoom === 1) return filteredPoints
    const xValues = filteredPoints.map((p) => p.ts)
    const minX = Math.min(...xValues)
    const maxX = Math.max(...xValues)
    const range = maxX - minX || 1
    const windowSize = range / zoom
    const windowStart = maxX - windowSize
    return filteredPoints.filter((p) => {
      return p.ts >= windowStart
    })
  }, [filteredPoints, zoom])

  const series = useMemo(() => {
    const byPlayer = new Map<string, FilteredPoint[]>()
    for (const point of zoomedPoints) {
      const list = byPlayer.get(point.puuid) ?? []
      list.push(point)
      byPlayer.set(point.puuid, list)
    }
    for (const [puuid, list] of byPlayer.entries()) {
      list.sort((a, b) => a.ts - b.ts)
      byPlayer.set(puuid, list)
    }
    return byPlayer
  }, [zoomedPoints])

  const rangeStats = useMemo(() => {
    const byPlayer = new Map<string, NormalizedPoint[]>()
    for (const point of normalizedPoints) {
      const list = byPlayer.get(point.puuid) ?? []
      list.push(point)
      byPlayer.set(point.puuid, list)
    }

    return RANGE_SUMMARIES.map((range) => {
      const cutoff = Date.now() - range.ms
      let bestGain: { puuid: string; delta: number; start: NormalizedPoint; end: NormalizedPoint } | null = null
      let bestLoss: { puuid: string; delta: number; start: NormalizedPoint; end: NormalizedPoint } | null = null

      for (const [puuid, list] of byPlayer.entries()) {
        const windowed = list.filter((p) => p.ts >= cutoff).sort((a, b) => a.ts - b.ts)
        if (windowed.length < 2) continue
        const start = windowed[0]
        const end = windowed[windowed.length - 1]
        const delta = end.score - start.score

        if (!bestGain || delta > bestGain.delta) {
          bestGain = { puuid, delta, start, end }
        }

        if (delta < 0 && (!bestLoss || delta < bestLoss.delta)) {
          bestLoss = { puuid, delta, start, end }
        }
      }

      return { range, bestGain, bestLoss }
    })
  }, [normalizedPoints])

  const chart = useMemo(() => {
    const allPoints = [...series.values()].flat()
    if (allPoints.length === 0) {
      return null
    }

    const scores = allPoints.map((p) => p.score)
    const minScore = Math.min(...scores)
    const maxScore = Math.max(...scores)
    const scoreRange = maxScore - minScore || 1

    const xValues = allPoints.map((p) => p.ts)
    const minX = Math.min(...xValues)
    const maxX = Math.max(...xValues)
    const xRange = maxX - minX || 1

    return { minScore, maxScore, scoreRange, minX, maxX, xRange }
  }, [series])

  const width = 960
  const height = 420
  const padding = { top: 30, right: 30, bottom: 50, left: 70 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const axisLabels = useMemo(() => {
    if (!chart) return []
    return TIER_LABELS.map((tier) => {
      const score = rankScoreWithCutoffs({ tier, rank: 'IV', lp: 0 }, cutoffs)
      if (score < chart.minScore || score > chart.maxScore) return null
      const y =
        padding.top +
        innerHeight -
        ((score - chart.minScore) / chart.scoreRange) * innerHeight
      return { tier, y }
    }).filter(Boolean) as Array<{ tier: string; y: number }>
  }, [chart, cutoffs, innerHeight, padding.top])

  const xTicks = useMemo(() => {
    if (!chart) return []
    const count = 5
    const step = chart.xRange / (count - 1)
    const rangeMs = chart.xRange
    return Array.from({ length: count }, (_, idx) => {
      const value = chart.minX + step * idx
      const date = new Date(value)
      let label = date.toLocaleDateString()
      if (rangeMs <= 12 * 60 * 60 * 1000) {
        label = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      } else if (rangeMs <= 3 * 24 * 60 * 60 * 1000) {
        label =
          date.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
          ' ' +
          date.toLocaleTimeString([], { hour: 'numeric' })
      } else if (rangeMs <= 10 * 24 * 60 * 60 * 1000) {
        label = date.toLocaleDateString([], { weekday: 'short' })
      } else if (rangeMs <= 14 * 24 * 60 * 60 * 1000) {
        label = date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      } else {
        label = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
      }
      const x = padding.left + ((value - chart.minX) / chart.xRange) * innerWidth
      return { x, label }
    })
  }, [chart, innerWidth, padding.left])

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
      <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-4 shadow-sm backdrop-blur dark:border-slate-800/70 dark:bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Filters
            </p>
            <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">
              Choose a window to compare rank movement.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Zoom</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
              step={1}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="h-2 w-32 cursor-pointer accent-slate-900 dark:accent-white"
            />
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{zoom}x</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {TIME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTimeRange(option.id)}
              disabled={!availability.timeAvailability.get(option.id)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                timeRange === option.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white'
              } ${
                availability.timeAvailability.get(option.id)
                  ? ''
                  : 'cursor-not-allowed opacity-40 hover:border-slate-200 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-4 shadow-lg dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_55%)] dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_60%)]" />
        {chart ? (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
              <rect
                x={padding.left}
                y={padding.top}
                width={innerWidth}
                height={innerHeight}
                className="fill-white/70 dark:fill-slate-950/70"
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

              {xTicks.map((tick, idx) => (
                <g key={`${tick.label}-${idx}`}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={padding.top}
                    y2={padding.top + innerHeight}
                    stroke="currentColor"
                    className="text-slate-200/70 dark:text-slate-800/70"
                    strokeDasharray="2 8"
                  />
                  <text
                    x={tick.x}
                    y={height - 16}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-semibold"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {[...series.entries()].map(([puuid, list]) => {
                if (list.length === 0) return null
                const color = colorByPuuid.get(puuid) ?? 'hsl(210 80% 50%)'
                const path = list
                  .map((point, idx) => {
                    const xValue = point.ts
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
                const lastXValue = lastPoint.ts
                const lastX =
                  padding.left + ((lastXValue - chart.minX) / chart.xRange) * innerWidth
                const lastY =
                  padding.top +
                  innerHeight -
                  ((lastPoint.score - chart.minScore) / chart.scoreRange) * innerHeight

                return (
                  <g key={puuid}>
                    <path d={path} fill="none" stroke={color} strokeWidth={2.75} opacity={0.9} />
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

            </svg>

            <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
              {[...series.keys()].map((puuid) => {
                const player = playersByPuuid.get(puuid)
                if (!player) return null
                return (
                  <div key={puuid} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
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

      <div className="grid gap-4 lg:grid-cols-3">
        {rangeStats.map(({ range, bestGain, bestLoss }) => (
          <div
            key={range.id}
            className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-4 shadow-sm dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {range.label}
              </h3>
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">Rank delta</span>
            </div>

            <div className="mt-4 space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-500">Most gained</div>
                {bestGain ? (
                  <div className="mt-2 flex items-center gap-3">
                    {playersByPuuid.get(bestGain.puuid)?.profileIconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={playersByPuuid.get(bestGain.puuid)?.profileIconUrl ?? ''}
                        alt=""
                        className="h-9 w-9 rounded-full border border-slate-200"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-slate-200" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {playersByPuuid.get(bestGain.puuid)?.name ?? 'Player'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-300">
                        {formatRank(bestGain.start.tier, bestGain.start.rank, bestGain.start.lp)} →{' '}
                        {formatRank(bestGain.end.tier, bestGain.end.rank, bestGain.end.lp)}
                      </div>
                    </div>
                    <div className="ml-auto text-sm font-bold text-emerald-600 dark:text-emerald-300">
                      {formatDelta(bestGain.delta)}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">Not enough data</div>
                )}
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-500">Most lost</div>
                {bestLoss ? (
                  <div className="mt-2 flex items-center gap-3">
                    {playersByPuuid.get(bestLoss.puuid)?.profileIconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={playersByPuuid.get(bestLoss.puuid)?.profileIconUrl ?? ''}
                        alt=""
                        className="h-9 w-9 rounded-full border border-slate-200"
                      />
                    ) : (
                      <div className="h-9 w-9 rounded-full bg-slate-200" />
                    )}
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {playersByPuuid.get(bestLoss.puuid)?.name ?? 'Player'}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-300">
                        {formatRank(bestLoss.start.tier, bestLoss.start.rank, bestLoss.start.lp)} →{' '}
                        {formatRank(bestLoss.end.tier, bestLoss.end.rank, bestLoss.end.lp)}
                      </div>
                    </div>
                    <div className="ml-auto text-sm font-bold text-rose-600 dark:text-rose-300">
                      {formatDelta(bestLoss.delta)}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">Not enough data</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
