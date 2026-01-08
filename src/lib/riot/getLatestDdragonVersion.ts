let cache: { version: string; at: number } | null = null

export async function getLatestDdragonVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.at < 12 * 60 * 60 * 1000) return cache.version

  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', {
    next: { revalidate: 43200 },
  })

  if (!res.ok) {
    return cache?.version ?? null
  }

  const versions = (await res.json()) as string[]
  const latest = versions[0]
  if (latest) {
    cache = { version: latest, at: Date.now() }
    return latest
  }

  return cache?.version ?? null
}
