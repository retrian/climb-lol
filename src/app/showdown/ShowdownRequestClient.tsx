'use client'

import { useMemo, useState, useTransition } from 'react'

type ClubOption = {
  id: string
  name: string
}

type Props = {
  action: (formData: FormData) => void
  clubs: ClubOption[]
  canRequest: boolean
  defaultClubId?: string | null
}

export default function ShowdownRequestClient({ action, clubs, canRequest, defaultClubId }: Props) {
  const [selectedClub, setSelectedClub] = useState(defaultClubId ?? '')
  const [targetClub, setTargetClub] = useState('')
  const [isPending, startTransition] = useTransition()

  const availableTargets = useMemo(() => clubs.filter((club) => club.id !== selectedClub), [clubs, selectedClub])

  return (
    <form
      action={(formData) => {
        if (!canRequest) return
        if (!selectedClub || !targetClub) return
        startTransition(() => action(formData))
      }}
      className="grid gap-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Your club
          <select
            name="requester_club_id"
            value={selectedClub}
            onChange={(event) => setSelectedClub(event.target.value)}
            disabled={!canRequest || isPending}
            className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="" disabled>
              Select your club
            </option>
            {clubs.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
          Opponent club
          <select
            name="target_club_id"
            value={targetClub}
            onChange={(event) => setTargetClub(event.target.value)}
            disabled={!canRequest || isPending}
            className="rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="" disabled>
              Select opponent
            </option>
            {availableTargets.map((club) => (
              <option key={club.id} value={club.id}>
                {club.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button
        type="submit"
        disabled={!canRequest || !selectedClub || !targetClub || isPending}
        className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
      >
        {isPending ? 'Sending request…' : 'Request showdown'}
      </button>

      {!canRequest && (
        <p className="text-xs text-slate-500 dark:text-slate-400">Sign in and join a club to request a showdown.</p>
      )}
    </form>
  )
}
