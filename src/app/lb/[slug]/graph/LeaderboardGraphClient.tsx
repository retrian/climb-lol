"use client"

import { useEffect, useMemo, useRef, useState } from 'react'

// --- Types ---
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
  lpValue: number
  ts: number
  totalGames: number
}

type TooltipState = {
  point: NormalizedPoint
  x: number
  y: number
}

// --- Constants ---
const WIDTH = 960
const HEIGHT = 420
const PADDING = { top: 40, right: 30, bottom: 50, left: 110 }
const INNER_WIDTH = WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

// --- Helpers ---
function formatDelta(delta: number) {
  const rounded = Math.round(delta)
  if (rounded === 0) return '0'
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

function buildLpTicks(minValue: number, maxValue: number) {
  const min = Math.floor(minValue)
  const max = Math.ceil(maxValue)
  const range = Math.max(max - min, 1)
  const roughStep = range / 5
  const steps = [25, 50, 100, 200, 500, 1000]
  const step = steps.find((candidate) => candidate >= roughStep) ?? 1000
  const start = Math.floor(min / step) * step
  const ticks: Array<{ value: number; label: string }> = []

  for (let value = start; value <= max; value += step) {
    if (value < min) continue
    ticks.push({ value, label: `${value} LP` })
  }

  return ticks
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
          lpValue: Math.max(0, p.lp ?? 0),
          ts,
          totalGames: (p.wins ?? 0) + (p.losses ?? 0),
        }
      })
      .filter((p): p is NormalizedPoint => p !== null)
  }, [points])

  const pointsByPlayer = useMemo(() => {
    const byPlayer = new Map<string, NormalizedPoint[]>()
    
    const rawGroups = new Map<string, NormalizedPoint[]>()
    for (const point of normalizedPoints) {
      const list = rawGroups.get(point.puuid)
      if (list) list.push(point)
      else rawGroups.set(point.puuid, [point])
    }

    for (const [puuid, list] of rawGroups.entries()) {
      list.sort((a, b) => a.ts - b.ts)
      
      const processed: NormalizedPoint[] = []
      let lastPoint: NormalizedPoint | null = null

      for (const point of list) {
        if (!lastPoint) {
          processed.push(point)
          lastPoint = point
          continue
        }

        // Logic Fix: Capture update if Games increased OR if LP changed (e.g. decay)
        const gamesChanged = point.totalGames > lastPoint.totalGames
        const lpChanged = point.lpValue !== lastPoint.lpValue

        if (gamesChanged || lpChanged) {
            processed.push(point)
            lastPoint = point
        }
      }
      byPlayer.set(puuid, processed)
    }
    return byPlayer
  }, [normalizedPoints])

  const filteredPoints = useMemo(() => {
    return selectedPuuid ? pointsByPlayer.get(selectedPuuid) ?? [] : []
  }, [pointsByPlayer, selectedPuuid])

  const chart = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const ladderValues = filteredPoints.map((p) => p.lpValue)
    const rawMin = Math.min(...ladderValues, cutoffs.grandmaster, cutoffs.challenger)
    const rawMax = Math.max(...ladderValues, cutoffs.grandmaster, cutoffs.challenger)

    const bottomPadding = 20
    const topPadding = 20

    const min = rawMin - bottomPadding
    const max = rawMax + topPadding

    return {
      min,
      max,
      range: max - min || 1,
    }
  }, [cutoffs, filteredPoints])

  const firstMatch = filteredPoints.length > 0 ? filteredPoints[0].totalGames : 1
  const lastMatch = filteredPoints.length > 0 ? filteredPoints[filteredPoints.length - 1].totalGames : 1
  const matchRange = Math.max(lastMatch - firstMatch, 1)

  const plotPoints = useMemo(() => {
    if (!chart || filteredPoints.length === 0) return []
    return filteredPoints.map((point) => {
      const normalizedX = (point.totalGames - firstMatch) / matchRange
      const x = PADDING.left + normalizedX * INNER_WIDTH
      const y = PADDING.top + INNER_HEIGHT - ((point.lpValue - chart.min) / chart.range) * INNER_HEIGHT
      return { x, y, point }
    })
  }, [chart, filteredPoints, firstMatch, matchRange])

  const cutoffPositions = useMemo(() => {
    if (!chart) return null
    const clamp = (value: number) => Math.min(chart.max, Math.max(chart.min, value))
    const gmValue = clamp(cutoffs.grandmaster)
    const challValue = clamp(cutoffs.challenger)
    const gmY = PADDING.top + INNER_HEIGHT - ((gmValue - chart.min) / chart.range) * INNER_HEIGHT
    const challY = PADDING.top + INNER_HEIGHT - ((challValue - chart.min) / chart.range) * INNER_HEIGHT
    const topY = PADDING.top
    const bottomY = PADDING.top + INNER_HEIGHT
    return {
      gmY,
      challY,
      topY,
      bottomY,
      upperY: Math.min(gmY, challY),
      lowerY: Math.max(gmY, challY),
    }
  }, [chart, cutoffs])

  const lpTicks = useMemo(() => {
    if (!chart) return []
    return buildLpTicks(chart.min, chart.max)
  }, [chart])

  const xTicks = useMemo(() => {
    if (filteredPoints.length === 0) return []
    
    const tickCount = Math.min(6, matchRange + 1)
    const step = matchRange / (tickCount - 1 || 1)
    
    const ticks = Array.from({ length: tickCount }, (_, idx) => {
      const value = Math.round(firstMatch + step * idx)
      const clampedValue = Math.min(lastMatch, Math.max(firstMatch, value))
      const normalizedX = (clampedValue - firstMatch) / matchRange
      const x = PADDING.left + normalizedX * INNER_WIDTH
      
      return { x, label: clampedValue }
    })

    // Filter duplicates to handle overlapping ticks in small ranges
    const unique = new Map()
    ticks.forEach(t => unique.set(t.label, t))
    return Array.from(unique.values()).sort((a, b) => a.label - b.label)
  }, [filteredPoints.length, firstMatch, lastMatch, matchRange])

  const linePath = useMemo(() => buildSmoothPath(plotPoints), [plotPoints])
  const areaPath = useMemo(() => {
    if (plotPoints.length === 0) return ''
    const baseY = PADDING.top + INNER_HEIGHT
    const first = plotPoints[0]
    const last = plotPoints[plotPoints.length - 1]
    return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`
  }, [plotPoints, linePath])

  // Improved Tooltip Handler: Uses SVG coordinates directly
  const handleHover = (point: NormalizedPoint, x: number, y: number) => {
    setTooltip({ point, x, y })
  }

  const summary = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const first = filteredPoints[0]
    const last = filteredPoints[filteredPoints.length - 1]
    const delta = last.lpValue - first.lpValue
    return {
      current: `${last.lpValue} LP`,
      debut: `${first.lpValue} LP`,
      delta,
      matches: last.totalGames,
    }
  }, [filteredPoints])

  const activePlayer = playersByPuuid.get(selectedPuuid)
  const lineColor = '#2563eb'

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">LP Graph by Player</h2>
        <p className="text-sm text-slate-500">LP history by total games played</p>
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
      </div>

      <div className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
        {chart ? (
          <>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-auto w-full">
              <rect
                x={PADDING.left}
                y={PADDING.top}
                width={INNER_WIDTH}
                height={INNER_HEIGHT}
                rx={16}
                className="fill-white"
              />

              {cutoffPositions ? (
                <>
                  <rect
                    x={PADDING.left}
                    y={cutoffPositions.topY}
                    width={INNER_WIDTH}
                    height={Math.max(0, cutoffPositions.upperY - cutoffPositions.topY)}
                    className="fill-rose-50"
                    opacity={0.35}
                  />
                  <rect
                    x={PADDING.left}
                    y={cutoffPositions.upperY}
                    width={INNER_WIDTH}
                    height={Math.max(0, cutoffPositions.lowerY - cutoffPositions.upperY)}
                    className="fill-amber-50"
                    opacity={0.35}
                  />
                  <rect
                    x={PADDING.left}
                    y={cutoffPositions.lowerY}
                    width={INNER_WIDTH}
                    height={Math.max(0, cutoffPositions.bottomY - cutoffPositions.lowerY)}
                    className="fill-emerald-50"
                    opacity={0.3}
                  />
                </>
              ) : null}

              {lpTicks.map((tick) => {
                const y = PADDING.top + INNER_HEIGHT - ((tick.value - chart.min) / chart.range) * INNER_HEIGHT
                return (
                  <g key={`${tick.label}-${tick.value}`}>
                    <line
                      x1={PADDING.left}
                      x2={WIDTH - PADDING.right}
                      y1={y}
                      y2={y}
                      className="stroke-slate-200"
                    />
                    <text
                      x={PADDING.left - 12}
                      y={y + 4}
                      textAnchor="end"
                      className="fill-slate-500 text-[10px] font-semibold"
                    >
                      {tick.label}
                    </text>
                  </g>
                )
              })}

              {cutoffPositions ? (
                <>
                  {(['grandmaster', 'challenger'] as const).map((tier) => {
                    const value = tier === 'grandmaster' ? cutoffs.grandmaster : cutoffs.challenger
                    const y =
                      tier === 'grandmaster'
                        ? cutoffPositions.gmY
                        : cutoffPositions.challY
                    const label = tier === 'grandmaster' ? 'GM cutoff (dynamic)' : 'Chall cutoff (dynamic)'
                    return (
                      <g key={tier}>
                        <line
                          x1={PADDING.left}
                          x2={WIDTH - PADDING.right}
                          y1={y}
                          y2={y}
                          className="stroke-slate-400"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={WIDTH - PADDING.right}
                          y={y - 6}
                          textAnchor="end"
                          className="fill-slate-500 text-[10px] font-semibold"
                        >
                          {label}
                        </text>
                      </g>
                    )
                  })}
                </>
              ) : null}

              {xTicks.map((tick, idx) => (
                <g key={`${tick.label}-${idx}`}>
                  <line
                    x1={tick.x}
                    x2={tick.x}
                    y1={PADDING.top}
                    y2={PADDING.top + INNER_HEIGHT}
                    className="stroke-slate-100"
                  />
                  <text
                    x={tick.x}
                    y={HEIGHT - 16}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-semibold"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

              {areaPath ? <path d={areaPath} fill={lineColor} opacity={0.12} /> : null}
              {linePath ? <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} /> : null}

              {plotPoints.map((plot, idx) => (
                <circle
                  key={`point-${idx}`}
                  cx={plot.x}
                  cy={plot.y}
                  r={6}
                  fill={lineColor}
                  // Improved Tooltip Trigger: Passing SVG coordinates
                  onMouseEnter={() => handleHover(plot.point, plot.x, plot.y)}
                  onMouseMove={() => handleHover(plot.point, plot.x, plot.y)}
                  onMouseLeave={() => setTooltip(null)}
                  className="cursor-pointer"
                />
              ))}
            </svg>

            {/* Fixed Label: "Total Games" instead of "Match index" */}
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Total Games</span>
              <span>{activePlayer?.name ?? 'Player'} selection</span>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
            No ranking history available.
          </div>
        )}

        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
            style={{ left: tooltip.x, top: tooltip.y - 12 }}
          >
            <div className="font-semibold text-slate-900">
                {tooltip.point.totalGames === 0 ? "Placement" : `Game #${tooltip.point.totalGames}`}
            </div>
            <div>LP: {tooltip.point.lpValue}</div>
            <div>
              LP change{' '}
              {(() => {
                const index = filteredPoints.indexOf(tooltip.point)
                const prev = filteredPoints[index - 1]
                if (!prev) return '0'
                return formatDelta(tooltip.point.lpValue - prev.lpValue)
              })()}
            </div>
            <div>
              {Math.abs(Math.round(tooltip.point.lpValue - cutoffs.grandmaster))} LP{' '}
              {tooltip.point.lpValue >= cutoffs.grandmaster ? 'above' : 'below'} GM cutoff
            </div>
            <div>
              {Math.abs(Math.round(tooltip.point.lpValue - cutoffs.challenger))} LP{' '}
              {tooltip.point.lpValue >= cutoffs.challenger ? 'above' : 'below'} Chall cutoff
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
