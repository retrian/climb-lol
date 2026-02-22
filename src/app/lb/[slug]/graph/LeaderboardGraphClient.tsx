"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
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
  lp_delta?: number | null
  lp_note?: string | null
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
  lpDelta: number | null
  ladderValue: number
  ts: number
  totalGames: number
}

type TooltipState = {
  point: NormalizedPoint
  idx: number
  x: number
  y: number
  wrapWidth: number
  preferBelow: boolean
}


// --- Constants ---
const WIDTH = 960
const HEIGHT = 620
const PADDING = { top: 40, right: 0, bottom: 50, left: 0 }
const INNER_WIDTH = WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = HEIGHT - PADDING.top - PADDING.bottom
const RECENT_HISTORY_LIMIT = 30
const DENSE_MODE_THRESHOLD = 50
const RECENT_QUERY_VERSION = "recent_v2"
const REALTIME_REFRESH_MS = 5000
const OVERLAY_COLORS = ["#a78bfa", "#22d3ee", "#34d399", "#f59e0b", "#f472b6", "#60a5fa", "#f87171"] as const

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

  const tierIndex = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number])
  if (tierIndex === -1) return lp

  const divIndex = DIV_ORDER.indexOf(div as (typeof DIV_ORDER)[number])

  if (tierIndex <= TIER_ORDER.indexOf("DIAMOND")) {
    const base = tierIndex * 400
    const divOffset = divIndex === -1 ? 0 : divIndex * 100
    return base + divOffset + lp
  }

  // Master+ = baseMaster + LP
  return baseMasterLadder() + lp
}

function stepDivision(
  tier: string | null,
  rank: string | null,
  direction: 1 | -1
): { tier: string | null; rank: string | null } {
  const normalizedTier = (tier ?? "").toUpperCase()
  const normalizedRank = (rank ?? "").toUpperCase()
  const tierIndex = TIER_ORDER.indexOf(normalizedTier as (typeof TIER_ORDER)[number])
  const divIndex = DIV_ORDER.indexOf(normalizedRank as (typeof DIV_ORDER)[number])

  if (tierIndex === -1) return { tier, rank }

  // Apex tiers do not use divisions in Riot display rank.
  // Handle explicit up/down movement across MASTER/GM/CHALL and MASTER<->DIAMOND I.
  if (normalizedTier === "MASTER" || normalizedTier === "GRANDMASTER" || normalizedTier === "CHALLENGER") {
    if (direction === 1) {
      if (normalizedTier === "MASTER") return { tier: "GRANDMASTER", rank: null }
      if (normalizedTier === "GRANDMASTER") return { tier: "CHALLENGER", rank: null }
      return { tier: "CHALLENGER", rank: null }
    }

    if (normalizedTier === "CHALLENGER") return { tier: "GRANDMASTER", rank: null }
    if (normalizedTier === "GRANDMASTER") return { tier: "MASTER", rank: null }
    return { tier: "DIAMOND", rank: "I" }
  }

  if (divIndex === -1) return { tier, rank }

  const diamondIndex = TIER_ORDER.indexOf("DIAMOND")

  if (direction === 1) {
    if (divIndex < DIV_ORDER.length - 1) {
      return { tier: TIER_ORDER[tierIndex], rank: DIV_ORDER[divIndex + 1] }
    }
    if (tierIndex < diamondIndex) {
      return { tier: TIER_ORDER[tierIndex + 1], rank: "IV" }
    }
    // DIAMOND I -> MASTER
    return { tier: "MASTER", rank: null }
  }

  if (divIndex > 0) {
    return { tier: TIER_ORDER[tierIndex], rank: DIV_ORDER[divIndex - 1] }
  }
  if (tierIndex > 0) {
    return { tier: TIER_ORDER[tierIndex - 1], rank: "I" }
  }

  return { tier: TIER_ORDER[tierIndex], rank: DIV_ORDER[divIndex] }
}

function resolvePostMatchRank(
  preTier: string | null,
  preRank: string | null,
  lpNote: string | null | undefined
) {
  const note = (lpNote ?? "").toUpperCase()
  if (note === "PROMOTED") return stepDivision(preTier, preRank, 1)
  if (note === "DEMOTED") return stepDivision(preTier, preRank, -1)
  return { tier: preTier, rank: preRank }
}

function normalizeHistoryPoints(
  sourcePoints: LpPoint[],
  fallbackRank: { tier: string | null; rank: string | null }
): NormalizedPoint[] {
  const parsed = sourcePoints
    .map((p) => {
      const ts = new Date(p.fetched_at).getTime()
      if (Number.isNaN(ts)) return null
      return { ...p, ts }
    })
    .filter((p): p is LpPoint & { ts: number } => p !== null)
    .sort((a, b) => a.ts - b.ts)

  const prevKnown: Array<{ tier: string | null; rank: string | null } | null> = []
  let lastKnown: { tier: string | null; rank: string | null } | null = null
  for (let i = 0; i < parsed.length; i += 1) {
    const cur = parsed[i]
    if (cur.tier) lastKnown = { tier: cur.tier, rank: cur.rank ?? null }
    prevKnown[i] = lastKnown
  }

  const nextKnown: Array<{ tier: string | null; rank: string | null } | null> = new Array(parsed.length).fill(null)
  let upcomingKnown: { tier: string | null; rank: string | null } | null = null
  for (let i = parsed.length - 1; i >= 0; i -= 1) {
    const cur = parsed[i]
    if (cur.tier) upcomingKnown = { tier: cur.tier, rank: cur.rank ?? null }
    nextKnown[i] = upcomingKnown
  }

  return parsed.map((p, idx) => {
    const prev = prevKnown[idx]
    const next = nextKnown[idx]
    const inferredTier = p.tier ?? prev?.tier ?? next?.tier ?? fallbackRank.tier
    const inferredRank = p.rank ?? prev?.rank ?? next?.rank ?? (p.tier ? p.rank : fallbackRank.rank)
    const resolved = resolvePostMatchRank(inferredTier, inferredRank, p.lp_note)

    return {
      ...p,
      tier: resolved.tier,
      rank: resolved.rank,
      lpValue: Math.max(0, p.lp ?? 0),
      lpDelta: typeof p.lp_delta === "number" && Number.isFinite(p.lp_delta) ? p.lp_delta : null,
      totalGames: (p.wins ?? 0) + (p.losses ?? 0),
      ladderValue: ladderLpWithCutoffs({ tier: resolved.tier, rank: resolved.rank, lp: p.lp }),
    }
  })
}

function compressChangedPoints(points: NormalizedPoint[]) {
  const sorted = [...points].sort((a, b) => a.ts - b.ts)
  const processed: NormalizedPoint[] = []
  let lastPoint: NormalizedPoint | null = null

  for (const pt of sorted) {
    if (!lastPoint) {
      processed.push(pt)
      lastPoint = pt
      continue
    }

    const gamesChanged = pt.totalGames > lastPoint.totalGames
    const ladderChanged = pt.ladderValue !== lastPoint.ladderValue
    const lpChanged = pt.lp !== lastPoint.lp

    if (gamesChanged || ladderChanged || lpChanged) {
      processed.push(pt)
      lastPoint = pt
    }
  }

  return processed
}

function takeRecentPoints(points: NormalizedPoint[]) {
  const withLp = points.filter((p) => p.lp !== null && p.lp !== undefined)
  const selected: NormalizedPoint[] = []
  const seenGames = new Set<number>()
  for (let i = withLp.length - 1; i >= 0; i -= 1) {
    const p = withLp[i]
    if (seenGames.has(p.totalGames)) continue
    seenGames.add(p.totalGames)
    selected.push(p)
    if (seenGames.size >= RECENT_HISTORY_LIMIT) break
  }
  return selected.reverse()
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
  const divIndex = DIV_ORDER.indexOf(div as (typeof DIV_ORDER)[number])
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

function computeDisplayedLpDelta(cur: NormalizedPoint, prev: NormalizedPoint) {
  const ladderDelta = cur.ladderValue - prev.ladderValue
  const tierChanged = (cur.tier ?? "").toUpperCase() !== (prev.tier ?? "").toUpperCase()
  const divisionChanged = (cur.rank ?? "").toUpperCase() !== (prev.rank ?? "").toUpperCase()
  const note = (cur.lp_note ?? "").toUpperCase()
  const hasBoundaryNote = note === "PROMOTED" || note === "DEMOTED"

  // Always trust ladder math when crossing boundaries, because event lp_delta can be
  // stored on a different scale around promotions/demotions.
  if (Number.isFinite(ladderDelta) && (tierChanged || divisionChanged || hasBoundaryNote)) {
    return ladderDelta
  }

  if (typeof cur.lpDelta === "number" && Number.isFinite(cur.lpDelta)) {
    // Guard against inconsistent event deltas; if it disagrees heavily with ladder movement,
    // prefer ladder movement for display.
    if (Number.isFinite(ladderDelta) && Math.abs(cur.lpDelta - ladderDelta) >= 20) {
      return ladderDelta
    }
    return cur.lpDelta
  }

  // Use full ladder value delta so division/tier transitions are always correct
  // (e.g. D3 84 -> D2 4 = +20, not -80).
  if (Number.isFinite(ladderDelta)) return ladderDelta
  return cur.lpValue - prev.lpValue
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

export default function LeaderboardGraphClient({
  players,
  slug,
  cutoffs,
}: {
  players: PlayerSummary[]
  slug: string
  cutoffs: RankCutoffs
}) {
  const [selectedPuuid, setSelectedPuuid] = useState(players[0]?.puuid ?? "")
  const [recentPoints, setRecentPoints] = useState<LpPoint[]>([])
  const [fullPoints, setFullPoints] = useState<LpPoint[] | null>(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [isLoadingFullHistory, setIsLoadingFullHistory] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [overlayMode, setOverlayMode] = useState(false)
  const [overlaySelectedPuuids, setOverlaySelectedPuuids] = useState<string[]>(players[0]?.puuid ? [players[0].puuid] : [])
  const [overlayRecentByPuuid, setOverlayRecentByPuuid] = useState<Record<string, LpPoint[]>>({})
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [plotButtonStyle, setPlotButtonStyle] = useState<React.CSSProperties | null>(null)
  const [plotLabelStyle, setPlotLabelStyle] = useState<React.CSSProperties | null>(null)
  const clipId = useId().replace(/:/g, "")

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const prefetchCacheRef = useRef<Map<string, LpPoint[]>>(new Map())
  const inflightRef = useRef<Map<string, Promise<LpPoint[]>>>(new Map())

  const effectiveSelectedPuuid =
    overlayMode && overlaySelectedPuuids.length > 0
      ? overlaySelectedPuuids.includes(selectedPuuid)
        ? selectedPuuid
        : overlaySelectedPuuids[0]
      : selectedPuuid || players[0]?.puuid || ""

  const fetchPlayerHistory = useCallback(
    async (puuid: string, mode: "recent" | "full", options?: { force?: boolean }): Promise<LpPoint[]> => {
      const force = options?.force === true
      const key = mode === "recent" ? `${puuid}:${mode}:${RECENT_QUERY_VERSION}` : `${puuid}:${mode}`
      if (!force) {
        const cached = prefetchCacheRef.current.get(key)
        if (cached) return cached
      }

      const inflight = inflightRef.current.get(key)
      if (inflight) return inflight

      if (force) prefetchCacheRef.current.delete(key)

      const query =
        mode === "recent"
          ? `?puuid=${encodeURIComponent(puuid)}&limit=${RECENT_HISTORY_LIMIT}&v=${encodeURIComponent(RECENT_QUERY_VERSION)}`
          : `?puuid=${encodeURIComponent(puuid)}&full=1`

      const request = fetch(`/api/lb/${encodeURIComponent(slug)}/graph${query}`, {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then(async (res) => {
          if (!res.ok) return [] as LpPoint[]
          const json = await res.json().catch(() => null)
          const points = Array.isArray(json?.points) ? (json.points as LpPoint[]) : []
          prefetchCacheRef.current.set(key, points)
          return points
        })
        .finally(() => {
          inflightRef.current.delete(key)
        })

      inflightRef.current.set(key, request)
      return request
    },
    [slug]
  )

  useEffect(() => {
    let cancelled = false

    if (!effectiveSelectedPuuid) {
      queueMicrotask(() => {
        if (cancelled) return
        setRecentPoints([])
        setIsLoadingHistory(false)
      })
      return () => {
        cancelled = true
      }
    }

    const cacheKey = `${effectiveSelectedPuuid}:full`
    const cached = prefetchCacheRef.current.get(cacheKey)
    if (cached) {
      queueMicrotask(() => {
        if (cancelled) return
        setFullPoints(cached)
        setRecentPoints(cached)
        setIsLoadingHistory(false)
      })
      return () => {
        cancelled = true
      }
    }

    queueMicrotask(() => {
      if (cancelled) return
      setRecentPoints([])
      setIsLoadingHistory(true)
    })

    fetchPlayerHistory(effectiveSelectedPuuid, "full")
      .then((points) => {
        if (cancelled) return
        setFullPoints(points)
        setRecentPoints(points)
      })
      .catch(() => {
        if (cancelled) return
        setFullPoints([])
        setRecentPoints([])
      })
      .finally(() => {
        if (cancelled) return
        setIsLoadingHistory(false)
      })

    return () => {
      cancelled = true
    }
  }, [effectiveSelectedPuuid, fetchPlayerHistory])

  useEffect(() => {
    if (!effectiveSelectedPuuid) return

    let cancelled = false
    const refreshNow = () => {
      if (overlayMode) {
        overlaySelectedPuuids.forEach((puuid) => {
          void fetchPlayerHistory(puuid, "recent", { force: true })
            .then((points) => {
              if (cancelled) return
              setOverlayRecentByPuuid((prev) => ({ ...prev, [puuid]: points }))
            })
            .catch(() => {
              // Keep last successful render on transient polling failures.
            })
        })
        return
      }

      void fetchPlayerHistory(effectiveSelectedPuuid, "full", { force: true })
        .then((points) => {
          if (cancelled) return
          setFullPoints(points)
          setRecentPoints(points)
        })
        .catch(() => {
          // Keep last successful render on transient polling failures.
        })
    }

    // Refresh immediately, then continue polling.
    refreshNow()
    const interval = window.setInterval(refreshNow, REALTIME_REFRESH_MS)

    const onFocus = () => refreshNow()
    const onVisibility = () => {
      if (!document.hidden) refreshNow()
    }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [effectiveSelectedPuuid, fetchPlayerHistory, overlayMode, overlaySelectedPuuids])

  useEffect(() => {
    if (!overlayMode) return
    overlaySelectedPuuids.forEach((puuid) => {
      void fetchPlayerHistory(puuid, "recent")
        .then((points) => {
          setOverlayRecentByPuuid((prev) => ({ ...prev, [puuid]: points }))
        })
        .catch(() => {
          // noop
        })
    })
  }, [fetchPlayerHistory, overlayMode, overlaySelectedPuuids])

  const prefetchPlayerHistory = useCallback(
    (puuid: string) => {
      if (!puuid) return
      const key = `${puuid}:full`
      if (prefetchCacheRef.current.has(key) || inflightRef.current.has(key)) return
      void fetchPlayerHistory(puuid, "full")
    },
    [fetchPlayerHistory]
  )

  const handleShowAll = useCallback(() => {
    setShowAll(true)
    if (!effectiveSelectedPuuid || fullPoints || isLoadingFullHistory) return

    setIsLoadingFullHistory(true)
    void fetchPlayerHistory(effectiveSelectedPuuid, "full")
      .then((points) => {
        setFullPoints(points)
      })
      .catch(() => {
        setFullPoints([])
      })
      .finally(() => {
        setIsLoadingFullHistory(false)
      })
  }, [effectiveSelectedPuuid, fetchPlayerHistory, fullPoints, isLoadingFullHistory])

  const handleReset = useCallback(() => setShowAll(false), [])
  const handleSelectPlayer = useCallback((puuid: string) => {
    setSelectedPuuid(puuid)
    setShowAll(false)
    setHoveredIdx(null)
    setTooltip(null)
    setFullPoints(null)
    setIsLoadingFullHistory(false)
  }, [])

  const handleToggleOverlayMode = useCallback(() => {
    setOverlayMode((prev) => {
      const next = !prev
      if (next) {
        setShowAll(false)
        setOverlaySelectedPuuids((curr) => {
          const fallback = selectedPuuid || players[0]?.puuid || ""
          if (!fallback) return curr
          return curr.length > 0 ? curr : [fallback]
        })
      }
      return next
    })
  }, [players, selectedPuuid])

  const handleToggleOverlayPlayer = useCallback((puuid: string) => {
    setOverlaySelectedPuuids((prev) => {
      if (prev.includes(puuid)) {
        if (prev.length === 1) return prev
        const next = prev.filter((id) => id !== puuid)
        if (selectedPuuid === puuid) setSelectedPuuid(next[0] ?? puuid)
        return next
      }
      return [...prev, puuid]
    })
  }, [selectedPuuid])


  const playersByPuuid = useMemo(() => new Map(players.map((p) => [p.puuid, p])), [players])
  const selectedPlayerRankFallback = useMemo(() => {
    const player = playersByPuuid.get(effectiveSelectedPuuid)
    return {
      tier: player?.rankTier ?? null,
      rank: player?.rankDivision ?? null,
    }
  }, [effectiveSelectedPuuid, playersByPuuid])

  const normalizedPoints = useMemo<NormalizedPoint[]>(() => {
    const sourcePoints = showAll && fullPoints ? fullPoints : recentPoints
    return normalizeHistoryPoints(sourcePoints, selectedPlayerRankFallback)
  }, [fullPoints, recentPoints, selectedPlayerRankFallback.rank, selectedPlayerRankFallback.tier, showAll])

  const rawFiltered = useMemo(() => {
    return compressChangedPoints(normalizedPoints)
  }, [normalizedPoints])

  const filteredWithLp = useMemo(() => rawFiltered.filter((p) => p.lp !== null && p.lp !== undefined), [rawFiltered])
  const filteredPoints = useMemo(() => {
    if (showAll && !overlayMode) return filteredWithLp
    return takeRecentPoints(filteredWithLp)
  }, [filteredWithLp, overlayMode, showAll])

  const overlaySeries = useMemo(() => {
    if (!overlayMode) return [] as Array<{ puuid: string; points: NormalizedPoint[]; color: string }>
    return overlaySelectedPuuids
      .map((puuid, idx) => {
        const player = playersByPuuid.get(puuid)
        const source = overlayRecentByPuuid[puuid] ?? []
        const normalized = normalizeHistoryPoints(source, {
          tier: player?.rankTier ?? null,
          rank: player?.rankDivision ?? null,
        })
        const points = takeRecentPoints(compressChangedPoints(normalized))
        return {
          puuid,
          points,
          color: OVERLAY_COLORS[idx % OVERLAY_COLORS.length],
        }
      })
      .filter((s) => s.points.length > 0)
  }, [overlayMode, overlayRecentByPuuid, overlaySelectedPuuids, playersByPuuid])

  const chart = useMemo(() => {
    const ladderValues = overlayMode
      ? overlaySeries.flatMap((s) => s.points.map((p) => p.ladderValue))
      : filteredPoints.map((p) => p.ladderValue)
    if (ladderValues.length === 0) return null
    const rawMin = Math.min(...ladderValues)
    const rawMax = Math.max(...ladderValues)
    const min = rawMin - 50
    const max = rawMax + 50
    return { min, max, range: Math.max(max - min, 1) }
  }, [filteredPoints, overlayMode, overlaySeries])

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

  const overlayPlotSeries = useMemo(() => {
    if (!overlayMode || !chart) return [] as Array<{ puuid: string; color: string; points: Array<{ x: number; y: number; point: NormalizedPoint; idx: number }> }>
    return overlaySeries.map((series) => {
      const maxIndex = Math.max(series.points.length - 1, 1)
      const points = series.points.map((point, idx) => {
        const normalizedX = idx / maxIndex
        const x = PADDING.left + normalizedX * INNER_WIDTH
        const y = PADDING.top + INNER_HEIGHT - ((point.ladderValue - chart.min) / chart.range) * INNER_HEIGHT
        return { x, y, point, idx }
      })
      return { puuid: series.puuid, color: series.color, points }
    })
  }, [chart, overlayMode, overlaySeries])

  const useDenseMode = !overlayMode && plotPoints.length > DENSE_MODE_THRESHOLD

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
      if (point.ladderValue >= challFloor) return "CHALLENGER"
      if (point.ladderValue >= gmFloor) return "GRANDMASTER"
      if (point.ladderValue >= baseMaster) return "MASTER"

      const tier = getTierWord(point.tier ?? "")
      return tier || "UNRANKED"
    }
  }, [cutoffs])

  const colorForLinePoint = useMemo(() => {
    return (point: NormalizedPoint) => colorForPoint({ tier: normalizedTierForPoint(point), rank: point.rank })
  }, [normalizedTierForPoint])

  const linePath = useMemo(() => buildSharpPath(plotPoints), [plotPoints])
  const lineSegments = useMemo(
    () => (useDenseMode ? [] : buildColoredLineSegments(plotPoints, colorForLinePoint)),
    [colorForLinePoint, plotPoints, useDenseMode]
  )
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !chart || !useDenseMode || plotPoints.length < 2) return

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      const dpr = window.devicePixelRatio || 1
      const width = Math.max(1, Math.round(rect.width * dpr))
      const height = Math.max(1, Math.round(rect.height * dpr))

      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height

      const ctx = canvas.getContext("2d")
      if (!ctx) return

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const sx = rect.width / WIDTH
      const sy = rect.height / HEIGHT
      ctx.setTransform(dpr * sx, 0, 0, dpr * sy, 0, 0)

      ctx.save()
      ctx.beginPath()
      ctx.rect(PADDING.left, PADDING.top, INNER_WIDTH, INNER_HEIGHT)
      ctx.clip()

      const baseY = PADDING.top + INNER_HEIGHT
      const first = plotPoints[0]
      const last = plotPoints[plotPoints.length - 1]

      const fillGradient = ctx.createLinearGradient(0, PADDING.top, 0, baseY)
      fillGradient.addColorStop(0, "rgba(255, 255, 255, 0.14)")
      fillGradient.addColorStop(1, "rgba(255, 255, 255, 0.06)")

      ctx.beginPath()
      ctx.moveTo(first.x, first.y)
      for (let i = 1; i < plotPoints.length; i += 1) {
        ctx.lineTo(plotPoints[i].x, plotPoints[i].y)
      }
      ctx.lineTo(last.x, baseY)
      ctx.lineTo(first.x, baseY)
      ctx.closePath()
      ctx.fillStyle = fillGradient
      ctx.fill()

      ctx.lineWidth = 2.5
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      for (let i = 1; i < plotPoints.length; i += 1) {
        const prev = plotPoints[i - 1]
        const next = plotPoints[i]
        ctx.beginPath()
        ctx.strokeStyle = colorForLinePoint(prev.point)
        ctx.moveTo(prev.x, prev.y)
        ctx.lineTo(next.x, next.y)
        ctx.stroke()
      }

      ctx.restore()
    }

    const raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [chart, colorForLinePoint, plotPoints, useDenseMode])

  const handleChartHover = (e: React.MouseEvent<SVGSVGElement>) => {
    if (overlayMode) return
    if (plotPoints.length === 0) return
    const wrap = wrapRef.current
    if (!wrap) return
    const wrapRect = wrap.getBoundingClientRect()
    const svgRect = e.currentTarget.getBoundingClientRect()
    const scaleX = WIDTH / Math.max(svgRect.width, 1)
    const svgRelativeX = (e.clientX - svgRect.left) * scaleX
    const chartX = clamp(svgRelativeX, PADDING.left, PADDING.left + INNER_WIDTH)
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
    const tooltipX = e.clientX - wrapRect.left
    const y = e.clientY - wrapRect.top
    setHoveredIdx(nearest.idx)
    setTooltip({ point: nearest.point, idx: nearest.idx, x: tooltipX, y, wrapWidth: wrapRect.width, preferBelow: y < 120 })
  }

  const handleChartLeave = () => {
    setHoveredIdx(null)
    setTooltip(null)
  }

  const activePlayer = playersByPuuid.get(effectiveSelectedPuuid)
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
    const x = clamp(tooltip.x, 12, Math.max(12, tooltip.wrapWidth - 12))
    const y = tooltip.y
    const preferRight = x < 230

    const cur = filteredPoints[tooltip.idx]
    const prev = filteredPoints[tooltip.idx - 1]
    const lpChange = prev ? computeDisplayedLpDelta(cur, prev) : 0

    const style: React.CSSProperties = tooltip.preferBelow
      ? preferRight
        ? { left: x + 14, top: y + 14, transform: "translateX(0)" }
        : { left: x - 14, top: y + 14, transform: "translateX(-100%)" }
      : preferRight
        ? { left: x + 14, top: y - 12, transform: "translate(0, -100%)" }
        : { left: x - 14, top: y - 12, transform: "translate(-100%, -100%)" }

    const tooltipStyle: React.CSSProperties = {
      ...style,
      width: "max-content",
      maxWidth: "none",
    }

    return (
      <div
        className="pointer-events-none absolute z-10 rounded-2xl border border-slate-800/70 bg-slate-950/85 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur"
        style={tooltipStyle}
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

  const recordedGameCount = filteredWithLp.length
  const latestGameNumber = recordedGameCount
  const peakPoint = useMemo(() => {
    if (filteredPoints.length === 0 || !chart) return null
    const peakRaw = filteredPoints.reduce((best, cur) => (cur.ladderValue > best.ladderValue ? cur : best), filteredPoints[0])
    const peakIndex = filteredPoints.indexOf(peakRaw)
    const maxIndex = Math.max(filteredPoints.length - 1, 1)
    const normalizedX = showAll
      ? (peakRaw.totalGames - firstMatch) / matchRange
      : peakIndex / maxIndex
    const x = PADDING.left + normalizedX * INNER_WIDTH
    const y = PADDING.top + INNER_HEIGHT - ((peakRaw.ladderValue - chart.min) / chart.range) * INNER_HEIGHT
    return { x, y, point: peakRaw }
  }, [chart, filteredPoints, firstMatch, matchRange, showAll])
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

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden dark:border-slate-800/80 dark:bg-slate-900/80 dark:shadow-[0_30px_80px_-40px_rgba(0,0,0,0.75)]">
      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="p-4 lg:border-r border-slate-200 dark:border-slate-800/80">
          <div className="mb-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Leaderboard</h2>
            <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
          </div>
              <div className="leaderboard-scroll max-h-[80vh] divide-y divide-slate-200/70 overflow-y-auto pr-1 [direction:rtl] dark:divide-slate-800/70">
                <button
                  type="button"
                  onClick={handleToggleOverlayMode}
                  className="w-full px-1.5 py-2 text-left transition hover:bg-slate-100/80 dark:hover:bg-slate-800/60 [direction:ltr]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-6" />
                    <div className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                      {overlayMode ? "Exit compare mode" : "Compare players"}
                    </div>
                  </div>
                </button>
            {players.map((player, idx) => {
              const isActive = player.puuid === effectiveSelectedPuuid
              const isChecked = overlaySelectedPuuids.includes(player.puuid)
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
                  onClick={() => (overlayMode ? handleToggleOverlayPlayer(player.puuid) : handleSelectPlayer(player.puuid))}
                  onMouseEnter={() => prefetchPlayerHistory(player.puuid)}
                  onFocus={() => prefetchPlayerHistory(player.puuid)}
                  className={`w-full px-1.5 py-2 text-left transition ${
                    isActive
                      ? "bg-blue-500/10"
                      : "hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                  } [direction:ltr]`}
                >
                  <div className="flex items-center gap-3">
                    {overlayMode ? (
                      <div className="w-6 flex justify-end">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          readOnly
                          className="h-3.5 w-3.5 rounded border-slate-400 text-blue-600 focus:ring-0"
                        />
                      </div>
                    ) : (
                      <div className={`w-6 text-right text-[11px] font-semibold ${
                        isActive ? "text-blue-600 dark:text-blue-400" : "text-slate-500"
                      }`}>
                        {player.order ?? idx + 1}
                      </div>
                    )}
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
              className="relative z-10 h-auto w-full"
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
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.14} />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity={0.06} />
                </linearGradient>
              </defs>
              <g clipPath={`url(#plot-clip-${clipId})`}>
                {!overlayMode && areaPath ? (
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

                {overlayMode
                  ? overlayPlotSeries.map((series) => {
                      const d =
                        series.points.length === 1
                          ? `M ${series.points[0].x - 8} ${series.points[0].y} L ${series.points[0].x + 8} ${series.points[0].y}`
                          : buildSharpPath(series.points)
                      return d ? (
                        <path key={`overlay-line-${series.puuid}`} d={d} fill="none" stroke={series.color} strokeWidth={2.5} />
                      ) : null
                    })
                  : null}

                {!overlayMode && !useDenseMode && areaPath ? <path d={areaPath} fill={`url(#plot-fill-${clipId})`} opacity={0.9} /> : null}
                {!overlayMode && !useDenseMode && lineSegments.length > 0
                  ? lineSegments.map((seg, idx) => (
                      <path key={`line-seg-${idx}`} d={seg.d} fill="none" stroke={seg.color || lineColor} strokeWidth={2.5} />
                    ))
                  : null}

                {!overlayMode && peakPoint ? (
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
                {!overlayMode && !useDenseMode && plotPoints.map((plot, idx) => {
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

                {!overlayMode && activePoint && activeSlice ? (
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
            {!overlayMode && useDenseMode ? (
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute left-0 right-0 z-0 w-full"
                style={{ top: '4rem', height: 'calc(100% - 4rem)' }}
                aria-hidden="true"
              />
            ) : null}

                  {!overlayMode ? <button
                    type="button"
                    onClick={showAll ? handleReset : handleShowAll}
                    className="pointer-events-auto absolute bottom-3 right-3 z-20 whitespace-nowrap rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-800/70 dark:bg-slate-950/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                    style={plotButtonStyle ?? undefined}
                  >
                    {showAll ? (isLoadingFullHistory ? "Loading all..." : "Reset") : "Show all"}
                  </button> : null}
                </>
          ) : isLoadingHistory ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              Loading ranking history…
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
              No ranking history available.
            </div>
          )}

              {tooltipRender}
              <div
                className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex justify-between px-1 text-xs text-slate-500 dark:text-slate-400"
                style={plotLabelStyle ?? undefined}
              >
                <span>
                  {overlayMode
                    ? `Comparing last ${RECENT_HISTORY_LIMIT} games`
                    : showAll
                    ? `Showing ${latestGameNumber} games`
                    : filteredWithLp.length <= RECENT_HISTORY_LIMIT
                      ? `Showing ${filteredWithLp.length} games`
                      : 'Last 30 games'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
