'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { formatRank } from '@/lib/rankFormat'
import { getWinrateColor } from '@/lib/formatters'

const CHART_HEIGHT = 460
const CHART_WIDTH = 1000
const PADDING = { left: 60, right: 0, top: 20, bottom: 52 }
const PLOT_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const PLOT_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

type ChampionRow = {
  id: number
  name: string
  iconUrl: string | null
  wins: number
  losses: number
  winrate: string
  winrateValue: number
  games: number
  kdaLabel: string
  kdaValue: number
  avgCs: number
  players: Array<{
    puuid: string
    name: string
    tagLine: string | null
    iconUrl: string | null
    games: number
    wins: number
    losses: number
    winrate: string
    kda: { value: number; label: string }
    avgCs: number
    overallGames: number
    overallWins: number
    overallLosses: number
    overallWinrate: string
    rankTier: string | null
    rankDivision: string | null
    rankLp: number | null
  }>
}

export default function ChampionTable({ rows }: { rows: ChampionRow[] }) {
  const clipId = useId()
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<'winrate' | 'games'>('games')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedChampionId, setSelectedChampionId] = useState<number | null>(null)
  const [selectedPlayerPuuid, setSelectedPlayerPuuid] = useState<string | null>(null)
  const [hoveredPlayerPuuid, setHoveredPlayerPuuid] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ id: number; x: number; y: number } | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const championItemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const championListRef = useRef<HTMLDivElement | null>(null)
  const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const filteredRows = useMemo(() => {
    if (!normalizedSearchQuery) return rows
    return rows.filter((row) => row.name.toLowerCase().includes(normalizedSearchQuery))
  }, [rows, normalizedSearchQuery])
  const maxGames = useMemo(() => {
    const rawMax = Math.max(1, ...filteredRows.map((row) => row.games))
    return rawMax + 20
  }, [filteredRows])
  const plotRows = useMemo(() => [...filteredRows].sort((a, b) => b.games - a.games), [filteredRows])

  const xTicks = useMemo(() => {
    const steps = 4
    return Array.from({ length: steps + 1 }).map((_, idx) => {
      const value = Math.round((maxGames / steps) * idx)
      return { value, ratio: idx / steps }
    })
  }, [maxGames])

  const yTicks = useMemo(() => [1, 0.75, 0.5, 0.25, 0], [])

  const listRows = useMemo(() => {
    const copy = [...filteredRows]
    copy.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1
      const result = sortKey === 'winrate' ? a.winrateValue - b.winrateValue : a.games - b.games
      if (result === 0) return a.name.localeCompare(b.name)
      return direction * result
    })
    return copy
  }, [filteredRows, sortDirection, sortKey])

  const toggleSort = (key: 'winrate' | 'games') => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('desc')
  }

  const displayRows = useMemo(() => {
    if (!hoveredId) return plotRows
    const hovered = plotRows.find((row) => row.id === hoveredId)
    if (!hovered) return plotRows
    return [...plotRows.filter((row) => row.id !== hoveredId), hovered]
  }, [hoveredId, plotRows])

  const activeSelectedChampionId = useMemo(
    () => (selectedChampionId && filteredRows.some((row) => row.id === selectedChampionId) ? selectedChampionId : null),
    [filteredRows, selectedChampionId]
  )

  const selectedChampion = useMemo(
    () => filteredRows.find((row) => row.id === activeSelectedChampionId) ?? null,
    [activeSelectedChampionId, filteredRows]
  )

  const playerRows = useMemo(() => {
    if (!selectedChampion) return []
    const copy = [...selectedChampion.players]
    copy.sort((a, b) => b.games - a.games)
    return copy
  }, [selectedChampion])

  const selectedPlayer = useMemo(() => {
    if (!selectedPlayerPuuid || !selectedChampion) return null
    return selectedChampion.players.find((player) => player.puuid === selectedPlayerPuuid) ?? null
  }, [selectedChampion, selectedPlayerPuuid])

  const selectedPlayerWinrateValue = useMemo(() => {
    if (!selectedPlayer) return 0
    return selectedPlayer.games ? selectedPlayer.wins / selectedPlayer.games : 0
  }, [selectedPlayer])

  const rowsById = useMemo(() => new Map(filteredRows.map((row) => [row.id, row])), [filteredRows])

  const showTooltip = useCallback((id: number, event: ReactMouseEvent<SVGGElement>) => {
    const container = chartRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    setTooltip({
      id,
      x: event.clientX - rect.left + 12,
      y: event.clientY - rect.top + 12,
    })
  }, [])

  const hideTooltip = useCallback(() => setTooltip(null), [])

  const handleChampionToggle = useCallback((id: number) => {
    setSelectedChampionId((prev) => (prev === id ? null : id))
    setSelectedPlayerPuuid(null)
    setHoveredPlayerPuuid(null)
    setTooltip(null)
  }, [])

  useEffect(() => {
    if (!activeSelectedChampionId) return
    const node = championItemRefs.current[activeSelectedChampionId]
    const container = championListRef.current
    if (!node || !container) return
    const nodeTop = node.offsetTop
    const nodeHeight = node.offsetHeight
    const containerHeight = container.clientHeight
    const target = nodeTop - containerHeight / 2 + nodeHeight / 2
    container.scrollTo({ top: target, behavior: 'smooth' })
  }, [activeSelectedChampionId])

  const jitterForId = (id: number) => {
    const seed = (id * 9301 + 49297) % 233280
    const seed2 = (id * 233280 + 49297) % 9301
    const rand = seed / 233280
    const rand2 = seed2 / 9301
    return { x: (rand - 0.5) * 26, y: (rand2 - 0.5) * 26 }
  }

  if (rows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">No champion data available.</div>
    )
  }

  const selectedChampionJitter = selectedChampion ? jitterForId(selectedChampion.id) : null
  const selectedChampionX = selectedChampion
    ? (selectedChampion.games / maxGames) * PLOT_WIDTH + (selectedChampionJitter?.x ?? 0)
    : null
  const selectedChampionY = selectedChampion
    ? (1 - selectedChampion.winrateValue) * PLOT_HEIGHT + (selectedChampionJitter?.y ?? 0)
    : null
  const selectedPlayerX = selectedPlayer ? (selectedPlayer.games / maxGames) * PLOT_WIDTH : null
  const selectedPlayerY = selectedPlayer ? (1 - selectedPlayerWinrateValue) * PLOT_HEIGHT : null
  const selectedHighlightY = selectedPlayer ? selectedPlayerY : selectedChampionY
  const selectedWinrateLabel = selectedPlayer
    ? selectedPlayer.winrate
    : selectedChampion
      ? selectedChampion.winrate
      : null
  const selectedWinratePercent = selectedPlayer
    ? selectedPlayerWinrateValue * 100
    : selectedChampion
      ? selectedChampion.winrateValue * 100
      : null
  const selectedWinrateSvgColorClass = selectedWinratePercent === null
    ? 'fill-slate-500 dark:fill-slate-400'
    : selectedWinratePercent > 60
      ? 'fill-rose-500 dark:fill-rose-400'
      : selectedWinratePercent > 50
        ? 'fill-emerald-500 dark:fill-emerald-400'
        : 'fill-slate-500 dark:fill-slate-400'
  const selectedGamesLabel = selectedPlayer
    ? selectedPlayer.games
    : selectedChampion
      ? selectedChampion.games
      : null

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 left-[calc(300px+24px)] bg-slate-100/80 dark:bg-slate-950/70 pointer-events-none z-0" />
      <div className="absolute left-[calc(300px+24px)] top-0 bottom-0 w-px bg-slate-200/70 dark:bg-slate-800/70 z-0" />
      <div className="p-4 relative z-10">
        <div className="grid gap-0 lg:grid-cols-[300px_320px_minmax(0,1fr)] items-stretch">
        <aside className="px-4 py-2 h-full">
          <div className="sticky top-0 z-10 bg-transparent py-1">
            <div>
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search champion..."
                aria-label="Search champion"
                className="w-full rounded-lg border border-slate-200 bg-white/80 px-3 py-1.5 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-400/30 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:placeholder:text-slate-500"
              />
            </div>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_72px_64px] gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <div>
                Champions: {listRows.length}
                {normalizedSearchQuery ? ` / ${rows.length}` : ''}
              </div>
              <button type="button" onClick={() => toggleSort('winrate')} className="text-right hover:text-slate-900 dark:hover:text-slate-100" aria-label="Sort by winrate">
                Winrate {sortKey === 'winrate' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
              </button>
              <button type="button" onClick={() => toggleSort('games')} className="text-right hover:text-slate-900 dark:hover:text-slate-100" aria-label="Sort by games">
                Games {sortKey === 'games' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
              </button>
            </div>
          </div>
            <div ref={championListRef} className="leaderboard-scroll max-h-[440px] overflow-y-auto pb-3 [direction:rtl]">
              {listRows.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400 [direction:ltr]">No champions match your search.</div>
              ) : listRows.map((row, idx) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => handleChampionToggle(row.id)}
                  onMouseEnter={() => setHoveredId(row.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  ref={(el) => {
                    championItemRefs.current[row.id] = el
                  }}
                  className={`w-full text-left [direction:ltr] grid grid-cols-[40px_1fr_56px_56px] items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                    activeSelectedChampionId === row.id
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-400 text-center">{idx + 1}</div>
                  {row.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.iconUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-lg border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800" />
                  ) : (
                    <div className="h-6 w-6 rounded-lg border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                  )}
                  <div className={`text-right tabular-nums font-semibold ${getWinrateColor(row.winrateValue * 100)}`}>{row.winrate}</div>
                  <div className="text-right tabular-nums text-slate-500 dark:text-slate-400">{row.games}</div>
                </button>
              ))}
            </div>
        </aside>

        <aside className="px-4 py-2">
          <div className="sticky top-0 z-10 bg-transparent py-1">
            <div className="flex items-center justify-end" />
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <div>Player</div>
              <div className="text-right">Win%</div>
              <div className="text-right">Games</div>
            </div>
          </div>
            <div className="leaderboard-scroll max-h-[440px] overflow-y-auto pb-4 [direction:rtl]">
              {!selectedChampion ? (
                <div className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400 [direction:ltr]">Choose a champion to view player stats.</div>
              ) : playerRows.length === 0 ? (
                <div className="px-2 py-6 text-center text-sm text-slate-500 dark:text-slate-400 [direction:ltr]">No player data available.</div>
              ) : (
                playerRows.map((player) => (
                  <button
                    key={player.puuid}
                    type="button"
                    onClick={() => setSelectedPlayerPuuid(player.puuid)}
                    className={`[direction:ltr] grid w-full grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                      selectedPlayerPuuid === player.puuid
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {player.iconUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={player.iconUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800" />
                      ) : (
                        <div className="h-6 w-6 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{player.name}</div>
                      </div>
                    </div>
                    <div className={`text-right tabular-nums font-semibold ${getWinrateColor(player.games ? (player.wins / player.games) * 100 : 0)}`}>
                      {player.winrate}
                    </div>
                    <div className="text-right tabular-nums text-slate-500 dark:text-slate-400">
                      {player.games}
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

        <section className="-mr-4 pl-4 pr-0 py-2" ref={chartRef}>
          <div className="flex items-center justify-end gap-3" />
          <div className="mt-4 text-xs">
            {selectedPlayer ? (
              <div className="flex items-center gap-4">
                <div className="relative h-16 w-16">
                  {selectedPlayer.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedPlayer.iconUrl}
                      alt=""
                      className="h-16 w-16 rounded-full border border-slate-200 shadow-[0_14px_36px_-18px_rgba(0,0,0,0.25)] dark:border-slate-800 dark:shadow-[0_14px_36px_-18px_rgba(0,0,0,0.9)]"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded-full bg-slate-200 dark:bg-slate-800" />
                  )}
                  {selectedChampion?.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={selectedChampion.iconUrl}
                      alt=""
                      className="absolute -bottom-1 -right-1 h-6 w-6 rounded-full border-2 border-slate-900 bg-slate-900 object-cover"
                    />
                  ) : null}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {selectedPlayer.name}
                    {selectedPlayer.tagLine ? (
                      <span className="text-slate-400 dark:text-slate-500 font-medium"> #{selectedPlayer.tagLine}</span>
                    ) : null}
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    <span className="font-semibold">
                      {formatRank(selectedPlayer.rankTier, selectedPlayer.rankDivision, selectedPlayer.rankLp)}
                    </span>
                  </div>
                  <div className="text-slate-500 dark:text-slate-400">
                    {`${selectedPlayer.winrate.replace('%', '')}% winrate | ${selectedPlayer.games} games`}
                  </div>
                </div>
              </div>
            ) : (
              selectedChampion ? (
                <div className="text-slate-500 dark:text-slate-400">Select a player to see their details.</div>
              ) : null
            )}
          </div>
          <div className="relative mt-3">
            {plotRows.length > 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedChampionId(null)
                    setSelectedPlayerPuuid(null)
                    setHoveredPlayerPuuid(null)
                    setHoveredId(null)
                    setTooltip(null)
                  }}
                  className="absolute bottom-3 right-3 z-10 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:text-slate-100"
                >
                  Reset
                </button>
                 <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} width="100%" height={CHART_HEIGHT} role="img" aria-label="Champion winrate by games played scatter plot">
              <defs>
                <clipPath id={`clip-icon-14-${clipId}`}>
                  <circle cx={0} cy={0} r={14} />
                </clipPath>
                <clipPath id={`clip-icon-16-${clipId}`}>
                  <circle cx={0} cy={0} r={16} />
                </clipPath>
              </defs>
              <g transform={`translate(${PADDING.left}, ${PADDING.top})`}>
                <rect x={0} y={0} width={PLOT_WIDTH} height={PLOT_HEIGHT / 2} className="fill-emerald-500/5" />
                <rect x={0} y={PLOT_HEIGHT / 2} width={PLOT_WIDTH} height={PLOT_HEIGHT / 2} className="fill-rose-500/5" />
                <line x1={0} y1={PLOT_HEIGHT / 2} x2={PLOT_WIDTH} y2={PLOT_HEIGHT / 2} stroke="currentColor" className="text-slate-500/30" strokeDasharray="2 6" strokeLinecap="round" />
                {selectedPlayer ? (
                  <line
                    x1={selectedPlayerX ?? 0}
                    x2={selectedPlayerX ?? 0}
                    y1={0}
                    y2={PLOT_HEIGHT}
                    stroke="currentColor"
                    className="text-blue-400/70"
                    strokeDasharray="6 6"
                    strokeWidth={2}
                  />
                ) : selectedChampion ? (
                  <line
                    x1={selectedChampionX ?? 0}
                    x2={selectedChampionX ?? 0}
                    y1={0}
                    y2={PLOT_HEIGHT}
                    stroke="currentColor"
                    className="text-blue-400/70"
                    strokeDasharray="6 6"
                    strokeWidth={2}
                  />
                ) : null}
                {selectedHighlightY !== null ? (
                  <line
                    x1={0}
                    x2={PLOT_WIDTH}
                    y1={selectedHighlightY}
                    y2={selectedHighlightY}
                    stroke="currentColor"
                    className="text-emerald-400/80"
                    strokeDasharray="4 6"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                ) : null}
                {yTicks.map((tick) => (
                  <g key={`y-${tick}`}>
                    <line x1={0} y1={(1 - tick) * PLOT_HEIGHT} x2={PLOT_WIDTH} y2={(1 - tick) * PLOT_HEIGHT} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="4 4" />
                    {!selectedChampion && !selectedPlayer ? (
                      <text x={-10} y={(1 - tick) * PLOT_HEIGHT + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-semibold dark:fill-slate-500">
                        {Math.round(tick * 100)}%
                      </text>
                    ) : null}
                  </g>
                ))}
                {xTicks.map((tick) => (
                  <g key={`x-${tick.value}`}>
                    <line x1={tick.ratio * PLOT_WIDTH} y1={PLOT_HEIGHT} x2={tick.ratio * PLOT_WIDTH} y2={PLOT_HEIGHT + 6} stroke="currentColor" className="text-slate-300 dark:text-slate-700" />
                    {!selectedChampion && !selectedPlayer && tick.ratio > 0 && tick.ratio < 1 ? (
                      <text x={tick.ratio * PLOT_WIDTH} y={PLOT_HEIGHT + 22} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold dark:fill-slate-500">
                        {Math.round(maxGames * tick.ratio)}
                      </text>
                    ) : null}
                  </g>
                ))}
                {selectedHighlightY !== null && selectedWinrateLabel ? (
                  <text
                    x={-10}
                    y={selectedHighlightY + 4}
                    textAnchor="end"
                    className={`${selectedWinrateSvgColorClass} text-[11px] font-semibold`}
                  >
                    {selectedWinrateLabel}
                  </text>
                ) : null}
                {selectedGamesLabel !== null && (selectedPlayer ? selectedPlayerX !== null : selectedChampionX !== null) ? (
                  <text
                    x={selectedPlayer ? (selectedPlayerX ?? 0) : (selectedChampionX ?? 0)}
                    y={PLOT_HEIGHT + 22}
                    textAnchor="middle"
                    className="fill-blue-300 text-[11px] font-semibold"
                  >
                    {selectedGamesLabel}
                  </text>
                ) : null}
                {displayRows.map((row) => {
                  const jitter = jitterForId(row.id)
                  const x = (row.games / maxGames) * PLOT_WIDTH + jitter.x
                  const y = (1 - row.winrateValue) * PLOT_HEIGHT + jitter.y
                  const isHovered = hoveredId === row.id
                  const isSelected = activeSelectedChampionId === row.id
                  const isDimmed = activeSelectedChampionId !== null && !isSelected
                  const isChampionLocked = activeSelectedChampionId !== null && !isSelected
                  return (
                    <g
                      key={row.id}
                      transform={`translate(${x}, ${y}) scale(${isHovered || isSelected ? 1.12 : 1})`}
                      onMouseEnter={() => setHoveredId(row.id)}
                      onMouseLeave={() => {
                        setHoveredId(null)
                        hideTooltip()
                      }}
                      onMouseMove={(event) => showTooltip(row.id, event)}
                      onClick={() => {
                        if (isChampionLocked) return
                        handleChampionToggle(row.id)
                      }}
                      onFocus={() => setHoveredId(row.id)}
                      onBlur={() => {
                        setHoveredId(null)
                        hideTooltip()
                      }}
                      onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            if (isChampionLocked) return
                            handleChampionToggle(row.id)
                          }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`transition-opacity ${
                        isDimmed ? 'opacity-10' : 'opacity-100'
                      } ${isChampionLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <title>{`${row.name} • ${row.winrate} • ${row.games} games`}</title>
                      {row.iconUrl ? (
                        <image
                          href={row.iconUrl}
                          x={-14}
                          y={-14}
                          width={28}
                          height={28}
                          clipPath={`url(#clip-icon-14-${clipId})`}
                          preserveAspectRatio="xMidYMid slice"
                          className={isHovered || isSelected ? 'drop-shadow-[0_0_12px_rgba(59,130,246,0.7)]' : ''}
                        />
                      ) : (
                        <circle r={12} className="fill-slate-200 dark:fill-slate-700" />
                      )}
                      <circle r={14} className={isSelected ? 'fill-none stroke-blue-400' : 'fill-none stroke-white/80 dark:stroke-slate-900/70'} strokeWidth={2} />
                      <circle r={14} className={isSelected ? 'fill-none stroke-blue-500/60' : 'fill-none stroke-slate-200 dark:stroke-slate-700'} strokeWidth={1} />
                      <circle r={14} className={isHovered || isSelected ? 'fill-blue-500/10' : 'fill-transparent'} />
                    </g>
                  )
                })}
                {selectedChampion ? (
                  <g className="pointer-events-auto">
                    {selectedChampion.players.map((player, idx) => {
                      if (selectedPlayerPuuid === player.puuid) return null
                      const jitter = jitterForId(idx + 1)
                      const winrateValue = player.games ? player.wins / player.games : 0
                      const px = (player.games / maxGames) * PLOT_WIDTH + jitter.x * 0.5
                      const py = (1 - winrateValue) * PLOT_HEIGHT + jitter.y * 0.5
                      const isPlayerHovered = hoveredPlayerPuuid === player.puuid
                      const isPlayerSelected = selectedPlayerPuuid === player.puuid
                      const scale = isPlayerHovered || isPlayerSelected ? 1.15 : 1
                      return (
                        <g
                          key={player.puuid}
                          transform={`translate(${px}, ${py}) scale(${scale})`}
                          onMouseEnter={() => setHoveredPlayerPuuid(player.puuid)}
                          onMouseLeave={() => setHoveredPlayerPuuid(null)}
                          onClick={() => setSelectedPlayerPuuid(player.puuid)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSelectedPlayerPuuid(player.puuid)
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          className="cursor-pointer"
                        >
                          {player.iconUrl ? (
                            <image
                              href={player.iconUrl}
                              x={-14}
                              y={-14}
                              width={28}
                              height={28}
                              clipPath={`url(#clip-icon-14-${clipId})`}
                              preserveAspectRatio="xMidYMid slice"
                              className={isPlayerHovered || isPlayerSelected ? 'drop-shadow-[0_0_12px_rgba(59,130,246,0.7)]' : 'drop-shadow-[0_0_8px_rgba(59,130,246,0.6)]'}
                            />
                          ) : (
                            <circle r={12} className="fill-slate-200 dark:fill-slate-700" />
                          )}
                          <circle
                            r={14}
                            className={isPlayerSelected ? 'fill-none stroke-blue-400' : 'fill-none stroke-blue-200/70 dark:stroke-blue-400/40'}
                            strokeWidth={isPlayerHovered || isPlayerSelected ? 2 : 1}
                          />
                        </g>
                      )
                    })}
                  </g>
                ) : null}
                {selectedPlayer ? (
                  <g
                    transform={`translate(${(selectedPlayer.games / maxGames) * PLOT_WIDTH}, ${(1 - selectedPlayerWinrateValue) * PLOT_HEIGHT})`}
                    className="pointer-events-none"
                  >
                    <title>{`${selectedPlayer.name} • ${selectedPlayer.winrate} • ${selectedPlayer.games} games`}</title>
                    {selectedPlayer.iconUrl ? (
                      <image
                        href={selectedPlayer.iconUrl}
                        x={-16}
                        y={-16}
                        width={32}
                        height={32}
                        clipPath={`url(#clip-icon-16-${clipId})`}
                        preserveAspectRatio="xMidYMid slice"
                        className="drop-shadow-[0_0_14px_rgba(16,185,129,0.7)]"
                      />
                    ) : (
                      <circle r={14} className="fill-emerald-400/70" />
                    )}
                    <circle r={17} className="fill-none stroke-emerald-400/80" strokeWidth={2} />
                    <circle r={17} className="fill-emerald-500/10" />
                  </g>
                ) : null}
              </g>
                </svg>
              </>
            ) : (
              <div className="flex h-[460px] items-center justify-center rounded-xl border border-dashed border-slate-300/70 text-sm text-slate-500 dark:border-slate-700/70 dark:text-slate-400">
                No champions match your search.
              </div>
            )}
            {tooltip ? (
              <div className="pointer-events-none absolute z-10 rounded-xl border border-slate-800/70 bg-slate-950/85 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur" style={{ left: tooltip.x, top: tooltip.y }}>
                {(() => {
                  const champ = rowsById.get(tooltip.id)
                  if (!champ) return null
                  return (
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-white">{champ.name}</div>
                      <div className="text-[10px] text-slate-300">{champ.winrate} • {champ.games} games</div>
                    </div>
                  )
                })()}
              </div>
            ) : null}
          </div>
        </section>
        </div>
      </div>
    </div>
  )
}
