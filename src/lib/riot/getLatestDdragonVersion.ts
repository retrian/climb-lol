let cache: { version: string; at: number } | null = null
const CACHE_TTL = 12 * 60 * 60 * 1000 // 12 hours

export async function getLatestDdragonVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL) return cache.version

  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
    next: { revalidate: 43200 },
  })

  if (!res.ok) {
    return cache?.version ?? null
  }

  const versions = (await res.json()) as string[]
  if (versions[0]) {
    cache = { version: versions[0], at: Date.now() }
    return versions[0]
  }

  return cache?.version ?? null
}