'use client'

import { useFormStatus } from 'react-dom'

export function AddPlayerButton({ isAtLimit }: { isAtLimit: boolean }) {
  const { pending } = useFormStatus()
  const disabled = isAtLimit || pending
  const label = isAtLimit ? 'Maximum Players Reached' : pending ? 'Adding Player...' : 'Add Player'

  return (
    <button
      type="submit"
      disabled={disabled}
      aria-disabled={disabled}
      className="w-full rounded-none bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 hover:shadow-lg hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
    >
      {label}
    </button>
  )
}

