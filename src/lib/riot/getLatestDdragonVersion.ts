let cache: { version: string; at: number } | null = null
const CACHE_TTL = 12 * 60 * 60 * 1000 // 12 hours
const FETCH_TIMEOUT_MS = 800

export async function getLatestDdragonVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.version

  const fallbackVersion =
    cache?.version ??
    process.env.NEXT_PUBLIC_DDRAGON_VERSION ??
    process.env.DDRAGON_VERSION ??
    null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
      next: { revalidate: 43200 },
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timeout)
    return fallbackVersion
  }

  clearTimeout(timeout)

  if (!res.ok) {
    return fallbackVersion
  }

  const versions = (await res.json()) as string[]
  if (versions[0]) {
    cache = { version: versions[0], at: Date.now() }
    return versions[0]
  }

  return cache?.version ?? null
}
