'use client'

import { useMemo, useState } from 'react'

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

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const direction = sortDirection === 'asc' ? 1 : -1
      if (sortKey === 'winrate') return direction * (a.winrateValue - b.winrateValue)
      if (sortKey === 'games') return direction * (a.games - b.games)
      if (sortKey === 'kda') return direction * (a.kdaValue - b.kdaValue)
      return direction * (a.avgCs - b.avgCs)
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

  return (
    <div className="p-6">
      <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-widest text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Champion</th>
              {SORT_KEYS.map((col) => (
                <th key={col.key} className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-semibold hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    {col.label}
                    <span className="text-[9px] text-slate-400">
                      {sortKey === col.key ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-600 dark:divide-slate-800 dark:text-slate-300">
            {sortedRows.map((champ) => (
              <tr key={champ.id}>
                <td className="px-3 py-2">
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
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{champ.name}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        {champ.wins}W - {champ.losses}L
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {champ.winrate}
                </td>
                <td className="px-3 py-2 tabular-nums">{champ.games}</td>
                <td className="px-3 py-2 tabular-nums">{champ.kdaLabel}</td>
                <td className="px-3 py-2 tabular-nums">{champ.avgCs.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
