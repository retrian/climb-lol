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
  ladderLp: number
  ts: number
}

type TooltipState = {
  point: NormalizedPoint
  index: number
  x: number
  y: number
}

const TIME_OPTIONS = [
  { id: '30d', label: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
]

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

function formatDelta(delta: number) {
  const rounded = Math.round(delta)
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

function titleCase(value: string) {
  return value[0] + value.slice(1).toLowerCase()
}

function baseMasterLadder() {
  const diamondIndex = TIER_ORDER_LOW_TO_HIGH.indexOf('DIAMOND')
  return diamondIndex * 400 + 3 * 100 + 100
}

function ladderLpWithCutoffs(
  point: Pick<LpPoint, 'tier' | 'rank' | 'lp'>,
  cutoffs: RankCutoffs
) {
  const tier = (point.tier ?? '').toUpperCase()
  const div = (point.rank ?? '').toUpperCase()
  const lp = Math.max(0, point.lp ?? 0)

  const tierIndex = TIER_ORDER_LOW_TO_HIGH.indexOf(tier as any)
  if (tierIndex === -1) return lp

  const divIndex = DIV_ORDER_LOW_TO_HIGH.indexOf(div as any)

  if (tierIndex <= TIER_ORDER_LOW_TO_HIGH.indexOf('DIAMOND')) {
    const base = tierIndex * 400
    const divOffset = divIndex === -1 ? 0 : divIndex * 100
    return base + divOffset + lp
  }

  const baseMaster = baseMasterLadder()

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

function ladderLpLabel(value: number, cutoffs: RankCutoffs) {
  const baseMaster = baseMasterLadder()
  if (value < baseMaster) {
    const tierIndex = Math.max(0, Math.floor(value / 400))
    const remainder = value - tierIndex * 400
    const divisionIndex = Math.max(0, Math.min(3, Math.floor(remainder / 100)))
    const tier = TIER_ORDER_LOW_TO_HIGH[tierIndex]
    const division = DIV_ORDER_LOW_TO_HIGH[divisionIndex]
    return `${titleCase(tier)} ${division}`
  }

  const masterCap = baseMaster + (cutoffs.grandmaster ?? 0)
  const grandmasterCap = baseMaster + (cutoffs.challenger ?? 0)

  if (value < masterCap) {
    return `Master ${Math.max(0, Math.round(value - baseMaster))} LP`
  }

  if (value < grandmasterCap) {
    return `Grandmaster ${Math.max(0, Math.round(value - masterCap))} LP`
  }

  return `Challenger ${Math.max(0, Math.round(value - grandmasterCap))} LP`
}

function buildLadderTicks(minValue: number, maxValue: number, cutoffs: RankCutoffs) {
  const ticks: Array<{ value: number; label: string }> = []
  const baseMaster = baseMasterLadder()
  const min = Math.floor(minValue)
  const max = Math.ceil(maxValue)

  const diamondIndex = TIER_ORDER_LOW_TO_HIGH.indexOf('DIAMOND')
  for (let tierIndex = 0; tierIndex <= diamondIndex; tierIndex += 1) {
    for (let divIndex = 0; divIndex < DIV_ORDER_LOW_TO_HIGH.length; divIndex += 1) {
      const value = tierIndex * 400 + divIndex * 100
      if (value < min || value > max) continue
      ticks.push({
        value,
        label: `${titleCase(TIER_ORDER_LOW_TO_HIGH[tierIndex])} ${DIV_ORDER_LOW_TO_HIGH[divIndex]}`,
      })
    }
  }

  const masterCap = baseMaster + (cutoffs.grandmaster ?? 0)
  const grandmasterCap = baseMaster + (cutoffs.challenger ?? 0)

  const pushRange = (start: number, end: number, label: string) => {
    const startValue = Math.ceil(start / 50) * 50
    for (let value = startValue; value <= end; value += 50) {
      if (value < min || value > max) continue
      ticks.push({ value, label: `${label} ${value - start} LP` })
    }
  }

  if (max >= baseMaster) {
    pushRange(baseMaster, Math.min(masterCap, max), 'Master')
    pushRange(masterCap, Math.min(grandmasterCap, max), 'Grandmaster')
    if (max > grandmasterCap) {
      pushRange(grandmasterCap, max, 'Challenger')
    }
  }

  const unique = new Map<number, string>()
  for (const tick of ticks) {
    if (!unique.has(tick.value)) unique.set(tick.value, tick.label)
  }

  return Array.from(unique.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.value - b.value)
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  const commands = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i]
    const next = points[i + 1]
    const midX = (current.x + next.x) / 2
    commands.push(`C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`)
  }
  return commands.join(' ')
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
  const [selectedPuuid, setSelectedPuuid] = useState(players[0]?.puuid ?? '')
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  useEffect(() => {
    if (!selectedPuuid && players[0]?.puuid) {
      setSelectedPuuid(players[0].puuid)
    }
  }, [players, selectedPuuid])

  const playersByPuuid = useMemo(() => {
    return new Map(players.map((p) => [p.puuid, p]))
  }, [players])

  const normalizedPoints = useMemo<NormalizedPoint[]>(() => {
    return points
      .map((p) => {
        const ts = new Date(p.fetched_at).getTime()
        if (Number.isNaN(ts)) return null
        return {
          ...p,
          ladderLp: ladderLpWithCutoffs(p, cutoffs),
          ts,
        }
      })
      .filter((p): p is NormalizedPoint => p !== null)
  }, [cutoffs, points])

  const pointsByPlayer = useMemo(() => {
    const byPlayer = new Map<string, NormalizedPoint[]>()
    for (const point of normalizedPoints) {
      const list = byPlayer.get(point.puuid)
      if (list) list.push(point)
      else byPlayer.set(point.puuid, [point])
    }
    for (const list of byPlayer.values()) {
      list.sort((a, b) => a.ts - b.ts)
    }
    return byPlayer
  }, [normalizedPoints])

  const selectedPoints = useMemo(() => {
    return selectedPuuid ? pointsByPlayer.get(selectedPuuid) ?? [] : []
  }, [pointsByPlayer, selectedPuuid])

  const availability = useMemo(() => {
    const availabilityMap = new Map<string, boolean>()
    const now = Date.now()
    for (const option of TIME_OPTIONS) {
      const cutoff = now - option.ms
      const hasEnough = selectedPoints.filter((p) => p.ts >= cutoff).length >= 2
      availabilityMap.set(option.id, hasEnough)
    }
    return availabilityMap
  }, [selectedPoints])

  useEffect(() => {
    if (!availability.get(timeRange)) {
      const fallback = TIME_OPTIONS.find((option) => availability.get(option.id))
      if (fallback) setTimeRange(fallback.id)
    }
  }, [availability, timeRange])

  const filteredPoints = useMemo<NormalizedPoint[]>(() => {
    const option = TIME_OPTIONS.find((o) => o.id === timeRange) ?? TIME_OPTIONS[0]
    const cutoff = Date.now() - option.ms
    return selectedPoints.filter((p) => p.ts >= cutoff)
  }, [timeRange, selectedPoints])

  const chart = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const ladderValues = filteredPoints.map((p) => p.ladderLp)
    const min = Math.min(...ladderValues)
    const max = Math.max(...ladderValues)
    return {
      min,
      max,
      range: max - min || 1,
    }
  }, [filteredPoints])

  const width = 960
  const height = 420
  const padding = { top: 40, right: 30, bottom: 50, left: 110 }
  const innerWidth = width - padding.left - padding.right
  const innerHeight = height - padding.top - padding.bottom

  const matchCount = filteredPoints.length
  const plotPoints = useMemo(() => {
    if (!chart) return []
    return filteredPoints.map((point, index) => {
      const x =
        matchCount <= 1
          ? padding.left + innerWidth / 2
          : padding.left + (index / (matchCount - 1)) * innerWidth
      const y = padding.top + innerHeight - ((point.ladderLp - chart.min) / chart.range) * innerHeight
      return { x, y, point, index }
    })
  }, [chart, filteredPoints, innerHeight, innerWidth, matchCount, padding.left, padding.top])

  const ladderTicks = useMemo(() => {
    if (!chart) return []
    return buildLadderTicks(chart.min, chart.max, cutoffs)
  }, [chart, cutoffs])

  const xTicks = useMemo(() => {
    if (matchCount === 0) return []
    const count = Math.min(6, Math.max(2, matchCount))
    const step = (matchCount - 1) / (count - 1)
    return Array.from({ length: count }, (_, idx) => {
      const rawValue = Math.round(1 + step * idx)
      const value = Math.min(matchCount, Math.max(1, rawValue))
      const x =
        matchCount <= 1
          ? padding.left + innerWidth / 2
          : padding.left + ((value - 1) / (matchCount - 1)) * innerWidth
      return { x, label: value }
    })
  }, [innerWidth, matchCount, padding.left])

  const linePath = useMemo(() => buildSmoothPath(plotPoints), [plotPoints])
  const areaPath = useMemo(() => {
    if (plotPoints.length === 0) return ''
    const baseY = padding.top + innerHeight
    const first = plotPoints[0]
    const last = plotPoints[plotPoints.length - 1]
    return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`
  }, [plotPoints, linePath, innerHeight, padding.top])

  const handleHover = (point: NormalizedPoint, index: number, clientX: number, clientY: number) => {
    const container = containerRef.current?.getBoundingClientRect()
    if (!container) return
    setTooltip({
      point,
      index,
      x: clientX - container.left,
      y: clientY - container.top,
    })
  }

  const summary = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const first = filteredPoints[0]
    const last = filteredPoints[filteredPoints.length - 1]
    const delta = last.ladderLp - first.ladderLp
    return {
      current: formatRank(last.tier, last.rank, last.lp),
      debut: formatRank(first.tier, first.rank, first.lp),
      delta,
      matches: filteredPoints.length,
    }
  }, [filteredPoints])

  const activePlayer = playersByPuuid.get(selectedPuuid)
  const lineColor = '#2563eb'

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">LP Evolution by Player</h2>
        <p className="text-sm text-slate-500">LP history match by match</p>
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          {players.map((player) => {
            const isActive = player.puuid === selectedPuuid
            return (
              <button
                key={player.puuid}
                type="button"
                onClick={() => setSelectedPuuid(player.puuid)}
                className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                  isActive
                    ? 'border-blue-500 bg-blue-500 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
              >
                {player.name}
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {TIME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTimeRange(option.id)}
              disabled={!availability.get(option.id)}
              className={`rounded-full border px-4 py-1.5 text-xs font-semibold transition ${
                timeRange === option.id
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              } ${
                availability.get(option.id) ? '' : 'cursor-not-allowed opacity-40 hover:border-slate-200'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4"
      >
        {chart ? (
          <>
            <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
              <rect
                x={padding.left}
                y={padding.top}
                width={innerWidth}
                height={innerHeight}
                rx={16}
                className="fill-white"
              />

              {ladderTicks.map((tick) => {
                const y = padding.top + innerHeight - ((tick.value - chart.min) / chart.range) * innerHeight
                return (
                  <g key={`${tick.label}-${tick.value}`}>
                    <line
                      x1={padding.left}
                      x2={width - padding.right}
                      y1={y}
                      y2={y}
                      className="stroke-slate-200"
                    />
                    <text
                      x={padding.left - 12}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-500 text-[10px] font-semibold"
                    >
                      {tick.label}
                    </text>
                  </g>
                )
              })}

              {xTicks.map((tick, idx) => (
                <g key={`${tick.label}-${idx}`}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={padding.top}
                    y2={padding.top + innerHeight}
                    className="stroke-slate-100"
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

              {areaPath ? <path d={areaPath} fill={lineColor} opacity={0.12} /> : null}
              {linePath ? <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} /> : null}

              {plotPoints.map((plot) => (
                <circle
                  key={`point-${plot.index}`}
                  cx={plot.x}
                  cy={plot.y}
                  r={6}
                  fill={lineColor}
                  onMouseEnter={(event) => handleHover(plot.point, plot.index, event.clientX, event.clientY)}
                  onMouseMove={(event) => handleHover(plot.point, plot.index, event.clientX, event.clientY)}
                  onMouseLeave={() => setTooltip(null)}
                  className="cursor-pointer"
                />
              ))}
            </svg>

            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Match index</span>
              <span>{activePlayer?.name ?? 'Player'} selection</span>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
            No ranking history yet for this range.
          </div>
        )}

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y - 12 }}
          >
            <div className="font-semibold text-slate-900">Match {tooltip.index + 1}</div>
            <div>{formatRank(tooltip.point.tier, tooltip.point.rank, tooltip.point.lp)}</div>
            <div>
              LP change{' '}
              {(() => {
                const prev = filteredPoints[tooltip.index - 1]
                if (!prev) return '0'
                return formatDelta(tooltip.point.ladderLp - prev.ladderLp)
              })()}
            </div>
            {typeof tooltip.point.wins === 'number' && typeof tooltip.point.losses === 'number' ? (
              <div>
                Record {tooltip.point.wins}W-{tooltip.point.losses}L
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="grid gap-6 text-center sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Current LP', value: summary?.current ?? '—' },
            { label: 'LP debut', value: summary?.debut ?? '—' },
            {
              label: 'Progression',
              value: summary ? `${summary.delta >= 0 ? '+' : ''}${Math.round(summary.delta)} LP` : '—',
              highlight: summary ? summary.delta >= 0 : undefined,
            },
            { label: 'Matches', value: summary?.matches.toString() ?? '—' },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                {item.label}
              </div>
              <div
                className={`mt-2 text-lg font-bold ${
                  item.label === 'Progression'
                    ? item.highlight
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                    : 'text-slate-900'
                }`}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
