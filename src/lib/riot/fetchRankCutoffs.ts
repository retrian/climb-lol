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

  for (const queue of queues) {
    try {
      // Fetch Challenger
      const challenger = await riotFetch<LeagueList>(
        `${NA1}/lol/league/v4/challengerleagues/by-queue/${queue}`,
        apiKey
      )
      if (challenger.entries && challenger.entries.length > 0) {
        const minLP = Math.min(...challenger.entries.map((e) => e.leaguePoints))
        cutoffs.push({ queue_type: queue, tier: 'CHALLENGER', cutoff_lp: minLP })
        console.log(`[cutoffs] ${queue} CHALLENGER cutoff: ${minLP} LP`)
      }

      // Fetch Grandmaster
      const grandmaster = await riotFetch<LeagueList>(
        `${NA1}/lol/league/v4/grandmasterleagues/by-queue/${queue}`,
        apiKey
      )
      if (grandmaster.entries && grandmaster.entries.length > 0) {
        const minLP = Math.min(...grandmaster.entries.map((e) => e.leaguePoints))
        cutoffs.push({ queue_type: queue, tier: 'GRANDMASTER', cutoff_lp: minLP })
        console.log(`[cutoffs] ${queue} GRANDMASTER cutoff: ${minLP} LP`)
      }
    } catch (e) {
      console.error(`[cutoffs] Error fetching for ${queue}:`, e)
    }
  }

  return cutoffs
}
