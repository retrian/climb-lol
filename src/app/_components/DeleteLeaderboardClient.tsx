'use client'

import { useState } from 'react'

interface DeleteLeaderboardProps {
  leaderboardId: string
  // Pass the server action as a prop
  onDelete: (formData: FormData) => Promise<void>
}

export function DeleteLeaderboardClient({ leaderboardId, onDelete }: DeleteLeaderboardProps) {
  const [isArmed, setIsArmed] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  if (!isArmed) {
    return (
      <button
        type="button"
        onClick={() => setIsArmed(true)}
        className="rounded-none border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300"
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
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder="DELETE"
        className="w-24 rounded-none border border-red-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-red-400 dark:border-red-500/40 dark:bg-slate-900 dark:text-slate-100"
      />
      <button
        type="submit"
        disabled={confirmText !== 'DELETE'}
        className="rounded-none bg-red-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-red-500"
      >
        Confirm
      </button>
      <button
        type="button"
        onClick={() => {
          setIsArmed(false)
          setConfirmText('')
        }}
        className="px-1 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400"
      >
        Cancel
      </button>
    </form>
  )
}