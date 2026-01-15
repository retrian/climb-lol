const DEFAULT_RANKED_SEASON_START = '2026-01-08T20:00:00.000Z'

export function getRankedSeasonStartIso() {
  return process.env.RANKED_SEASON_START || DEFAULT_RANKED_SEASON_START
}

export function getRankedSeasonStartMs() {
  return new Date(getRankedSeasonStartIso()).getTime()
}
