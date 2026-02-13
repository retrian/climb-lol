'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { formatRank } from '@/lib/rankFormat'

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

const getRankIconSrc = (tier?: string | null) => {
  if (!tier) return '/images/UNRANKED_SMALL.jpg'
  return `/images/${tier.toUpperCase()}_SMALL.jpg`
}

const formatTierShort = (tier?: string | null, division?: string | null) => {
  if (!tier) return 'UR'
  const normalizedTier = tier.toUpperCase()
  const tierMap: Record<string, string> = {
    IRON: 'I',
    BRONZE: 'B',
    SILVER: 'S',
    GOLD: 'G',
    PLATINUM: 'P',
    EMERALD: 'E',
    DIAMOND: 'D',
    MASTER: 'M',
    GRANDMASTER: 'GM',
    CHALLENGER: 'C',
  }
  const tierShort = tierMap[normalizedTier] ?? normalizedTier[0] ?? 'U'
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(normalizedTier)) return tierShort
  const divisionMap: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' }
  const normalizedDivision = division?.toUpperCase() ?? ''
  const divisionShort = divisionMap[normalizedDivision] ?? normalizedDivision
  return divisionShort ? `${tierShort}${divisionShort}` : tierShort
}

export default function ChampionTable({ rows }: { rows: ChampionRow[] }) {
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState<'winrate' | 'games'>('games')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [selectedChampionId, setSelectedChampionId] = useState<number | null>(null)
  const [selectedPlayerPuuid, setSelectedPlayerPuuid] = useState<string | null>(null)
  const [hoveredPlayerPuuid, setHoveredPlayerPuuid] = useState<string | null>(null)
  const [tooltip, setTooltip] = useState<{ id: number; x: number; y: number } | null>(null)
  const chartRef = useRef<HTMLDivElement | null>(null)
  const championItemRefs = useRef<Record<number, HTMLButtonElement | null>>({})
  const championListRef = useRef<HTMLDivElement | null>(null)
  const maxGames = useMemo(() => {
    const rawMax = Math.max(1, ...rows.map((row) => row.games))
    return rawMax + 20
  }, [rows])
  const plotRows = useMemo(() => [...rows].sort((a, b) => b.games - a.games), [rows])

  const xTicks = useMemo(() => {
    const steps = 4
    return Array.from({ length: steps + 1 }).map((_, idx) => {
      const value = Math.round((maxGames / steps) * idx)
      return { value, ratio: idx / steps }
    })
  }, [maxGames])

  const yTicks = useMemo(() => [1, 0.75, 0.5, 0.25, 0], [])

  const listRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1
      const result = sortKey === 'winrate' ? a.winrateValue - b.winrateValue : a.games - b.games
      if (result === 0) return a.name.localeCompare(b.name)
      return direction * result
    })
    return copy
  }, [rows, sortDirection, sortKey])

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

  const selectedChampion = useMemo(
    () => rows.find((row) => row.id === selectedChampionId) ?? null,
    [rows, selectedChampionId]
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

  useEffect(() => {
    setSelectedPlayerPuuid(null)
  }, [selectedChampionId])
  useEffect(() => {
    setHoveredPlayerPuuid(null)
  }, [selectedChampionId])
  useEffect(() => {
    if (!selectedChampionId) return
    const node = championItemRefs.current[selectedChampionId]
    const container = championListRef.current
    if (!node || !container) return
    const nodeTop = node.offsetTop
    const nodeHeight = node.offsetHeight
    const containerHeight = container.clientHeight
    const target = nodeTop - containerHeight / 2 + nodeHeight / 2
    container.scrollTo({ top: target, behavior: 'smooth' })
  }, [selectedChampionId])

  const jitterForId = (id: number) => {
    const seed = (id * 9301 + 49297) % 233280
    const seed2 = (id * 233280 + 49297) % 9301
    const rand = seed / 233280
    const rand2 = seed2 / 9301
    return { x: (rand - 0.5) * 26, y: (rand2 - 0.5) * 26 }
  }

  if (plotRows.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-slate-400">No champion data available.</div>
    )
  }

  const chartHeight = 460
  const chartWidth = 1000
  const padding = { left: 60, right: 0, top: 20, bottom: 52 }
  const plotWidth = chartWidth - padding.left - padding.right
  const plotHeight = chartHeight - padding.top - padding.bottom
  const selectedChampionJitter = selectedChampion ? jitterForId(selectedChampion.id) : null
  const selectedChampionX = selectedChampion
    ? (selectedChampion.games / maxGames) * plotWidth + (selectedChampionJitter?.x ?? 0)
    : null
  const selectedChampionY = selectedChampion
    ? (1 - selectedChampion.winrateValue) * plotHeight + (selectedChampionJitter?.y ?? 0)
    : null
  const selectedPlayerX = selectedPlayer ? (selectedPlayer.games / maxGames) * plotWidth : null
  const selectedPlayerY = selectedPlayer ? (1 - selectedPlayerWinrateValue) * plotHeight : null
  const selectedHighlightY = selectedPlayer ? selectedPlayerY : selectedChampionY
  const selectedWinrateLabel = selectedPlayer
    ? selectedPlayer.winrate
    : selectedChampion
      ? selectedChampion.winrate
      : null
  const selectedGamesLabel = selectedPlayer
    ? selectedPlayer.games
    : selectedChampion
      ? selectedChampion.games
      : null

  return (
    <div className="relative">
      <div className="absolute inset-y-0 right-0 left-[calc(300px+24px)] bg-slate-100/80 dark:bg-slate-950/70 pointer-events-none z-0" />
      <div className="absolute left-[calc(300px+24px)] top-0 bottom-0 w-px bg-slate-200/70 dark:bg-slate-800/70 z-0" />
      <div className="p-6 relative z-10">
        <div className="grid gap-0 lg:grid-cols-[300px_320px_minmax(0,1fr)] items-stretch">
        <aside className="px-4 py-3 h-full">
          <div className="sticky top-0 z-10 bg-transparent py-2">
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_72px_64px] gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <div>Champions: {rows.length}</div>
              <button type="button" onClick={() => toggleSort('winrate')} className="text-right hover:text-slate-900 dark:hover:text-slate-100" aria-label="Sort by winrate">
                Winrate {sortKey === 'winrate' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
              </button>
              <button type="button" onClick={() => toggleSort('games')} className="text-right hover:text-slate-900 dark:hover:text-slate-100" aria-label="Sort by games">
                Games {sortKey === 'games' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
              </button>
            </div>
          </div>
            <div ref={championListRef} className="leaderboard-scroll max-h-[520px] overflow-y-auto pb-3 [direction:rtl]">
              {listRows.map((row, idx) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedChampionId((prev) => (prev === row.id ? null : row.id))}
                  onMouseEnter={() => setHoveredId(row.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  ref={(el) => {
                    championItemRefs.current[row.id] = el
                  }}
                  className={`w-full text-left [direction:ltr] grid grid-cols-[40px_1fr_56px_56px] items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                    selectedChampionId === row.id
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800/70 dark:text-slate-100'
                      : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="text-[10px] font-bold text-slate-400 text-center">{idx + 1}</div>
                  {row.iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={row.iconUrl} alt="" className="h-6 w-6 rounded-lg border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800" />
                  ) : (
                    <div className="h-6 w-6 rounded-lg border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                  )}
                  <div className="text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">{row.winrate}</div>
                  <div className="text-right tabular-nums text-slate-500 dark:text-slate-400">{row.games}</div>
                </button>
              ))}
            </div>
        </aside>

        <aside className="px-4 py-3">
          <div className="sticky top-0 z-10 bg-transparent py-2">
            <div className="flex items-center justify-end" />
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              <div>Player</div>
              <div className="text-right">Win%</div>
              <div className="text-right">Games</div>
            </div>
          </div>
            <div className="leaderboard-scroll max-h-[520px] overflow-y-auto pb-4 [direction:rtl]">
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
                        <img src={player.iconUrl} alt="" className="h-6 w-6 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800" />
                      ) : (
                        <div className="h-6 w-6 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{player.name}</div>
                      </div>
                    </div>
                    <div className="text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
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

        <section className="pl-4 pr-0 py-3 -mr-6" ref={chartRef}>
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
          <div className="relative mt-6">
            <button
              type="button"
              onClick={() => {
                setSelectedChampionId(null)
                setSelectedPlayerPuuid(null)
                setHoveredId(null)
              }}
              className="absolute bottom-3 right-3 z-10 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:text-slate-100"
            >
              Reset
            </button>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width="100%" height={chartHeight} role="img" aria-label="Champion winrate by games played scatter plot">
              <defs>
                {plotRows.map((row) => (
                  <clipPath key={`clip-${row.id}`} id={`clip-${row.id}`}>
                    <circle cx={0} cy={0} r={14} />
                  </clipPath>
                ))}
                {selectedChampion?.players.map((player) => (
                  <clipPath key={`clip-player-${player.puuid}`} id={`clip-player-${player.puuid}`}>
                    <circle cx={0} cy={0} r={14} />
                  </clipPath>
                ))}
                {selectedPlayer?.iconUrl ? (
                  <clipPath id="clip-player">
                    <circle cx={0} cy={0} r={16} />
                  </clipPath>
                ) : null}
              </defs>
              <g transform={`translate(${padding.left}, ${padding.top})`}>
                <rect x={0} y={0} width={plotWidth} height={plotHeight / 2} className="fill-emerald-500/5" />
                <rect x={0} y={plotHeight / 2} width={plotWidth} height={plotHeight / 2} className="fill-rose-500/5" />
                <line x1={0} y1={plotHeight / 2} x2={plotWidth} y2={plotHeight / 2} stroke="currentColor" className="text-slate-500/30" strokeDasharray="2 6" strokeLinecap="round" />
                {selectedPlayer ? (
                  <line
                    x1={selectedPlayerX ?? 0}
                    x2={selectedPlayerX ?? 0}
                    y1={0}
                    y2={plotHeight}
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
                    y2={plotHeight}
                    stroke="currentColor"
                    className="text-blue-400/70"
                    strokeDasharray="6 6"
                    strokeWidth={2}
                  />
                ) : null}
                {selectedHighlightY !== null ? (
                  <line
                    x1={0}
                    x2={plotWidth}
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
                    <line x1={0} y1={(1 - tick) * plotHeight} x2={plotWidth} y2={(1 - tick) * plotHeight} stroke="currentColor" className="text-slate-200 dark:text-slate-800" strokeDasharray="4 4" />
                    {!selectedChampion && !selectedPlayer ? (
                      <text x={-10} y={(1 - tick) * plotHeight + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-semibold dark:fill-slate-500">
                        {Math.round(tick * 100)}%
                      </text>
                    ) : null}
                  </g>
                ))}
                {xTicks.map((tick) => (
                  <g key={`x-${tick.value}`}>
                    <line x1={tick.ratio * plotWidth} y1={plotHeight} x2={tick.ratio * plotWidth} y2={plotHeight + 6} stroke="currentColor" className="text-slate-300 dark:text-slate-700" />
                    {!selectedChampion && !selectedPlayer && tick.ratio > 0 && tick.ratio < 1 ? (
                      <text x={tick.ratio * plotWidth} y={plotHeight + 22} textAnchor="middle" className="fill-slate-400 text-[10px] font-semibold dark:fill-slate-500">
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
                    className="fill-emerald-400 text-[11px] font-semibold"
                  >
                    {selectedWinrateLabel}
                  </text>
                ) : null}
                {selectedGamesLabel !== null && (selectedPlayer ? selectedPlayerX !== null : selectedChampionX !== null) ? (
                  <text
                    x={selectedPlayer ? (selectedPlayerX ?? 0) : (selectedChampionX ?? 0)}
                    y={plotHeight + 22}
                    textAnchor="middle"
                    className="fill-blue-300 text-[11px] font-semibold"
                  >
                    {selectedGamesLabel}
                  </text>
                ) : null}
                {displayRows.map((row) => {
                  const jitter = jitterForId(row.id)
                  const x = (row.games / maxGames) * plotWidth + jitter.x
                  const y = (1 - row.winrateValue) * plotHeight + jitter.y
                  const isHovered = hoveredId === row.id
                  const isSelected = selectedChampionId === row.id
                  const isDimmed = selectedChampionId !== null && !isSelected
                  const isChampionLocked = selectedChampionId !== null && !isSelected
                  return (
                    <g
                      key={row.id}
                      transform={`translate(${x}, ${y}) scale(${isHovered || isSelected ? 1.12 : 1})`}
                      onMouseEnter={() => setHoveredId(row.id)}
                      onMouseLeave={() => setHoveredId(null)}
                      onClick={() => {
                        if (isChampionLocked) return
                        setSelectedChampionId((prev) => (prev === row.id ? null : row.id))
                      }}
                      onFocus={() => setHoveredId(row.id)}
                      onBlur={() => setHoveredId(null)}
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
                          clipPath={`url(#clip-${row.id})`}
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
                      const px = (player.games / maxGames) * plotWidth + jitter.x * 0.5
                      const py = (1 - winrateValue) * plotHeight + jitter.y * 0.5
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
                              clipPath={`url(#clip-player-${player.puuid})`}
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
                    transform={`translate(${(selectedPlayer.games / maxGames) * plotWidth}, ${(1 - selectedPlayerWinrateValue) * plotHeight})`}
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
                        clipPath="url(#clip-player)"
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
            {tooltip ? (
              <div className="pointer-events-none absolute z-10 rounded-xl border border-slate-800/70 bg-slate-950/85 px-3 py-2 text-xs text-slate-200 shadow-lg backdrop-blur" style={{ left: tooltip.x, top: tooltip.y }}>
                {(() => {
                  const champ = rows.find((row) => row.id === tooltip.id)
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
