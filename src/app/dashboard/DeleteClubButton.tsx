'use client'

import { useState } from 'react'

interface Props {
  onDelete: (formData: FormData) => Promise<void>
}

export function DeleteClubButton({ onDelete }: Props) {
  const [isArmed, setIsArmed] = useState(false)

  if (!isArmed) {
    return (
      <button
        type="button"
        onClick={() => setIsArmed(true)}
        className="rounded-none border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:bg-red-50 hover:-translate-y-0.5 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/30"
      >
        Delete
      </button>
    )
  }

  return (
    <form action={onDelete} className="flex items-center gap-2">
      <input type="hidden" name="club_confirm" value="1" />
      <button
        type="submit"
        className="rounded-none bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-red-700"
      >
        Confirm delete
      </button>
      <button
        type="button"
        onClick={() => setIsArmed(false)}
        className="px-1 text-xs font-semibold text-red-700 hover:text-red-900 dark:text-red-300 dark:hover:text-red-100"
      >
        Cancel
      </button>
    </form>
  )
}