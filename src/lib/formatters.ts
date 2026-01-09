export function getKdaColor(kda: number) {
  if (kda >= 5) return 'text-amber-600 font-bold dark:text-amber-400'
  if (kda >= 4) return 'text-blue-600 font-bold dark:text-blue-400'
  if (kda >= 3) return 'text-emerald-600 font-bold dark:text-emerald-400'
  return 'text-slate-600 font-semibold dark:text-slate-300'
}

export function formatMatchDuration(durationS?: number | null) {
  if (!durationS && durationS !== 0) return ''
  const m = Math.floor(durationS / 60)
  const s = durationS % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatDaysHours(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0
  const days = Math.floor(safeSeconds / 86400)
  const hours = Math.floor((safeSeconds % 86400) / 3600)
  return `${days}d ${hours}h`
}
