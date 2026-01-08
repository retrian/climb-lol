import { getRiotApiKey } from "./getRiotApiKey";

export async function resolvePuuid(gameName: string, tagLine: string): Promise<string> {
  const key = getRiotApiKey();

  const url = `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;

  const res = await fetch(url, {
    headers: { "X-Riot-Token": key },
    // Server-side only; cache disabled because you want correct mapping when adding.
    cache: "no-store",
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[resolvePuuid] Riot lookup failed", res.status, body.slice(0, 200));
    let message = `Riot lookup failed (${res.status}).`;
    if (res.status === 401) {
      message = "Riot API key is invalid or missing.";
    } else if (res.status === 429) {
      message = "Riot API rate limit hit. Please try again in a moment.";
    }
    throw new Error(message);
  }

  const data = (await res.json()) as { puuid: string };
  if (!data?.puuid) throw new Error("No puuid returned from Riot");
  return data.puuid;
}
