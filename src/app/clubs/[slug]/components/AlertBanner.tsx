import type { ReactNode } from 'react'

type Props = {
  tone: 'success' | 'error' | 'warning'
  children: ReactNode
}

export default function AlertBanner({ tone, children }: Props) {
  const styles =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      : tone === 'error'
        ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
        : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'

  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>
}
