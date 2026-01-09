const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(fromMs: number, nowMs = Date.now()) {
  const diffSec = Math.floor((nowMs - fromMs) / 1000)
  const abs = Math.abs(diffSec)

  if (abs < 60) return rtf.format(-diffSec, 'second')

  const diffMin = Math.floor(diffSec / 60)
  if (Math.abs(diffMin) < 60) return rtf.format(-diffMin, 'minute')

  const diffHr = Math.floor(diffMin / 60)
  if (Math.abs(diffHr) < 48) return rtf.format(-diffHr, 'hour')

  const diffDay = Math.floor(diffHr / 24)
  return rtf.format(-diffDay, 'day')
}