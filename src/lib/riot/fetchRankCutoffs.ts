/**
 * Fetch Challenger/Grandmaster LP cutoffs from Riot API
 */

const NA1 = 'https://na1.api.riotgames.com'

async function riotFetch<T>(url: string, apiKey: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'X-Riot-Token': apiKey,
      'User-Agent': 'climb.lol-refresh/1.0',
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[riotFetch] FAIL', res.status, url, body.slice(0, 200))
    throw new Error(`Riot ${res.status}: ${body}`.slice(0, 200))
  }

  return (await res.json()) as T
}

type LeagueEntry = {
  leaguePoints: number
  [key: string]: any
}

type LeagueList = {
  entries?: LeagueEntry[]
  [key: string]: any
}

export async function fetchRankCutoffs(apiKey: string) {
  const queues = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR']
  const cutoffs: Array<{ queue_type: string; tier: string; cutoff_lp: number }> = []

  const results = await Promise.allSettled(
    queues.flatMap((queue) => [
      riotFetch<LeagueList>(`${NA1}/lol/league/v4/challengerleagues/by-queue/${queue}`, apiKey)
        .then((data) => ({ queue, tier: 'CHALLENGER' as const, data })),
      riotFetch<LeagueList>(`${NA1}/lol/league/v4/grandmasterleagues/by-queue/${queue}`, apiKey)
        .then((data) => ({ queue, tier: 'GRANDMASTER' as const, data })),
    ])
  )

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { queue, tier, data } = result.value
      if (data.entries && data.entries.length > 0) {
        const minLP = Math.min(...data.entries.map((e) => e.leaguePoints))
        cutoffs.push({ queue_type: queue, tier, cutoff_lp: minLP })
        console.log(`[cutoffs] ${queue} ${tier} cutoff: ${minLP} LP`)
      }
    } else {
      console.error(`[cutoffs] Error fetching:`, result.reason)
    }
  }

  return cutoffs
}