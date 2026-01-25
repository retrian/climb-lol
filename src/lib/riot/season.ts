type SeasonRow = {
  season: number
  startIso: string
  regionStartIso?: Partial<Record<RegionCode, string>>
}

export type SeasonInfo = {
  season: number
  startIso: string
  endIso: string | null
  source: 'override' | 'table' | 'version'
}

export type RegionCode =
  | 'NA'
  | 'NA1'
  | 'EUW'
  | 'EUW1'
  | 'EUNE'
  | 'EUN1'
  | 'KR'
  | 'JP'
  | 'JP1'
  | 'BR'
  | 'BR1'
  | 'LAN'
  | 'LA1'
  | 'LAS'
  | 'LA2'
  | 'OCE'
  | 'OC1'
  | 'RU'
  | 'TR'
  | 'CN'

const SEASON_STARTS: SeasonRow[] = [
  { season: 2024, startIso: '2024-01-10T20:00:00.000Z' },
  { season: 2025, startIso: '2025-01-08T20:00:00.000Z' },
  {
    season: 2026,
    startIso: '2026-01-08T20:00:00.000Z',
    regionStartIso: {
      OCE: '2026-01-08T01:00:00.000Z',
      OC1: '2026-01-08T01:00:00.000Z',
      JP: '2026-01-08T03:00:00.000Z',
      JP1: '2026-01-08T03:00:00.000Z',
      KR: '2026-01-08T03:00:00.000Z',
      CN: '2026-01-08T04:00:00.000Z',
      EUNE: '2026-01-08T11:00:00.000Z',
      EUN1: '2026-01-08T11:00:00.000Z',
      EUW: '2026-01-08T12:00:00.000Z',
      EUW1: '2026-01-08T12:00:00.000Z',
      RU: '2026-01-08T09:00:00.000Z',
      TR: '2026-01-08T09:00:00.000Z',
      LAS: '2026-01-08T15:00:00.000Z',
      LA2: '2026-01-08T15:00:00.000Z',
      BR: '2026-01-08T15:00:00.000Z',
      BR1: '2026-01-08T15:00:00.000Z',
      LAN: '2026-01-08T18:00:00.000Z',
      LA1: '2026-01-08T18:00:00.000Z',
      NA: '2026-01-08T20:00:00.000Z',
      NA1: '2026-01-08T20:00:00.000Z',
    },
  },
]

function seasonFromPatchMajor(major: number | null): number | null {
  if (!major || !Number.isFinite(major)) return null
  return 2010 + Math.floor(major)
}

function parsePatchMajor(ddVersion?: string | null): number | null {
  if (!ddVersion) return null
  const majorRaw = ddVersion.split('.')[0]
  const major = Number(majorRaw)
  return Number.isFinite(major) ? major : null
}

function normalizeRegionCode(region?: string | null): RegionCode | null {
  if (!region) return null
  const normalized = region.toUpperCase()
  const known: Set<RegionCode> = new Set([
    'NA',
    'NA1',
    'EUW',
    'EUW1',
    'EUNE',
    'EUN1',
    'KR',
    'JP',
    'JP1',
    'BR',
    'BR1',
    'LAN',
    'LA1',
    'LAS',
    'LA2',
    'OCE',
    'OC1',
    'RU',
    'TR',
    'CN',
  ])
  return (known.has(normalized as RegionCode) ? (normalized as RegionCode) : null)
}

function buildSeasonTable(region?: string | null): Array<SeasonInfo> {
  const regionCode = normalizeRegionCode(region)
  const sorted = [...SEASON_STARTS].sort((a, b) => a.season - b.season)
  return sorted.map((row, idx) => {
    const next = sorted[idx + 1]
    const regionStart = regionCode ? row.regionStartIso?.[regionCode] : undefined
    return {
      season: row.season,
      startIso: regionStart ?? row.startIso,
      endIso: next?.startIso ?? null,
      source: 'table',
    }
  })
}

function resolveByDate(now: Date, table: Array<SeasonInfo>): SeasonInfo {
  const nowMs = now.getTime()
  for (const row of table) {
    const startMs = new Date(row.startIso).getTime()
    const endMs = row.endIso ? new Date(row.endIso).getTime() : null
    if (nowMs >= startMs && (endMs === null || nowMs < endMs)) return row
  }
  return table[table.length - 1]
}

function resolveByVersion(ddVersion: string | null | undefined, table: Array<SeasonInfo>): SeasonInfo | null {
  const major = parsePatchMajor(ddVersion)
  const season = seasonFromPatchMajor(major)
  if (!season) return null
  return table.find((row) => row.season === season) ?? null
}

export function getCurrentSeasonInfo({
  now = new Date(),
  ddVersion,
  region,
}: {
  now?: Date
  ddVersion?: string | null
  region?: string | null
} = {}): SeasonInfo {
  const override = process.env.NEXT_PUBLIC_SEASON_START || process.env.RANKED_SEASON_START
  if (override) {
    return {
      season: now.getUTCFullYear(),
      startIso: override,
      endIso: null,
      source: 'override',
    }
  }

  const table = buildSeasonTable(region)
  const byDate = resolveByDate(now, table)
  const byVersion = resolveByVersion(ddVersion ?? null, table)

  if (byVersion && byVersion.season >= byDate.season) {
    return { ...byVersion, source: 'version' }
  }

  return byDate
}

export function getSeasonStartIso(
  args: { now?: Date; ddVersion?: string | null; region?: string | null } = {}
): string {
  return getCurrentSeasonInfo(args).startIso
}
