type DDragonChampion = {
  key: string // numeric champ id as string (e.g. "141")
  id: string // champ key name used in icon URL (e.g. "Kayn")
  name: string
}

type ChampMap = Record<number, { id: string; name: string }>

let cache: { map: ChampMap; at: number } | null = null

export async function getChampionMap(ddVersion: string): Promise<ChampMap> {
  // cache for 24h in server runtime
  if (cache && Date.now() - cache.at < 24 * 60 * 60 * 1000) return cache.map

  const res = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/champion.json`,
    { next: { revalidate: 86400 } } // Next.js cache hint
  )
  if (!res.ok) throw new Error(`Failed to fetch champion.json: ${res.status}`)

  const json = (await res.json()) as any
  const data = json.data as Record<string, DDragonChampion>

  const map: ChampMap = {}
  for (const champ of Object.values(data)) {
    const numId = Number(champ.key)
    map[numId] = { id: champ.id, name: champ.name }
  }

  cache = { map, at: Date.now() }
  return map
}

export function championIconUrl(ddVersion: string, champKey: string) {
  return `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/champion/${champKey}.png`
}
