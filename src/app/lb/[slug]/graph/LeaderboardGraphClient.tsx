"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { formatRank } from "@/lib/rankFormat"

// --- Types ---
type PlayerSummary = {
  puuid: string
  name: string
  tagLine?: string | null
  profileIconUrl: string | null
  rankTier?: string | null
  rankDivision?: string | null
  lp?: number | null
  order?: number
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
const HEIGHT = 620
const PADDING = { top: 40, right: 0, bottom: 50, left: 0 }
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
  const sign = rounded > 0 ? "+" : "-"
  return `${sign} ${Math.abs(rounded)}`
}

function formatRankShort(tier?: string | null, division?: string | null) {
  if (!tier) return "UR"
  const normalizedTier = tier.toUpperCase()
  const tierMap: Record<string, string> = {
    IRON: "I",
    BRONZE: "B",
    SILVER: "S",
    GOLD: "G",
    PLATINUM: "P",
    EMERALD: "E",
    DIAMOND: "D",
    MASTER: "M",
    GRANDMASTER: "GM",
    CHALLENGER: "C",
  }
  const tierShort = tierMap[normalizedTier] ?? normalizedTier[0] ?? "U"
  if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(normalizedTier)) return tierShort
  const divMap: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4" }
  const div = division?.toUpperCase() ?? ""
  const divShort = divMap[div] ?? div
  return divShort ? `${tierShort}${divShort}` : tierShort
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

// --- Smart sampling (UX-friendly) ---
function smartSampleByGames(points: NormalizedPoint[]) {
  const n = points.length
  if (n <= 2) return points

  const lastGames = points[n - 1]?.totalGames ?? 0

  if (lastGames < 100) return points

  const step = lastGames <= 300 ? 3 : lastGames <= 600 ? 5 : 10

  const keep = new Set<number>()
  keep.add(0)
  keep.add(n - 1)

  for (let i = 1; i < n; i += 1) {
    const prev = points[i - 1]
    const cur = points[i]

    if (cur.totalGames % step === 0) keep.add(i)

    const tierChanged =
      (prev.tier ?? "").toUpperCase() !== (cur.tier ?? "").toUpperCase() ||
      (prev.rank ?? "").toUpperCase() !== (cur.rank ?? "").toUpperCase()
    if (tierChanged) keep.add(i)

    if (cur.totalGames === prev.totalGames && cur.ladderValue !== prev.ladderValue) keep.add(i)
  }

  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((i) => points[i])
}

function buildSharpPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ""
  return points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
}

function buildColoredLineSegments(
  points: Array<{ x: number; y: number; point: NormalizedPoint }>,
  getColor: (point: NormalizedPoint) => string
) {
  if (points.length === 0) return []
  const segments: Array<{ d: string; color: string }> = []

  let currentColor = getColor(points[0].point)
  let currentPath = `M ${points[0].x} ${points[0].y}`

  for (let i = 1; i < points.length; i += 1) {
    const next = points[i]
    const nextColor = getColor(next.point)
    currentPath += ` L ${next.x} ${next.y}`

    if (nextColor !== currentColor) {
      segments.push({ d: currentPath, color: currentColor })
      currentColor = nextColor
      currentPath = `M ${next.x} ${next.y}`
    }
  }

  segments.push({ d: currentPath, color: currentColor })
  return segments
}

function buildAreaPath(points: Array<{ x: number; y: number }>, baseY: number) {
  if (points.length === 0) return ""
  const first = points[0]
  const last = points[points.length - 1]
  const line = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
  return `${line} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`
}

function describeProgression(first: NormalizedPoint, last: NormalizedPoint) {
  const diff = Math.round((last.ladderValue ?? 0) - (first.ladderValue ?? 0))
  if (diff === 0) return "0 LP"
  return `${diff > 0 ? "+" : ""}${diff} LP`
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
  const [isHydrated, setIsHydrated] = useState(false)
  const [selectedPuuid, setSelectedPuuid] = useState(players[0]?.puuid ?? "")
  const [showAll, setShowAll] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [plotButtonStyle, setPlotButtonStyle] = useState<React.CSSProperties | null>(null)
  const [plotLabelStyle, setPlotLabelStyle] = useState<React.CSSProperties | null>(null)
  const clipId = useId().replace(/:/g, "")

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    setIsHydrated(true)
  }, [])

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

  const filteredWithLp = useMemo(() => rawFiltered.filter((p) => p.lp !== null && p.lp !== undefined), [rawFiltered])
  const last30Raw = useMemo(() => (filteredWithLp.length > 30 ? filteredWithLp.slice(-30) : filteredWithLp), [filteredWithLp])
  const visibleRaw = showAll ? rawFiltered : last30Raw

  // Smart sampling only when showing full history; keep all last-30 points intact.
  const filteredPoints = useMemo(() => {
    return showAll ? smartSampleByGames(visibleRaw) : visibleRaw
  }, [showAll, visibleRaw])

  const currentRankContext = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const midPoint = filteredPoints[Math.floor(filteredPoints.length / 2)]
    const tier = getTierWord(midPoint.tier ?? "")
    const div = (midPoint.rank ?? "").toUpperCase()
    const tierIndex = TIER_ORDER.indexOf(tier as any)
    const divIndex = DIV_ORDER.indexOf(div as any)
    return { tier, div, tierIndex, divIndex }
  }, [filteredPoints])

  const chart = useMemo(() => {
    if (filteredPoints.length === 0) return null
    const ladderValues = filteredPoints.map((p) => p.ladderValue)
    const rawMin = Math.min(...ladderValues)
    const rawMax = Math.max(...ladderValues)
    const min = rawMin - 50
    const max = rawMax + 50
    return { min, max, range: Math.max(max - min, 1) }
  }, [filteredPoints])

  const firstMatch = filteredPoints.length > 0 ? filteredPoints[0].totalGames : 1
  const lastMatch = filteredPoints.length > 0 ? filteredPoints[filteredPoints.length - 1].totalGames : 1
  const matchRange = Math.max(lastMatch - firstMatch, 1)

  const plotPoints = useMemo(() => {
    if (!chart || filteredPoints.length === 0) return []
    const useIndexSpacing = !showAll
    const maxIndex = Math.max(filteredPoints.length - 1, 1)
    return filteredPoints.map((point, idx) => {
      const normalizedX = useIndexSpacing ? idx / maxIndex : (point.totalGames - firstMatch) / matchRange
      const x = PADDING.left + normalizedX * INNER_WIDTH
      const y = PADDING.top + INNER_HEIGHT - ((point.ladderValue - chart.min) / chart.range) * INNER_HEIGHT
      return { x, y, point, idx }
    })
  }, [chart, filteredPoints, firstMatch, matchRange, showAll])

  const activePoint = hoveredIdx !== null ? plotPoints.find((p) => p.idx === hoveredIdx) ?? null : null

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

  const gmOffset = useMemo(() => {
    if (!cutoffPositions) return 0.5
    const pct = (cutoffPositions.gmY - PADDING.top) / INNER_HEIGHT
    return clamp(pct, 0, 1)
  }, [cutoffPositions])

  const ladderTicks = useMemo(() => {
    if (!chart) return []
    const all = buildLadderTicksAdaptive(chart.min, chart.max, cutoffs)
    if (filteredPoints.length === 0) return all
    return all
  }, [chart, cutoffs, filteredPoints])

  const xTicks = useMemo(() => {
    if (filteredPoints.length === 0) return []
    if (!showAll) {
      const tickCount = Math.min(6, filteredPoints.length)
      const maxIndex = Math.max(filteredPoints.length - 1, 1)
      const ticks = Array.from({ length: tickCount }, (_, idx) => {
        const normalized = tickCount === 1 ? 0 : idx / (tickCount - 1)
        const pointIndex = Math.round(normalized * maxIndex)
        const point = filteredPoints[pointIndex]
        const x = PADDING.left + (pointIndex / maxIndex) * INNER_WIDTH
        return { x, label: point?.totalGames ?? 0 }
      })
      const unique = new Map<number, { x: number; label: number }>()
      ticks.forEach((t) => unique.set(t.label, t))
      return Array.from(unique.values()).sort((a, b) => a.label - b.label)
    }

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
  }, [filteredPoints, firstMatch, lastMatch, matchRange, showAll])

  const normalizedTierForPoint = useMemo(() => {
    const baseMaster = baseMasterLadder()
    const gmFloor = baseMaster + cutoffs.grandmaster
    const challFloor = baseMaster + cutoffs.challenger
    return (point: NormalizedPoint) => {
      const tier = getTierWord(point.tier ?? "")
      if (tier === "CHALLENGER" && point.ladderValue < challFloor) return "MASTER"
      if (tier === "GRANDMASTER" && point.ladderValue < gmFloor) return "MASTER"
      return tier || "UNRANKED"
    }
  }, [cutoffs])

  const colorForLinePoint = useMemo(() => {
    return (point: NormalizedPoint) => colorForPoint({ tier: normalizedTierForPoint(point), rank: point.rank })
  }, [normalizedTierForPoint])

  const linePath = useMemo(() => buildSharpPath(plotPoints), [plotPoints])
  const lineSegments = useMemo(() => buildColoredLineSegments(plotPoints, colorForLinePoint), [plotPoints, colorForLinePoint])
  const areaPath = useMemo(() => {
    if (plotPoints.length === 0) return ""
    const baseY = PADDING.top + INNER_HEIGHT
    const first = plotPoints[0]
    const last = plotPoints[plotPoints.length - 1]
    return `${linePath} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`
  }, [plotPoints, linePath])
  const tierBands = useMemo(() => {
    if (!chart) return [] as Array<{ y: number; height: number; color: string }>
    const bands: Array<{ min: number; max: number; color: string }> = []
    const baseMaster = baseMasterLadder()

    for (let tierIndex = 0; tierIndex < TIER_ORDER.length; tierIndex += 1) {
      const tier = TIER_ORDER[tierIndex]
      if (tierIndex <= TIER_ORDER.indexOf("DIAMOND")) {
        bands.push({
          min: tierIndex * 400,
          max: (tierIndex + 1) * 400,
          color: TIER_COLORS[tier],
        })
      }
    }

    bands.push({ min: baseMaster, max: baseMaster + cutoffs.grandmaster, color: TIER_COLORS.MASTER })
    bands.push({
      min: baseMaster + cutoffs.grandmaster,
      max: baseMaster + cutoffs.challenger,
      color: TIER_COLORS.GRANDMASTER,
    })
    bands.push({
      min: baseMaster + cutoffs.challenger,
      max: baseMaster + cutoffs.challenger + 1000,
      color: TIER_COLORS.CHALLENGER,
    })

    return bands
      .map((band) => {
        const clampedMin = Math.max(band.min, chart.min)
        const clampedMax = Math.min(band.max, chart.max)
        if (clampedMax <= clampedMin) return null
        const yTop = PADDING.top + INNER_HEIGHT - ((clampedMax - chart.min) / chart.range) * INNER_HEIGHT
        const yBottom = PADDING.top + INNER_HEIGHT - ((clampedMin - chart.min) / chart.range) * INNER_HEIGHT
        return { y: yTop, height: yBottom - yTop, color: band.color }
      })
      .filter((band): band is { y: number; height: number; color: string } => band !== null)
  }, [chart, cutoffs])

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

  const handleChartHover = (e: React.MouseEvent<SVGSVGElement>) => {
    if (plotPoints.length === 0) return
    const wrap = wrapRef.current
    if (!wrap) return
    const wrapRect = wrap.getBoundingClientRect()
    const svgRect = e.currentTarget.getBoundingClientRect()
    const scaleX = WIDTH / Math.max(svgRect.width, 1)
    const x = (e.clientX - svgRect.left) * scaleX
    const chartX = clamp(x, PADDING.left, PADDING.left + INNER_WIDTH)
    let nearest = plotPoints[0]
    for (let i = 0; i < plotPoints.length; i += 1) {
      const left = i === 0 ? PADDING.left : (plotPoints[i - 1].x + plotPoints[i].x) / 2
      const right =
        i === plotPoints.length - 1 ? PADDING.left + INNER_WIDTH : (plotPoints[i].x + plotPoints[i + 1].x) / 2
      if (chartX >= left && chartX <= right) {
        nearest = plotPoints[i]
        break
      }
    }
    const y = e.clientY - wrapRect.top
    setHoveredIdx(nearest.idx)
    setTooltip({ point: nearest.point, idx: nearest.idx, x: chartX, y, preferBelow: y < 120 })
  }

  const handleChartLeave = () => {
    setHoveredIdx(null)
    setTooltip(null)
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
  const latestPoint = rawFiltered.length > 0 ? rawFiltered[rawFiltered.length - 1] : null
  const winRateSummary = useMemo(() => {
    if (!latestPoint) return null
    const wins = latestPoint.wins ?? 0
    const losses = latestPoint.losses ?? 0
    const games = wins + losses
    if (!games) return { wins, losses, games: 0, rate: 0 }
    const rate = (wins / games) * 100
    return { wins, losses, games, rate }
  }, [latestPoint])
  const lineColor = "#a78bfa"
  const activeSlice = useMemo(() => {
    if (!activePoint) return null
    const idx = activePoint.idx
    const left = idx === 0 ? PADDING.left : (plotPoints[idx - 1].x + plotPoints[idx].x) / 2
    const right =
      idx === plotPoints.length - 1 ? PADDING.left + INNER_WIDTH : (plotPoints[idx].x + plotPoints[idx + 1].x) / 2
    return { left, right, width: right - left }
  }, [activePoint, plotPoints])

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
    const lpChange = prev ? cur.ladderValue - prev.ladderValue : 0
    const gamesSpan = prev ? cur.totalGames - prev.totalGames : 0

    const style = tooltip.preferBelow
      ? { left: x - 14, top: y + 14, transform: "translateX(-100%)" }
      : { left: x - 14, top: y - 12, transform: "translate(-100%, -100%)" }

    return (
      <div
        className="pointer-events-none absolute z-10 rounded-2xl border border-slate-800/70 bg-slate-950/85 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur"
        style={style as any}
      >
        <div className="font-semibold text-slate-100">
          {cur.totalGames === 0 ? "Placement" : `Game #${cur.totalGames}`}
        </div>
        <div className="mt-1 text-slate-400">
          {formatRank(normalizedTierForPoint(cur), cur.rank, cur.lp)}
        </div>
        <div className={`mt-1 ${lpChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {formatDelta(lpChange)} LP • {cur.lpValue} LP
        </div>
      </div>
    )
  })()

  const handleShowAll = () => setShowAll(true)
  const handleReset = () => setShowAll(false)
  const latestGameNumber = rawFiltered.length > 0 ? rawFiltered[rawFiltered.length - 1].totalGames : 0
  const viewedGameCount = showAll ? latestGameNumber : Math.min(30, latestGameNumber)
  const peakPoint = useMemo(() => {
    if (rawFiltered.length === 0) return null
    const peakRaw = rawFiltered.reduce((best, cur) => (cur.ladderValue > best.ladderValue ? cur : best), rawFiltered[0])
    if (!chart) return null
    const normalizedX = showAll
      ? (peakRaw.totalGames - firstMatch) / matchRange
      : Math.max(0, rawFiltered.length - 1) === 0
        ? 0
        : rawFiltered.indexOf(peakRaw) / Math.max(rawFiltered.length - 1, 1)
    const x = PADDING.left + normalizedX * INNER_WIDTH
    const y = PADDING.top + INNER_HEIGHT - ((peakRaw.ladderValue - chart.min) / chart.range) * INNER_HEIGHT
    return { x, y, point: peakRaw }
  }, [chart, firstMatch, matchRange, rawFiltered, showAll])
  const peakSummary = useMemo(() => {
    if (!peakPoint) return null
    const tier = normalizedTierForPoint(peakPoint.point)
    const peakColor = colorForPoint({ tier, rank: peakPoint.point.rank })
    return {
      short: formatRankShort(tier, peakPoint.point.rank),
      lp: peakPoint.point.lpValue,
      color: peakColor,
    }
  }, [normalizedTierForPoint, peakPoint])
  const currentRankColor = useMemo(() => {
    if (!activePlayer?.rankTier) return "#94a3b8"
    return colorForPoint({ tier: activePlayer.rankTier, rank: activePlayer.rankDivision ?? null })
  }, [activePlayer])
  useEffect(() => {
    const wrap = wrapRef.current
    const svg = svgRef.current
    if (!wrap || !svg) return

    const update = () => {
      const wrapRect = wrap.getBoundingClientRect()
      const svgRect = svg.getBoundingClientRect()
      const scaleX = svgRect.width / WIDTH
      const scaleY = svgRect.height / HEIGHT
      const plotLeft = svgRect.left - wrapRect.left + PADDING.left * scaleX
      const plotRight = svgRect.left - wrapRect.left + (PADDING.left + INNER_WIDTH) * scaleX
      const plotBottom = svgRect.top - wrapRect.top + (PADDING.top + INNER_HEIGHT) * scaleY
      setPlotButtonStyle({ left: plotRight - 2, top: plotBottom - 2, transform: "translate(-100%, -100%)" })
      setPlotLabelStyle({ left: plotLeft, top: plotBottom + 8, width: plotRight - plotLeft })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(wrap)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
    }
  }, [])

  if (!isHydrated) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-800/80 dark:bg-slate-900/80 dark:shadow-[0_30px_80px_-40px_rgba(0,0,0,0.75)]">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="p-4 lg:border-r border-slate-200 dark:border-slate-800/80">
            <div className="mb-4 flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600" />
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Leaderboard</h2>
            </div>
            <div className="leaderboard-scroll max-h-[80vh] divide-y divide-slate-200/70 overflow-y-auto pr-1 [direction:rtl] dark:divide-slate-800/70" />
          </aside>
          <div className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              Loading ranking history…
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-800/80 dark:bg-slate-900/80 dark:shadow-[0_30px_80px_-40px_rgba(0,0,0,0.75)]">
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="p-4 lg:border-r border-slate-200 dark:border-slate-800/80">
          <div className="mb-4 flex items-center gap-2">
            <div className="h-1 w-8 rounded-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-600" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Leaderboard</h2>
          </div>
          <div className="leaderboard-scroll max-h-[80vh] divide-y divide-slate-200/70 overflow-y-auto pr-1 [direction:rtl] dark:divide-slate-800/70">
            {players.map((player, idx) => {
              const isActive = player.puuid === selectedPuuid
              const lpLabel = player.lp ?? 0
              const tier = (player.rankTier ?? "").toUpperCase()
              const div = (player.rankDivision ?? "").toUpperCase()
              const tierMap: Record<string, string> = {
                IRON: "I",
                BRONZE: "B",
                SILVER: "S",
                GOLD: "G",
                PLATINUM: "P",
                EMERALD: "E",
                DIAMOND: "D",
                MASTER: "M",
                GRANDMASTER: "GM",
                CHALLENGER: "C",
              }
              const rankAbbr = `${tierMap[tier] ?? ""}${div ? div.replace("IV", "4").replace("III", "3").replace("II", "2").replace("I", "1") : ""}`.trim()
              return (
                <button
                  key={player.puuid}
                  type="button"
                  onClick={() => setSelectedPuuid(player.puuid)}
                  className={`w-full px-1.5 py-2 text-left transition ${
                    isActive
                      ? "bg-blue-500/10"
                      : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                  } [direction:ltr]`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-6 text-right text-[11px] font-semibold ${
                      isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-500"
                    }`}>
                      {player.order ?? idx + 1}
                    </div>
                    <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                      {player.name}
                    </div>
                    <div className="flex items-center gap-2 text-[12px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
                      {rankAbbr ? <span className="text-[11px] text-slate-500 dark:text-slate-500">{rankAbbr}</span> : null}
                      <span>{lpLabel}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
          <div className="p-0">
            <div
              ref={wrapRef}
              className="relative overflow-hidden bg-transparent pt-16"
            >
              {activePlayer ? (
                <div className="absolute left-6 top-4 flex items-center gap-4">
                  {activePlayer.profileIconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={activePlayer.profileIconUrl}
                      alt=""
                      className="h-16 w-16 rounded-full border border-slate-200 shadow-[0_14px_36px_-18px_rgba(0,0,0,0.25)] dark:border-slate-800 dark:shadow-[0_14px_36px_-18px_rgba(0,0,0,0.9)]"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-slate-200 dark:bg-slate-800" />
                  )}
                  <div className="space-y-1 text-xs">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span className="font-semibold text-slate-500 dark:text-slate-400">#{activePlayer.order ?? 0}</span>{" "}
                      {activePlayer.name}
                      {activePlayer.tagLine ? (
                        <span className="text-slate-400 dark:text-slate-500 font-medium"> #{activePlayer.tagLine}</span>
                      ) : null}
                    </div>
                    <div className="text-slate-600 dark:text-slate-300">
                      <span className="font-semibold" style={{ color: currentRankColor }}>
                        {formatRank(activePlayer.rankTier, activePlayer.rankDivision, activePlayer.lp)}
                      </span>
                      {peakSummary ? (
                        <span className="text-slate-500 dark:text-slate-400">
                          {" "}|{" "}
                          <span style={{ color: peakSummary.color }}>{peakSummary.short}</span> {peakSummary.lp} peak lp
                        </span>
                      ) : null}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">
                      {winRateSummary
                        ? `${winRateSummary.rate.toFixed(0)}% winrate | ${winRateSummary.games} games`
                        : "No games"}
                    </div>
                  </div>
                </div>
              ) : null}
              {chart ? (
                <>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              className="h-auto w-full"
              onMouseMove={handleChartHover}
              onMouseLeave={handleChartLeave}
            >
              <rect
                x={PADDING.left}
                y={PADDING.top}
                width={INNER_WIDTH}
                height={INNER_HEIGHT}
                rx={0}
                className="fill-white dark:fill-slate-950"
              />

              <defs>
                <clipPath id={`plot-clip-${clipId}`}>
                  <rect
                    x={PADDING.left}
                    y={PADDING.top}
                    width={INNER_WIDTH}
                    height={INNER_HEIGHT}
                    rx={0}
                  />
                </clipPath>
                {areaPath ? (
                  <clipPath id={`area-clip-${clipId}`}>
                    <path d={areaPath} />
                  </clipPath>
                ) : null}
                <linearGradient id={`plot-fill-${clipId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.28} />
                  <stop offset={`${gmOffset * 100}%`} stopColor="#a78bfa" stopOpacity={0.22} />
                  <stop offset={`${gmOffset * 100}%`} stopColor="#38bdf8" stopOpacity={0.16} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.14} />
                </linearGradient>
              </defs>
              <g clipPath={`url(#plot-clip-${clipId})`}>
                {areaPath ? (
                  <g clipPath={`url(#area-clip-${clipId})`}>
                    {tierBands.map((band, idx) => (
                      <rect
                        key={`tier-band-${idx}`}
                        x={PADDING.left}
                        y={band.y}
                        width={INNER_WIDTH}
                        height={band.height}
                        fill={band.color}
                        opacity={0.22}
                      />
                    ))}
                  </g>
                ) : null}
                {/* Subtle Master+ bands (kept clean; not rainbow everywhere) */}
                {cutoffPositions ? null : null}

                {ladderTicks.map((tick) => {
                  const y = PADDING.top + INNER_HEIGHT - ((tick.value - chart.min) / chart.range) * INNER_HEIGHT
                  const labelColor = colorForTickLabel(tick.label)
                  return (
                    <g key={`${tick.label}-${tick.value}`}>
                      <text
                        x={PADDING.left + 10}
                        y={y - 6}
                        textAnchor="start"
                        className="text-[11px] font-semibold"
                        style={{ fill: labelColor, opacity: 0.85 }}
                      >
                        {tick.label}
                      </text>
                    </g>
                  )
                })}

                {xTicks.map((tick, idx) => (
                  <g key={`${tick.label}-${idx}`}></g>
                ))}

                {chart ? (
                  (() => {
                    const lines: Array<{ value: number; label: string }> = []
                    const step = showAll ? 100 : 50
                    const start = Math.floor(chart.min / step) * step
                    const end = showAll ? Math.ceil(chart.max / 100) * 100 + 100 : Math.ceil(chart.max / 50) * 50
                    const baseMaster = baseMasterLadder()
                    const labelForValue = (value: number) => {
                      if (value >= baseMaster) {
                        const diff = Math.max(0, Math.round(value - baseMaster))
                        if (showAll) return diff === 0 ? "" : String(diff)
                        return String(diff)
                      }
                      return ""
                    }

                    for (let value = start; value <= end; value += step) {
                      lines.push({ value, label: labelForValue(value) })
                    }

                    return lines.map((line, idx) => {
                      const y = PADDING.top + INNER_HEIGHT - ((line.value - chart.min) / chart.range) * INNER_HEIGHT
                      return (
                        <g key={`lp-grid-${line.value}-${idx}`}>
                          <line
                            x1={PADDING.left}
                            x2={PADDING.left + INNER_WIDTH}
                            y1={y}
                            y2={y}
                            className="stroke-slate-200/70 dark:stroke-slate-800/70"
                          />
                          {line.label ? (
                            <text
                              x={PADDING.left + 8}
                              y={y + 4}
                              textAnchor="start"
                              className="text-[10px] font-semibold fill-slate-400 dark:fill-slate-500"
                            >
                              {line.label}
                            </text>
                          ) : null}
                        </g>
                      )
                    })
                  })()
                ) : null}

                {areaPath ? <path d={areaPath} fill={`url(#plot-fill-${clipId})`} opacity={0.9} /> : null}
                {lineSegments.length > 0
                  ? lineSegments.map((seg, idx) => (
                      <path key={`line-seg-${idx}`} d={seg.d} fill="none" stroke={seg.color || lineColor} strokeWidth={2.5} />
                    ))
                  : null}

                {peakPoint ? (
                  <g>
                    <line
                      x1={PADDING.left}
                      x2={PADDING.left + INNER_WIDTH}
                      y1={peakPoint.y}
                      y2={peakPoint.y}
                      stroke="rgba(148, 163, 184, 0.45)"
                      strokeDasharray="4 4"
                    />
                    <text
                      x={PADDING.left + INNER_WIDTH - 4}
                      y={peakPoint.y - 6}
                      textAnchor="end"
                      className="text-[11px] font-semibold"
                      fill="rgba(148, 163, 184, 0.9)"
                    >
                      {formatRank(normalizedTierForPoint(peakPoint.point), peakPoint.point.rank, peakPoint.point.lp)} • Peak
                    </text>
                  </g>
                ) : null}

                {/* Tier-colored points (all tiers, including iron) */}
                {plotPoints.map((plot, idx) => {
                  const x0 = idx === 0 ? PADDING.left : (plotPoints[idx - 1].x + plot.x) / 2
                  const x1 = idx === plotPoints.length - 1 ? PADDING.left + INNER_WIDTH : (plot.x + plotPoints[idx + 1].x) / 2
                  return (
                    <rect
                      key={`hover-${plot.idx}`}
                      x={x0}
                      y={PADDING.top}
                      width={Math.max(4, x1 - x0)}
                      height={INNER_HEIGHT}
                      fill="transparent"
                    />
                  )
                })}

                {activePoint && activeSlice ? (
                  <g>
                    <rect
                      x={activeSlice.left}
                      y={PADDING.top}
                      width={activeSlice.width}
                      height={INNER_HEIGHT}
                      fill="rgba(148, 163, 184, 0.12)"
                    />
                    <line
                      x1={activePoint.x}
                      x2={activePoint.x}
                      y1={PADDING.top}
                      y2={PADDING.top + INNER_HEIGHT}
                      stroke="rgba(148, 163, 184, 0.3)"
                      strokeWidth={1}
                    />
                    <circle
                      cx={activePoint.x}
                      cy={activePoint.y}
                      r={pointRadius + 8}
                      fill="none"
                      stroke="rgba(148, 163, 184, 0.4)"
                      strokeWidth={1.5}
                    />
                    <circle
                      cx={activePoint.x}
                      cy={activePoint.y}
                      r={pointRadius + 2}
                      fill={colorForLinePoint(activePoint.point)}
                      stroke="#0f172a"
                      strokeWidth={2}
                    />
                  </g>
                ) : null}
              </g>
            </svg>

                  <button
                    type="button"
                    onClick={showAll ? handleReset : handleShowAll}
                    className="absolute bottom-3 right-3 z-10 whitespace-nowrap rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-800/70 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                    style={plotButtonStyle ?? undefined}
                  >
                    {showAll ? "Reset" : "Show all"}
                  </button>
                </>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              No ranking history available.
            </div>
          )}

              {tooltipRender}
              <div
                className="absolute bottom-3 left-3 right-3 z-10 flex justify-between px-1 text-xs text-slate-500 dark:text-slate-400"
                style={plotLabelStyle ?? undefined}
              >
                <span>
                  {showAll
                    ? `Showing ${latestGameNumber} games`
                    : `Last ${viewedGameCount} games`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
