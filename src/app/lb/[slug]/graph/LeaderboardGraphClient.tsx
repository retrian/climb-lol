"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { formatRank } from "@/lib/rankFormat"

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
  ladderValue: number
  ts: number
  totalGames: number
}

type TooltipState = {
  point: NormalizedPoint
  idx: number
  x: number
  y: number
  preferBelow: boolean
}

// --- Constants ---
const WIDTH = 960
const HEIGHT = 420
const PADDING = { top: 40, right: 30, bottom: 50, left: 110 }
const INNER_WIDTH = WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom

const TIER_ORDER = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const

const DIV_ORDER = ["IV", "III", "II", "I"] as const

// --- Helpers ---
function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function formatDelta(delta: number) {
  const rounded = Math.round(delta)
  if (rounded === 0) return "0"
  return `${rounded > 0 ? "+" : ""}${rounded}`
}

function baseMasterLadder() {
  const diamondIndex = TIER_ORDER.indexOf("DIAMOND")
  return diamondIndex * 400 + 3 * 100 + 100
}

/**
 * IMPORTANT FIX:
 * For Master/GM/Chall, Riot's LP is already on the same "LP scale".
 * Do NOT add cutoffs again or GM points will appear above Challenger floor incorrectly.
 */
function ladderLpWithCutoffs(point: Pick<LpPoint, "tier" | "rank" | "lp">) {
  const tier = (point.tier ?? "").toUpperCase()
  const div = (point.rank ?? "").toUpperCase()
  const lp = Math.max(0, point.lp ?? 0)

  const tierIndex = TIER_ORDER.indexOf(tier as any)
  if (tierIndex === -1) return lp

  const divIndex = DIV_ORDER.indexOf(div as any)

  if (tierIndex <= TIER_ORDER.indexOf("DIAMOND")) {
    const base = tierIndex * 400
    const divOffset = divIndex === -1 ? 0 : divIndex * 100
    return base + divOffset + lp
  }

  // Master+ = baseMaster + LP
  return baseMasterLadder() + lp
}

// --- Color system (tier hue + division intensity) ---
const TIER_COLORS: Record<string, string> = {
  IRON: "#6B7280", // slate/steel
  BRONZE: "#B45309",
  SILVER: "#94A3B8",
  GOLD: "#F59E0B",
  PLATINUM: "#06B6D4",
  EMERALD: "#10B981",
  DIAMOND: "#3B82F6",
  MASTER: "#A855F7",
  GRANDMASTER: "#EF4444",
  CHALLENGER: "#FACC15",
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "")
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h
  const n = parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (v: number) => v.toString(16).padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** Blend toward white (t=0..1) */
function lighten(hex: string, t: number) {
  const { r, g, b } = hexToRgb(hex)
  const rr = Math.round(r + (255 - r) * t)
  const gg = Math.round(g + (255 - g) * t)
  const bb = Math.round(b + (255 - b) * t)
  return rgbToHex(rr, gg, bb)
}

function getTierWord(labelOrTier: string) {
  const w = (labelOrTier ?? "").toUpperCase().trim()
  const first = w.split(" ")[0]
  return first
}

function colorForPoint(p: Pick<LpPoint, "tier" | "rank">) {
  const tier = getTierWord(p.tier ?? "")
  const base = TIER_COLORS[tier] ?? "#2563EB"

  // If divisions exist, adjust intensity slightly (IV lightest → I strongest)
  const div = (p.rank ?? "").toUpperCase()
  const divIndex = DIV_ORDER.indexOf(div as any)
  if (divIndex === -1) return base

  // IV -> 0.45, III -> 0.30, II -> 0.18, I -> 0.05 (closer to base)
  const tMap = [0.45, 0.3, 0.18, 0.05]
  return lighten(base, tMap[divIndex] ?? 0.2)
}

function colorForTickLabel(label: string) {
  const tier = getTierWord(label)
  const base = TIER_COLORS[tier] ?? "#64748B"
  // divisions get a slightly lighter version
  const hasDiv = label.trim().split(" ").length > 1
  return hasDiv ? lighten(base, 0.25) : base
}

// --- Ticks (adaptive) ---
function buildLadderTicksFine(minValue: number, maxValue: number, cutoffs: RankCutoffs) {
  const min = Math.floor(minValue)
  const max = Math.ceil(maxValue)
  const ticks: Array<{ value: number; label: string }> = []
  const baseMaster = baseMasterLadder()

  const pushDivisionTicks = (tierIndex: number) => {
    for (let divIndex = 0; divIndex < DIV_ORDER.length; divIndex += 1) {
      const value = tierIndex * 400 + divIndex * 100
      if (value < min || value > max) continue
      const tierLabel = TIER_ORDER[tierIndex]
      ticks.push({ value, label: `${tierLabel} ${DIV_ORDER[divIndex]}` })
    }
  }

  const diamondIndex = TIER_ORDER.indexOf("DIAMOND")
  for (let tierIndex = 0; tierIndex <= diamondIndex; tierIndex += 1) {
    pushDivisionTicks(tierIndex)
  }

  const gmCutoff = baseMaster + cutoffs.grandmaster
  const challCutoff = baseMaster + cutoffs.challenger

  ;[
    { value: baseMaster, label: "MASTER" },
    { value: gmCutoff, label: "GRANDMASTER" },
    { value: challCutoff, label: "CHALLENGER" },
  ].forEach((t) => {
    if (t.value >= min && t.value <= max) ticks.push(t)
  })

  const unique = new Map<number, string>()
  for (const t of ticks) if (!unique.has(t.value)) unique.set(t.value, t.label)

  return Array.from(unique.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.value - b.value)
}

function buildLadderTicksCoarse(minValue: number, maxValue: number, cutoffs: RankCutoffs) {
  const min = Math.floor(minValue)
  const max = Math.ceil(maxValue)
  const ticks: Array<{ value: number; label: string }> = []

  // Tier-only boundaries up to Diamond
  const diamondIndex = TIER_ORDER.indexOf("DIAMOND")
  for (let tierIndex = 0; tierIndex <= diamondIndex; tierIndex += 1) {
    const value = tierIndex * 400
    if (value < min || value > max) continue
    ticks.push({ value, label: `${TIER_ORDER[tierIndex]}` })
  }

  const baseMaster = baseMasterLadder()
  const gmCutoff = baseMaster + cutoffs.grandmaster
  const challCutoff = baseMaster + cutoffs.challenger

  ;[
    { value: baseMaster, label: "MASTER" },
    { value: gmCutoff, label: "GRANDMASTER" },
    { value: challCutoff, label: "CHALLENGER" },
  ].forEach((t) => {
    if (t.value >= min && t.value <= max) ticks.push(t)
  })

  const unique = new Map<number, string>()
  for (const t of ticks) if (!unique.has(t.value)) unique.set(t.value, t.label)

  return Array.from(unique.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.value - b.value)
}

function buildLadderTicksAdaptive(minValue: number, maxValue: number, cutoffs: RankCutoffs) {
  const range = maxValue - minValue
  // zoomed out → coarse; zoomed in → fine
  return range > 1400 ? buildLadderTicksCoarse(minValue, maxValue, cutoffs) : buildLadderTicksFine(minValue, maxValue, cutoffs)
}

// --- Downsampling (caps points, preserves shape) ---
function downsamplePoints(points: NormalizedPoint[], target = 160) {
  const n = points.length
  if (n <= target) return points

  const keep = new Set<number>()
  keep.add(0)
  keep.add(n - 1)

  const bigJump = 80 // ladderValue jump threshold (captures big events)

  for (let i = 1; i < n - 1; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]
    const next = points[i + 1]

    // Tier/division change
    const tierChanged =
      (prev.tier ?? "").toUpperCase() !== (cur.tier ?? "").toUpperCase() ||
      (prev.rank ?? "").toUpperCase() !== (cur.rank ?? "").toUpperCase()
    if (tierChanged) keep.add(i)

    // Turning points (trend direction change)
    const d1 = cur.ladderValue - prev.ladderValue
    const d2 = next.ladderValue - cur.ladderValue
    if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) keep.add(i)

    // Big jump/drop
    if (Math.abs(d1) >= bigJump) keep.add(i)

    // Decay / off-game changes (same games but ladder changed)
    if (cur.totalGames === prev.totalGames && cur.ladderValue !== prev.ladderValue) keep.add(i)
  }

  // Fill with even sampling
  const desired = target
  const step = (n - 1) / (desired - 1)

  for (let k = 0; k < desired; k += 1) {
    const idx = Math.round(k * step)
    keep.add(idx)
  }

  let indices = Array.from(keep).sort((a, b) => a - b)

  // If still too many, evenly resample indices
  if (indices.length > desired) {
    const step2 = (indices.length - 1) / (desired - 1)
    const picked: number[] = []
    for (let k = 0; k < desired; k += 1) {
      picked.push(indices[Math.round(k * step2)])
    }
    // Ensure unique + sorted
    indices = Array.from(new Set(picked)).sort((a, b) => a - b)
    // If uniqueness shrank too much, pad lightly
    while (indices.length < desired) {
      const candidate = Math.floor(Math.random() * n)
      indices.push(candidate)
      indices = Array.from(new Set(indices)).sort((a, b) => a - b)
    }
  }

  return indices.map((i) => points[i])
}

function buildSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ""
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  const commands = [`M ${points[0].x} ${points[0].y}`]
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i]
    const next = points[i + 1]
    const midX = (current.x + next.x) / 2
    commands.push(`C ${midX} ${current.y}, ${midX} ${next.y}, ${next.x} ${next.y}`)
  }
  return commands.join(" ")
}

function describeProgression(first: NormalizedPoint, last: NormalizedPoint) {
  const diff = last.ladderValue - first.ladderValue
  const sign = diff >= 0 ? "+" : "-"
  const abs = Math.abs(Math.round(diff))

  // Decompose into tiers/divisions/LP-like remainder
  const tiers = Math.floor(abs / 400)
  const remTier = abs % 400
  const divs = Math.floor(remTier / 100)
  const rem = remTier % 100

  const parts: string[] = []
  if (tiers) parts.push(`${tiers} tier${tiers === 1 ? "" : "s"}`)
  if (divs) parts.push(`${divs} div${divs === 1 ? "" : "s"}`)
  if (rem) parts.push(`${rem} LP`)

  // If very small, just show LP-ish
  if (parts.length === 0) return "0"

  return `${sign}${parts.join(", ")}`
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
  const [selectedPuuid, setSelectedPuuid] = useState(players[0]?.puuid ?? "")
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)

  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!selectedPuuid && players[0]?.puuid) setSelectedPuuid(players[0].puuid)
  }, [players, selectedPuuid])

  const playersByPuuid = useMemo(() => new Map(players.map((p) => [p.puuid, p])), [players])

  const normalizedPoints = useMemo<NormalizedPoint[]>(() => {
    return points
      .map((p) => {
        const ts = new Date(p.fetched_at).getTime()
        if (Number.isNaN(ts)) return null
        return {
          ...p,
          lpValue: Math.max(0, p.lp ?? 0),
          ladderValue: ladderLpWithCutoffs(p),
          ts,
          totalGames: (p.wins ?? 0) + (p.losses ?? 0),
        }
      })
      .filter((p): p is NormalizedPoint => p !== null)
  }, [points])

  const pointsByPlayer = useMemo(() => {
    const rawGroups = new Map<string, NormalizedPoint[]>()
    for (const pt of normalizedPoints) {
      const list = rawGroups.get(pt.puuid)
      if (list) list.push(pt)
      else rawGroups.set(pt.puuid, [pt])
    }

    const byPlayer = new Map<string, NormalizedPoint[]>()

    for (const [puuid, list] of rawGroups.entries()) {
      list.sort((a, b) => a.ts - b.ts)

      const processed: NormalizedPoint[] = []
      let lastPoint: NormalizedPoint | null = null

      for (const pt of list) {
        if (!lastPoint) {
          processed.push(pt)
          lastPoint = pt
          continue
        }

        const gamesChanged = pt.totalGames > lastPoint.totalGames
        const ladderChanged = pt.ladderValue !== lastPoint.ladderValue

        if (gamesChanged || ladderChanged) {
          processed.push(pt)
          lastPoint = pt
        }
      }

      byPlayer.set(puuid, processed)
    }

    return byPlayer
  }, [normalizedPoints])

  const rawFiltered = useMemo(() => (selectedPuuid ? pointsByPlayer.get(selectedPuuid) ?? [] : []), [pointsByPlayer, selectedPuuid])

  // FIX: Downsample for performance + readability
  const filteredPoints = useMemo(() => {
    if (rawFiltered.length <= 180) return rawFiltered
    // dynamic target: more width -> more points, but keep it sane
    const target = rawFiltered.length > 800 ? 140 : 160
    return downsamplePoints(rawFiltered, target)
  }, [rawFiltered])

  const chart = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const baseMaster = baseMasterLadder()
    const gmFloor = baseMaster + cutoffs.grandmaster
    const challFloor = baseMaster + cutoffs.challenger

    const ladderValues = filteredPoints.map((p) => p.ladderValue)
    const rawMin = Math.min(...ladderValues, gmFloor, challFloor)
    const rawMax = Math.max(...ladderValues, gmFloor, challFloor)

    const min = rawMin - 20
    const max = rawMax + 20

    return { min, max, range: max - min || 1 }
  }, [cutoffs, filteredPoints])

  const firstMatch = filteredPoints.length > 0 ? filteredPoints[0].totalGames : 1
  const lastMatch = filteredPoints.length > 0 ? filteredPoints[filteredPoints.length - 1].totalGames : 1
  const matchRange = Math.max(lastMatch - firstMatch, 1)

  const plotPoints = useMemo(() => {
    if (!chart || filteredPoints.length === 0) return []
    return filteredPoints.map((point, idx) => {
      const normalizedX = (point.totalGames - firstMatch) / matchRange
      const x = PADDING.left + normalizedX * INNER_WIDTH
      const y = PADDING.top + INNER_HEIGHT - ((point.ladderValue - chart.min) / chart.range) * INNER_HEIGHT
      return { x, y, point, idx }
    })
  }, [chart, filteredPoints, firstMatch, matchRange])

  const cutoffPositions = useMemo(() => {
    if (!chart) return null
    const baseMaster = baseMasterLadder()
    const gmFloor = baseMaster + cutoffs.grandmaster
    const challFloor = baseMaster + cutoffs.challenger

    const gmY = PADDING.top + INNER_HEIGHT - ((gmFloor - chart.min) / chart.range) * INNER_HEIGHT
    const challY = PADDING.top + INNER_HEIGHT - ((challFloor - chart.min) / chart.range) * INNER_HEIGHT

    return {
      gmFloor,
      challFloor,
      gmY,
      challY,
      topY: PADDING.top,
      bottomY: PADDING.top + INNER_HEIGHT,
      highY: Math.min(gmY, challY),
      lowY: Math.max(gmY, challY),
    }
  }, [chart, cutoffs])

  const ladderTicks = useMemo(() => {
    if (!chart) return []
    return buildLadderTicksAdaptive(chart.min, chart.max, cutoffs)
  }, [chart, cutoffs])

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

    const unique = new Map<number, { x: number; label: number }>()
    ticks.forEach((t) => unique.set(t.label, t))
    return Array.from(unique.values()).sort((a, b) => a.label - b.label)
  }, [filteredPoints.length, firstMatch, lastMatch, matchRange])

  const linePath = useMemo(() => buildSmoothPath(plotPoints), [plotPoints])
  const areaPath = useMemo(() => {
    if (plotPoints.length === 0) return ""
    const baseY = PADDING.top + INNER_HEIGHT
    const first = plotPoints[0]
    const last = plotPoints[plotPoints.length - 1]
    return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`
  }, [plotPoints, linePath])

  // Tooltip positioning (pixel-correct)
  const setTooltipFromEvent = (p: NormalizedPoint, idx: number, e: React.MouseEvent) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const preferBelow = y < 120
    setTooltip({ point: p, idx, x, y, preferBelow })
  }

  const summary = useMemo(() => {
    if (rawFiltered.length === 0) return null
    const first = rawFiltered[0]
    const last = rawFiltered[rawFiltered.length - 1]
    return {
      current: formatRank(last.tier, last.rank, last.lp),
      debut: formatRank(first.tier, first.rank, first.lp),
      progression: describeProgression(first, last),
      matches: last.totalGames,
    }
  }, [rawFiltered])

  const activePlayer = playersByPuuid.get(selectedPuuid)
  const lineColor = "#2563eb"

  // Point radius: smaller when many points
  const pointRadius = plotPoints.length > 150 ? 4.5 : 6

  const tooltipRender = (() => {
    if (!tooltip) return null

    const wrap = wrapRef.current
    const wrapW = wrap?.clientWidth ?? 0
    const wrapH = wrap?.clientHeight ?? 0

    const x = wrapW ? clamp(tooltip.x, 120, wrapW - 120) : tooltip.x
    const y = wrapH ? clamp(tooltip.y, 20, wrapH - 20) : tooltip.y

    const cur = filteredPoints[tooltip.idx]
    const prev = filteredPoints[tooltip.idx - 1]
    const lpChange = prev ? cur.lpValue - prev.lpValue : 0
    const gamesSpan = prev ? cur.totalGames - prev.totalGames : 0

    const tier = (cur.tier ?? "").toUpperCase()
    const isMasterPlus = tier === "MASTER" || tier === "GRANDMASTER" || tier === "CHALLENGER"

    const style = tooltip.preferBelow
      ? { left: x, top: y + 14, transform: "translateX(-50%)" }
      : { left: x, top: y - 12, transform: "translate(-50%, -100%)" }

    const dotColor = colorForPoint(cur)

    return (
      <div
        className="pointer-events-none absolute z-10 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg"
        style={style as any}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dotColor }} />
          <div className="font-semibold text-slate-900">
            {cur.totalGames === 0 ? "Placement" : `Game #${cur.totalGames}`}
          </div>
        </div>

        <div className="mt-1">{formatRank(cur.tier, cur.rank, cur.lp)}</div>

        <div className="mt-1 flex items-center gap-2 text-slate-600">
          <span>LP {cur.lpValue}</span>
          <span className="text-slate-300">•</span>
          <span>Δ {formatDelta(lpChange)}</span>
          {gamesSpan > 1 ? (
            <>
              <span className="text-slate-300">•</span>
              <span>span +{gamesSpan} games</span>
            </>
          ) : null}
        </div>

        {typeof cur.wins === "number" && typeof cur.losses === "number" ? (
          <div className="mt-1 text-slate-500">
            Record {cur.wins}W-{cur.losses}L
          </div>
        ) : null}

        {isMasterPlus ? (
          <div className="mt-2 text-[10px] text-slate-500">
            Floors: GM {cutoffs.grandmaster} LP • Chall {cutoffs.challenger} LP (slot-limited tiers)
          </div>
        ) : null}
      </div>
    )
  })()

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold text-slate-900">LP Graph by Player</h2>
        <p className="text-sm text-slate-500">Rank progression by total games played</p>
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
                    ? "border-blue-500 bg-blue-500 text-white shadow-sm"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                {player.name}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={wrapRef} className="relative mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
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

              {/* Subtle Master+ bands (kept clean; not rainbow everywhere) */}
              {cutoffPositions ? (
                <>
                  <rect
                    x={PADDING.left}
                    y={cutoffPositions.topY}
                    width={INNER_WIDTH}
                    height={Math.max(0, cutoffPositions.highY - cutoffPositions.topY)}
                    fill={lighten(TIER_COLORS.CHALLENGER, 0.75)}
                    opacity={0.18}
                  />
                  <rect
                    x={PADDING.left}
                    y={cutoffPositions.highY}
                    width={INNER_WIDTH}
                    height={Math.max(0, cutoffPositions.lowY - cutoffPositions.highY)}
                    fill={lighten(TIER_COLORS.GRANDMASTER, 0.78)}
                    opacity={0.12}
                  />
                  <rect
                    x={PADDING.left}
                    y={cutoffPositions.lowY}
                    width={INNER_WIDTH}
                    height={Math.max(0, cutoffPositions.bottomY - cutoffPositions.lowY)}
                    fill={lighten(TIER_COLORS.MASTER, 0.84)}
                    opacity={0.10}
                  />
                </>
              ) : null}

              {ladderTicks.map((tick) => {
                const y = PADDING.top + INNER_HEIGHT - ((tick.value - chart.min) / chart.range) * INNER_HEIGHT
                const labelColor = colorForTickLabel(tick.label)
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
                      className="text-[10px] font-semibold"
                      style={{ fill: labelColor, opacity: 0.9 }}
                    >
                      {tick.label}
                    </text>
                  </g>
                )
              })}

              {/* Floor lines */}
              {cutoffPositions ? (
                <>
                  {[
                    { key: "chall", y: cutoffPositions.challY, label: `Chall floor: ${cutoffs.challenger} LP` },
                    { key: "gm", y: cutoffPositions.gmY, label: `GM floor: ${cutoffs.grandmaster} LP` },
                  ].map((c) => {
                    const labelW = 160
                    const labelH = 18
                    const labelX = WIDTH - PADDING.right - 6
                    const rectX = labelX - labelW
                    const rectY = clamp(c.y - 24, PADDING.top + 4, PADDING.top + INNER_HEIGHT - labelH - 4)
                    const textY = rectY + 13

                    return (
                      <g key={c.key}>
                        <line
                          x1={PADDING.left}
                          x2={WIDTH - PADDING.right}
                          y1={c.y}
                          y2={c.y}
                          className="stroke-slate-400"
                          strokeDasharray="4 4"
                        />
                        <rect x={rectX} y={rectY} width={labelW} height={labelH} rx={8} className="fill-white" opacity={0.92} />
                        <text x={labelX} y={textY} textAnchor="end" className="fill-slate-600 text-[10px] font-semibold">
                          {c.label}
                        </text>
                      </g>
                    )
                  })}
                </>
              ) : null}

              {xTicks.map((tick, idx) => (
                <g key={`${tick.label}-${idx}`}>
                  <line x1={tick.x} x2={tick.x} y1={PADDING.top} y2={PADDING.top + INNER_HEIGHT} className="stroke-slate-100" />
                  <text x={tick.x} y={HEIGHT - 16} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold">
                    {tick.label}
                  </text>
                </g>
              ))}

              {areaPath ? <path d={areaPath} fill={lineColor} opacity={0.10} /> : null}
              {linePath ? <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} /> : null}

              {/* Tier-colored points (all tiers, including iron) */}
              {plotPoints.map((plot) => {
                const c = colorForPoint(plot.point)
                return (
                  <circle
                    key={`point-${plot.idx}`}
                    cx={plot.x}
                    cy={plot.y}
                    r={pointRadius}
                    fill={c}
                    stroke="white"
                    strokeWidth={1.5}
                    onMouseEnter={(e) => setTooltipFromEvent(plot.point, plot.idx, e)}
                    onMouseMove={(e) => setTooltipFromEvent(plot.point, plot.idx, e)}
                    onMouseLeave={() => setTooltip(null)}
                    className="cursor-pointer"
                  />
                )
              })}
            </svg>

            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Total Games</span>
              <span>{activePlayer?.name ?? "Player"} selection</span>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500">
            No ranking history available.
          </div>
        )}

        {tooltipRender}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-6 py-5">
        <div className="grid gap-6 text-center sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Current Rank", value: summary?.current ?? "—" },
            { label: "Rank Debut", value: summary?.debut ?? "—" },
            { label: "Progression", value: summary?.progression ?? "—" },
            { label: "Matches", value: summary?.matches.toString() ?? "—" },
          ].map((item) => (
            <div key={item.label}>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{item.label}</div>
              <div className="mt-2 text-lg font-bold text-slate-900">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
