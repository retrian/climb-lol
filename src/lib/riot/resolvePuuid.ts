export async function resolvePuuid(gameName: string, tagLine: string): Promise<string> {
  const key = process.env.RIOT_API_KEY;
  if (!key) throw new Error("RIOT_API_KEY is not set");

  const url = `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

  const res = await fetch(url, {
    headers: { "X-Riot-Token": key },
    // Server-side only; cache disabled because you want correct mapping when adding.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Riot lookup failed (${res.status}). ${body}`.slice(0, 200));
  }

  const data = (await res.json()) as { puuid: string };
  if (!data?.puuid) throw new Error("No puuid returned from Riot");
  return data.puuid;
}
