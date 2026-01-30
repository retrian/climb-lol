'use client'

import { useState } from 'react'

interface Props {
  leaderboardId: string
  onDelete: (formData: FormData) => Promise<void>
}

export function DeleteLeaderboardButton({ leaderboardId, onDelete }: Props) {
  const [isArmed, setIsArmed] = useState(false)
  const [confirmValue, setConfirmValue] = useState('')

  if (!isArmed) {
    return (
      <button
        type="button"
        onClick={() => setIsArmed(true)}
        className="rounded-none border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        Delete
      </button>
    )
  }

  return (
    <form action={onDelete} className="flex items-center gap-2">
      <input type="hidden" name="leaderboard_id" value={leaderboardId} />
      <input
        name="confirm"
        value={confirmValue}
        onChange={(e) => setConfirmValue(e.target.value)}
        placeholder="DELETE"
        autoFocus
        className="w-24 rounded-none border border-red-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-red-400 focus:ring-4 focus:ring-red-400/10 transition-all duration-200 shadow-sm dark:border-red-500/40 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
      />
      <button
        type="submit"
        disabled={confirmValue !== 'DELETE'}
        className="rounded-none bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition-all duration-200 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-500 dark:hover:bg-red-400"
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() => {
          setIsArmed(false)
          setConfirmValue('')
        }}
        className="px-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
      >
        Cancel
      </button>
    </form>
  )
}