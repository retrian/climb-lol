const TIER_WEIGHT = {
  CHALLENGER: 10,
  GRANDMASTER: 9,
  MASTER: 8,
  DIAMOND: 7,
  EMERALD: 6,
  PLATINUM: 5,
  GOLD: 4,
  SILVER: 3,
  BRONZE: 2,
  IRON: 1,
} as const

const DIVISION_WEIGHT = {
  I: 4,
  II: 3,
  III: 2,
  IV: 1,
} as const

const APEX_TIERS = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER'])

export type RankSnapshot = {
  tier?: string | null
  rank?: string | null
  league_points?: number | null
}

export function rankSortKey(r: RankSnapshot | undefined): [number, number, number] {
  if (!r) return [0, 0, 0]

  const tier = TIER_WEIGHT[(r.tier?.toUpperCase() ?? '') as keyof typeof TIER_WEIGHT] ?? 0
  const division = DIVISION_WEIGHT[(r.rank?.toUpperCase() ?? '') as keyof typeof DIVISION_WEIGHT] ?? 0
  const lp = r.league_points ?? 0

  return [tier, division, lp]
}

export function compareRanks(a: RankSnapshot | undefined, b: RankSnapshot | undefined): number {
  const keyA = rankSortKey(a)
  const keyB = rankSortKey(b)

  if (keyB[0] !== keyA[0]) return keyB[0] - keyA[0]
  if (keyB[1] !== keyA[1]) return keyB[1] - keyA[1]
  return keyB[2] - keyA[2]
}

export function rankScore(r: RankSnapshot | undefined): number {
  const [tier, division, lp] = rankSortKey(r)
  const isApex = APEX_TIERS.has(r?.tier?.toUpperCase?.() ?? '')
  const divisionScore = isApex ? 0 : division
  return tier * 10000 + divisionScore * 1000 + lp
}