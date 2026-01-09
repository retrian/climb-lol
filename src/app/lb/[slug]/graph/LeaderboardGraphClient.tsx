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
  match_id?: string | null
  champion_name?: string | null
  champion_id?: number | null
  kills?: number | null
  deaths?: number | null
  assists?: number | null
  win?: boolean | null
  lp_delta?: number | null
  global_rank?: number | null
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

type SeriesPoint = FilteredPoint & {
  matchIndex: number
  delta: number | null
  result: 'Win' | 'Loss' | null
}

// ✅ remove 30d, keep 14d
const TIME_OPTIONS = [
  { id: '14d', label: '14d', ms: 14 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '12h', label: '12h', ms: 12 * 60 * 60 * 1000 },
  { id: '6h', label: '6h', ms: 6 * 60 * 60 * 1000 },
]

// ✅ summaries should match
const RANGE_SUMMARIES = [
  { id: 'day', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: 'week', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: 'twoWeeks', label: '14d', ms: 14 * 24 * 60 * 60 * 1000 },
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

/**
 * ✅ Ladder LP (what you want for "Rank delta"):
 * - Each division is 0–100 LP
 * - Each tier below Master is 4 divisions (400 LP)
 * - Master+ continues from Diamond I 100
 * - GM/Chall sit above Master using cutoffs
 */
const TIER_ORDER_LOW_TO_HIGH = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const

const DIV_ORDER_LOW_TO_HIGH = ['IV', 'III', 'II', 'I'] as const

function ladderLpWithCutoffs(
  point: Pick<LpPoint, 'tier' | 'rank' | 'lp'>,
  cutoffs: RankCutoffs
) {
  const tier = (point.tier ?? '').toUpperCase()
  const div = (point.rank ?? '').toUpperCase()
  const lp = Math.max(0, point.lp ?? 0)

  const tierIndex = TIER_ORDER_LOW_TO_HIGH.indexOf(tier as any)
  if (tierIndex === -1) return lp

  // Base for tiers below Master: tierIndex * 400
  // Division offset: IV=0, III=100, II=200, I=300
  const divIndex = DIV_ORDER_LOW_TO_HIGH.indexOf(div as any)

  // Everything below Master
  if (tierIndex <= TIER_ORDER_LOW_TO_HIGH.indexOf('DIAMOND')) {
    const base = tierIndex * 400
    const divOffset = divIndex === -1 ? 0 : divIndex * 100
    return base + divOffset + lp
  }

  // Base at Diamond I 100 (end of Diamond ladder)
  const diamondIndex = TIER_ORDER_LOW_TO_HIGH.indexOf('DIAMOND')
  const baseMaster = diamondIndex * 400 + 3 * 100 + 100 // Diamond I (divIndex=3) at 100

  if (tier === 'MASTER') {
    return baseMaster + lp
  }

  if (tier === 'GRANDMASTER') {
    return baseMaster + (cutoffs.grandmaster ?? 0) + lp
  }

  if (tier === 'CHALLENGER') {
    return baseMaster + (cutoffs.challenger ?? 0) + lp
  }

  return baseMaster + lp
}

function nextRankScore(point: Pick<LpPoint, 'tier' | 'rank' | 'lp'>, cutoffs: RankCutoffs) {
  const tier = (point.tier ?? '').toUpperCase()
  const div = (point.rank ?? '').toUpperCase()
  const tierIndex = TIER_ORDER_LOW_TO_HIGH.indexOf(tier as any)
  const divIndex = DIV_ORDER_LOW_TO_HIGH.indexOf(div as any)

  if (tierIndex === -1) return ladderLpWithCutoffs(point, cutoffs)

  if (tierIndex <= TIER_ORDER_LOW_TO_HIGH.indexOf('DIAMOND')) {
    if (divIndex >= 0 && divIndex < DIV_ORDER_LOW_TO_HIGH.length - 1) {
      const nextDiv = DIV_ORDER_LOW_TO_HIGH[divIndex + 1]
      return ladderLpWithCutoffs({ tier, rank: nextDiv, lp: 0 }, cutoffs)
    }
    const nextTier = TIER_ORDER_LOW_TO_HIGH[tierIndex + 1]
    if (nextTier) {
      return ladderLpWithCutoffs({ tier: nextTier, rank: 'IV', lp: 0 }, cutoffs)
    }
  }

  return ladderLpWithCutoffs({ ...point, lp: (point.lp ?? 0) + 30 }, cutoffs)
}

function nextMasterStepScore(point: Pick<LpPoint, 'tier' | 'lp'>, cutoffs: RankCutoffs) {
  const tier = (point.tier ?? '').toUpperCase()
  if (!['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)) return 0
  const currentLp = Math.max(0, point.lp ?? 0)
  const nextStep = Math.ceil((currentLp + 30) / 50) * 50
  return ladderLpWithCutoffs({ tier, rank: 'I', lp: nextStep }, cutoffs)
}

type TooltipState = {
  puuid: string
  point: SeriesPoint
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
  const [visiblePuuids, setVisiblePuuids] = useState<Set<string>>(
    () => new Set(players.map((player) => player.puuid))
  )
  const [legendFilter, setLegendFilter] = useState('')

  const playersByPuuid = useMemo(() => {
    return new Map(players.map((p) => [p.puuid, p]))
  }, [players])

  const colorByPuuid = useMemo(() => {
    return new Map(players.map((p) => [p.puuid, colorFromString(p.puuid)]))
  }, [players])

  useEffect(() => {
    setVisiblePuuids(new Set(players.map((player) => player.puuid)))
  }, [players])

  const normalizedPoints = useMemo<NormalizedPoint[]>(() => {
    return points
      .map((p) => {
        const ts = new Date(p.fetched_at).getTime()
        if (Number.isNaN(ts)) return null
        return {
          ...p,
          score: ladderLpWithCutoffs(p, cutoffs),
          ts,
        }
      })
      .filter((p): p is NormalizedPoint => p !== null)
  }, [cutoffs, points])

  const { availability, pointsByPlayer } = useMemo(() => {
    const byPlayer = new Map<string, NormalizedPoint[]>()
    for (const point of normalizedPoints) {
      const list = byPlayer.get(point.puuid)
      if (list) list.push(point)
      else byPlayer.set(point.puuid, [point])
    }

    const timeAvailability = new Map<string, boolean>()
    const now = Date.now()
    for (const option of TIME_OPTIONS) {
      const cutoff = now - option.ms
      let hasEnough = false
      for (const list of byPlayer.values()) {
        if (list.filter((p) => p.ts >= cutoff).length >= 2) {
          hasEnough = true
          break
        }
      }
      timeAvailability.set(option.id, hasEnough)
    }

    return { availability: { timeAvailability }, pointsByPlayer: byPlayer }
  }, [normalizedPoints])

  const filteredPoints = useMemo<FilteredPoint[]>(() => {
    const option = TIME_OPTIONS.find((o) => o.id === timeRange) ?? TIME_OPTIONS[0]
    const cutoff = Date.now() - option.ms
    return normalizedPoints.filter((p) => p.ts >= cutoff)
  }, [timeRange, normalizedPoints])

  const { series } = useMemo(() => {
    let zPoints = filteredPoints
    if (filteredPoints.length > 0 && zoom !== 1) {
      const xValues = filteredPoints.map((p) => p.ts)
      const minX = Math.min(...xValues)
      const maxX = Math.max(...xValues)
      const windowStart = maxX - (maxX - minX) / zoom
      zPoints = filteredPoints.filter((p) => p.ts >= windowStart)
    }

    const byPlayer = new Map<string, FilteredPoint[]>()
    for (const point of zPoints) {
      const list = byPlayer.get(point.puuid)
      if (list) list.push(point)
      else byPlayer.set(point.puuid, [point])
    }
    for (const list of byPlayer.values()) {
      list.sort((a, b) => a.ts - b.ts)
    }

    return { series: byPlayer }
  }, [filteredPoints, zoom])

  const visibleSeries = useMemo(() => {
    if (visiblePuuids.size === 0) return new Map<string, FilteredPoint[]>()
    const filtered = new Map<string, FilteredPoint[]>()
    for (const [puuid, list] of series.entries()) {
      if (visiblePuuids.has(puuid)) filtered.set(puuid, list)
    }
    return filtered
  }, [series, visiblePuuids])

  const seriesWithMeta = useMemo(() => {
    const enriched = new Map<string, SeriesPoint[]>()
    for (const [puuid, list] of visibleSeries.entries()) {
      const sorted = [...list].sort((a, b) => a.ts - b.ts)
      const points: SeriesPoint[] = []
      let lastIncluded: NormalizedPoint | null = null

      for (const point of sorted) {
        const previous = lastIncluded
        const winDelta =
          previous && typeof point.wins === 'number' && typeof previous.wins === 'number'
            ? point.wins - previous.wins
            : null
        const lossDelta =
          previous && typeof point.losses === 'number' && typeof previous.losses === 'number'
            ? point.losses - previous.losses
            : null
        const result: SeriesPoint['result'] =
          point.win !== null && point.win !== undefined
            ? point.win
              ? 'Win'
              : 'Loss'
            : winDelta !== null || lossDelta !== null
              ? winDelta !== null && winDelta > 0
                ? 'Win'
                : lossDelta !== null && lossDelta > 0
                  ? 'Loss'
                  : null
              : null

        const hasGame =
          !!point.match_id ||
          point.lp_delta !== null ||
          (winDelta !== null && winDelta > 0) ||
          (lossDelta !== null && lossDelta > 0)

        if (!hasGame) continue

        const delta = previous ? ladderLpWithCutoffs(point, cutoffs) - ladderLpWithCutoffs(previous, cutoffs) : null
        const matchIndex = points.length + 1
        points.push({
          ...point,
          matchIndex,
          delta,
          result,
        })
        lastIncluded = point
      }

      enriched.set(puuid, points)
    }
    return enriched
  }, [visibleSeries, cutoffs])

  const renderableSeries = useMemo(() => {
    const filtered = new Map<string, SeriesPoint[]>()
    for (const [puuid, list] of seriesWithMeta.entries()) {
      if (list.length >= 2) filtered.set(puuid, list)
    }
    return filtered
  }, [seriesWithMeta])

  const filteredPlayers = useMemo(() => {
    const query = legendFilter.trim().toLowerCase()
    if (!query) return players
    return players.filter((player) => player.name.toLowerCase().includes(query))
  }, [legendFilter, players])

  const togglePlayerVisibility = (puuid: string) => {
    setVisiblePuuids((prev) => {
      const next = new Set(prev)
      if (next.has(puuid)) next.delete(puuid)
      else next.add(puuid)
      return next
    })
  }

  const showAllPlayers = () => {
    setVisiblePuuids(new Set(players.map((player) => player.puuid)))
  }

  const hideAllPlayers = () => {
    setVisiblePuuids(new Set())
  }

  // ✅ FIXED: use ladder LP delta (so Emerald I 55 -> Diamond IV 15 = +60)
  const rangeStats = useMemo(() => {
    const now = Date.now()
    return RANGE_SUMMARIES.map((range) => {
      const cutoff = now - range.ms
      let bestGain: { puuid: string; delta: number; start: NormalizedPoint; end: NormalizedPoint } | null = null
      let bestLoss: { puuid: string; delta: number; start: NormalizedPoint; end: NormalizedPoint } | null = null

      for (const [puuid, list] of pointsByPlayer.entries()) {
        const windowed = list.filter((p) => p.ts >= cutoff)
        if (windowed.length < 2) continue
        windowed.sort((a, b) => a.ts - b.ts)

        const start = windowed[0]
        const end = windowed[windowed.length - 1]

        const startL = ladderLpWithCutoffs(start, cutoffs)
        const endL = ladderLpWithCutoffs(end, cutoffs)
        const delta = endL - startL

        if (!bestGain || delta > bestGain.delta) bestGain = { puuid, delta, start, end }
        if (!bestLoss || delta < bestLoss.delta) bestLoss = { puuid, delta, start, end }
      }

      return { range, bestGain, bestLoss }
    })
  }, [pointsByPlayer, cutoffs])

  const chart = useMemo(() => {
    const seriesList = [...renderableSeries.values()]
    const allPoints = seriesList.flat()
    if (allPoints.length === 0) return null

    const scores = allPoints.map((p) => p.score)
    const startScores = seriesList.map((points) => points[0]?.score ?? 0)
    const endScores = seriesList.map((points) => points[points.length - 1]?.score ?? 0)
    const minScore = Math.min(...scores, ...startScores)
    const maxScore = Math.max(...scores)
    const targetMaxScores = endScores.map((score, index) => {
      const points = seriesList[index]
      const lastPoint = points?.[points.length - 1]
      if (!lastPoint) return score + 30
      const nextScore = nextRankScore(lastPoint, cutoffs)
      const nextStep = nextMasterStepScore(lastPoint, cutoffs)
      return Math.max(score + 30, nextScore, nextStep)
    })
    const paddedMaxScore = Math.max(maxScore, ...targetMaxScores)
    const maxMatch = Math.max(...allPoints.map((p) => p.matchIndex))

    return {
      minScore,
      maxScore: paddedMaxScore,
      scoreRange: paddedMaxScore - minScore || 1,
      maxMatch,
      matchRange: Math.max(maxMatch - 1, 1),
    }
  }, [renderableSeries])

  const width = 960
  const height = 420
  const padding = { top: 30, right: 30, bottom: 50, left: 70 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const axisLabels = useMemo(() => {
    if (!chart) return []
    const labels: Array<{ label: string; y: number }> = []
    const divisions = ['I', 'II', 'III', 'IV']
    for (const tier of TIER_ORDER_LOW_TO_HIGH) {
      if (tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER') continue
      for (const division of divisions) {
        const score = ladderLpWithCutoffs({ tier, rank: division, lp: 0 }, cutoffs)
        if (score < chart.minScore || score > chart.maxScore) continue
        const y = padding.top + innerHeight - ((score - chart.minScore) / chart.scoreRange) * innerHeight
        labels.push({ label: `${tier[0] + tier.slice(1).toLowerCase()} ${division}`, y })
      }
    }

    const masterBase = ladderLpWithCutoffs({ tier: 'MASTER', rank: 'I', lp: 0 }, cutoffs)
    const maxMasterLp = Math.max(chart.maxScore - masterBase, 0)
    const masterSteps = Math.min(Math.ceil(maxMasterLp / 50), 12)
    for (let step = 0; step <= masterSteps; step += 1) {
      const lp = step * 50
      const score = masterBase + lp
      if (score < chart.minScore || score > chart.maxScore) continue
      const y = padding.top + innerHeight - ((score - chart.minScore) / chart.scoreRange) * innerHeight
      labels.push({ label: `Master ${lp} LP`, y })
    }

    return labels.sort((a, b) => a.y - b.y)
  }, [chart, cutoffs, innerHeight, padding.top])

  const xTicks = useMemo(() => {
    if (!chart) return []
    const count = Math.min(6, chart.maxMatch)
    const step = chart.matchRange / Math.max(count - 1, 1)
    return Array.from({ length: count }, (_, idx) => {
      const value = Math.round(1 + step * idx)
      const x = padding.left + ((value - 1) / chart.matchRange) * innerWidth
      return { x, label: `Match ${value}` }
    })
  }, [chart, innerWidth, padding.left])

  const handleHover = (puuid: string, point: SeriesPoint, clientX: number, clientY: number) => {
    const container = containerRef.current?.getBoundingClientRect()
    if (!container) return
    setTooltip({
      puuid,
      point,
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
          {TIME_OPTIONS.map((option) => {
            const hasData = availability.timeAvailability.get(option.id)
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTimeRange(option.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  timeRange === option.id
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white'
                } ${hasData ? '' : 'opacity-60'}`}
              >
                <span>{option.label}</span>
                {!hasData ? (
                  <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    No data
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-white to-slate-50 p-4 shadow-lg dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_55%)] dark:bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_60%)]" />
        {visiblePuuids.size === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            No players selected.
          </div>
        ) : chart ? (
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
                <g key={label.label}>
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
                    {label.label}
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
                    transform={`rotate(-35 ${tick.x} ${height - 16})`}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {[...renderableSeries.entries()].map(([puuid, list]) => {
                if (list.length < 2) return null
                const color = colorByPuuid.get(puuid) ?? 'hsl(210 80% 50%)'
                const path = list
                  .map((point, idx) => {
                    const x = padding.left + ((point.matchIndex - 1) / chart.matchRange) * innerWidth
                    const y =
                      padding.top +
                      innerHeight -
                      ((point.score - chart.minScore) / chart.scoreRange) * innerHeight
                    return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
                  })
                  .join(' ')

                const areaPath = `${path} L ${padding.left + innerWidth} ${padding.top + innerHeight} L ${
                  padding.left
                } ${padding.top + innerHeight} Z`

                return (
                  <g key={puuid}>
                    <path d={areaPath} fill={color} opacity={0.1} />
                    <path
                      d={path}
                      fill="none"
                      stroke={color}
                      strokeWidth={2.8}
                      opacity={0.95}
                    />
                    {list.map((point) => {
                      const x = padding.left + ((point.matchIndex - 1) / chart.matchRange) * innerWidth
                      const y =
                        padding.top +
                        innerHeight -
                        ((point.score - chart.minScore) / chart.scoreRange) * innerHeight
                      return (
                        <circle
                          key={`${puuid}-${point.matchIndex}`}
                          cx={x}
                          cy={y}
                          r={4.5}
                          fill="white"
                          stroke={color}
                          strokeWidth={2}
                          onMouseEnter={(event) => handleHover(puuid, point, event.clientX, event.clientY)}
                          onMouseMove={(event) => handleHover(puuid, point, event.clientX, event.clientY)}
                          onMouseLeave={() => setTooltip(null)}
                          className="cursor-pointer"
                        />
                      )
                    })}
                  </g>
                )
              })}
            </svg>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
            Insufficient data for this range.
          </div>
        )}

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            style={{ left: tooltip.x, top: tooltip.y - 10 }}
          >
            {(() => {
              const player = playersByPuuid.get(tooltip.puuid)
              const tooltipPoint = tooltip.point
              const deltaValue =
                tooltipPoint.lp_delta !== null && tooltipPoint.lp_delta !== undefined
                  ? tooltipPoint.lp_delta
                  : tooltipPoint.delta
              const deltaLabel =
                deltaValue !== null && deltaValue !== undefined
                  ? ` (${deltaValue > 0 ? '+' : ''}${deltaValue})`
                  : ''
              const championLabel =
                tooltipPoint.champion_name ??
                (tooltipPoint.champion_id ? `Champion ${tooltipPoint.champion_id}` : 'Unknown Champion')
              const kdaLabel =
                tooltipPoint.kills !== null &&
                tooltipPoint.kills !== undefined &&
                tooltipPoint.deaths !== null &&
                tooltipPoint.deaths !== undefined &&
                tooltipPoint.assists !== null &&
                tooltipPoint.assists !== undefined
                  ? `${tooltipPoint.kills}/${tooltipPoint.deaths}/${tooltipPoint.assists} KDA`
                  : 'KDA unavailable'
              const globalRank =
                tooltipPoint.global_rank !== null && tooltipPoint.global_rank !== undefined
                  ? ` [Global: ${tooltipPoint.global_rank}]`
                  : ''
              const resultLabel =
                tooltipPoint.result === 'Win' ? 'Win' : tooltipPoint.result === 'Loss' ? 'Loss' : 'Result'
              return (
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Match {tooltipPoint.matchIndex}
                  </div>
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {formatRank(tooltipPoint.tier, tooltipPoint.rank, tooltipPoint.lp)}
                    {deltaLabel}
                    {globalRank}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-300">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        tooltipPoint.result === 'Win'
                          ? 'bg-emerald-400'
                          : tooltipPoint.result === 'Loss'
                            ? 'bg-rose-400'
                            : 'bg-slate-500'
                      }`}
                    />
                    <span>
                      {championLabel} · {resultLabel}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-300">{kdaLabel}</div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-400">{player?.name ?? 'Player'}</div>
                </div>
              )
            })()}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Players
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={showAllPlayers}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              Show all
            </button>
            <button
              type="button"
              onClick={hideAllPlayers}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
            >
              Hide all
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={legendFilter}
            onChange={(event) => setLegendFilter(event.target.value)}
            placeholder="Search players..."
            className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 placeholder:text-slate-400 shadow-sm focus:border-blue-400 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          />
          <span className="text-[11px] font-semibold text-slate-400">
            {visiblePuuids.size}/{players.length} visible
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-300">
          {filteredPlayers.map((player) => {
            const isActive = visiblePuuids.has(player.puuid)
            const color = colorByPuuid.get(player.puuid) ?? 'hsl(210 80% 50%)'
            return (
              <button
                key={player.puuid}
                type="button"
                onClick={() => togglePlayerVisibility(player.puuid)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 shadow-sm transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-500/20 dark:text-blue-200'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="font-semibold">{player.name}</span>
              </button>
            )
          })}
          {filteredPlayers.length === 0 ? (
            <div className="text-xs text-slate-500">No players match your search.</div>
          ) : null}
        </div>
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
                  <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">Insufficient data</div>
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
                  <div className="mt-2 text-xs text-slate-400 dark:text-slate-500">Insufficient data</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
