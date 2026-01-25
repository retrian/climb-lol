'use client'

import { useMemo, useState } from 'react'

type GoalMode = 'LIVE' | 'RACE' | 'LP_GOAL' | 'RANK_GOAL'

type Props = {
  defaultMode: GoalMode
  defaultLpGoal?: number | null
  defaultRaceStart?: string | null
  defaultRaceEnd?: string | null
  defaultRankGoal?: string | null
}

const RANK_TIERS = [
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

function isoToLocalInput(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 16)
}

export default function GoalModeFields({
  defaultMode,
  defaultLpGoal,
  defaultRaceStart,
  defaultRaceEnd,
  defaultRankGoal,
}: Props) {
  const [mode, setMode] = useState<GoalMode>(defaultMode)

  const notes = useMemo(() => {
    if (mode === 'LIVE') return 'No end condition. Tracking remains open and updates continuously.'
    if (mode === 'RACE') return 'Tracks only within the chosen time window. Updates stop after the end time.'
    if (mode === 'LP_GOAL') return 'Ends when a player reaches the target LP, regardless of tier.'
    return 'Ends when a player reaches the target tier. Same-day ties go to higher LP.'
  }, [mode])

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
      <div className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Goal Mode</div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{notes}</p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Mode</label>
          <select
            name="goal_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as GoalMode)}
            className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="LIVE">Live Tracker (default)</option>
            <option value="RACE">Race Mode (time window)</option>
            <option value="LP_GOAL">LP Goal Mode</option>
            <option value="RANK_GOAL">Rank Goal Mode</option>
          </select>
        </div>

        {mode === 'LP_GOAL' && (
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">LP Goal</label>
            <input
              type="number"
              name="lp_goal"
              defaultValue={defaultLpGoal ?? ''}
              min={1}
              placeholder="e.g., 1000"
              className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        )}
      </div>

      {mode === 'RACE' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Race start</label>
            <input
              type="datetime-local"
              name="race_start_at"
              defaultValue={isoToLocalInput(defaultRaceStart)}
              className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Race end</label>
            <input
              type="datetime-local"
              name="race_end_at"
              defaultValue={isoToLocalInput(defaultRaceEnd)}
              className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>
        </div>
      )}

      {mode === 'RANK_GOAL' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Rank goal</label>
            <select
              name="rank_goal_tier"
              defaultValue={defaultRankGoal ?? ''}
              className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">Select tier</option>
              {RANK_TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier.charAt(0) + tier.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
