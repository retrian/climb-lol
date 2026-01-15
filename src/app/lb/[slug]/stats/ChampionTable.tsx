'use client'

import { Fragment, useMemo, useState } from 'react'

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
    iconUrl: string | null
    games: number
    wins: number
    losses: number
    winrate: string
    kda: { value: number; label: string }
    avgCs: number
  }>
}

type SortKey = 'winrate' | 'games' | 'kda' | 'avgCs'
type SortDirection = 'asc' | 'desc'

const SORT_KEYS: Array<{ key: SortKey; label: string }> = [
  { key: 'winrate', label: 'Winrate' },
  { key: 'games', label: 'Games' },
  { key: 'kda', label: 'Avg KDA' },
  { key: 'avgCs', label: 'Avg CS' },
]

export default function ChampionTable({ rows }: { rows: ChampionRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('winrate')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1
      let result = 0

      if (sortKey === 'winrate') result = a.winrateValue - b.winrateValue
      else if (sortKey === 'games') result = a.games - b.games
      else if (sortKey === 'kda') result = a.kdaValue - b.kdaValue
      else if (sortKey === 'avgCs') result = a.avgCs - b.avgCs

      // 1. Stable Sorting: Name tie-breaker
      if (result === 0) {
        return a.name.localeCompare(b.name)
      }

      return direction * result
    })
    return copy
  }, [rows, sortDirection, sortKey])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('desc')
  }

  const toggleRow = (id: number) => {
    setExpandedRow((prev) => (prev === id ? null : id))
  }

  return (
    <div className="p-6">
      <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
        <table className="min-w-full text-xs" aria-label="Champion Statistics">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2" scope="col">Champion</th>
              {SORT_KEYS.map((col) => (
                <th key={col.key} className="px-3 py-2" scope="col" aria-sort={sortKey === col.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-semibold hover:text-slate-900 dark:hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    // 2. Accessibility: Explicit label for screen readers
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    <span className="text-[9px] text-slate-400" aria-hidden="true">
                      {sortKey === col.key ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-600 dark:divide-slate-800 dark:text-slate-300">
            {/* 3. Empty State Handling */}
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400 italic">
                  No champion data available.
                </td>
              </tr>
            ) : (
              sortedRows.map((champ) => {
                const isExpanded = expandedRow === champ.id
                return (
                  <Fragment key={champ.id}>
                    {/* Unique stable key for main row */}
                    <tr key={`main-${champ.id}`} className={isExpanded ? 'bg-slate-50/50 dark:bg-slate-800/30' : ''}>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            {champ.iconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={champ.iconUrl}
                                alt=""
                                className="h-8 w-8 rounded-lg border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-lg border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                            )}
                            <div>
                              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                {champ.name}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                {champ.wins}W - {champ.losses}L
                              </div>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleRow(champ.id)}
                            // 2. Accessibility: Expand state
                            aria-expanded={isExpanded}
                            aria-controls={`expanded-${champ.id}`}
                            aria-label={`${isExpanded ? 'Hide' : 'View'} players for ${champ.name}`}
                            className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 focus:outline-none focus:underline"
                          >
                            {isExpanded ? 'Hide' : 'View'}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {champ.winrate}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{champ.games}</td>
                      <td className="px-3 py-2 tabular-nums">{champ.kdaLabel}</td>
                      <td className="px-3 py-2 tabular-nums">{champ.avgCs.toFixed(1)}</td>
                    </tr>
                    
                    {/* Conditional rendering for expandable row with unique key */}
                    {isExpanded && (
                      <tr key={`expanded-${champ.id}`} id={`expanded-${champ.id}`} className="bg-slate-50/60 dark:bg-slate-900/40">
                        <td colSpan={5} className="px-4 py-4">
                          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                            <table className="min-w-full text-[11px]" aria-label={`Top players for ${champ.name}`}>
                              <thead className="bg-slate-100 text-left uppercase tracking-widest text-[10px] text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                                <tr>
                                  <th className="px-3 py-2" scope="col">Player</th>
                                  <th className="px-3 py-2" scope="col">Games</th>
                                  <th className="px-3 py-2" scope="col">Record</th>
                                  <th className="px-3 py-2" scope="col">Winrate</th>
                                  <th className="px-3 py-2" scope="col">KDA</th>
                                  <th className="px-3 py-2" scope="col">CS</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 text-slate-600 dark:divide-slate-800 dark:text-slate-300">
                                {champ.players.length === 0 ? (
                                  <tr>
                                    <td colSpan={6} className="px-3 py-3 text-center text-slate-400">
                                      No player data yet.
                                    </td>
                                  </tr>
                                ) : (
                                  champ.players.map((player) => (
                                    <tr key={player.puuid}>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                          {player.iconUrl ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                              src={player.iconUrl}
                                              alt=""
                                              className="h-6 w-6 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                                            />
                                          ) : (
                                            <div className="h-6 w-6 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                                          )}
                                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                                            {player.name}
                                          </span>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 tabular-nums">{player.games}</td>
                                      <td className="px-3 py-2 tabular-nums">
                                        {player.wins}W - {player.losses}L
                                      </td>
                                      <td className="px-3 py-2 tabular-nums">{player.winrate}</td>
                                      <td className="px-3 py-2 tabular-nums">{player.kda.label}</td>
                                      <td className="px-3 py-2 tabular-nums">{player.avgCs.toFixed(1)}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}