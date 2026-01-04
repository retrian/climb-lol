const APEX = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER'])

export function formatRank(tier?: string | null, division?: string | null, lp?: number | null) {
  if (!tier) return 'Unranked'

  const T = tier.toUpperCase()
  const showDivision = !!division && !APEX.has(T)

  const niceTier = T[0] + T.slice(1).toLowerCase()
  const niceDiv = division ?? ''
  const niceLp = lp ?? 0

  return `${niceTier}${showDivision ? ` ${niceDiv}` : ''}   ${niceLp} LP`
}
