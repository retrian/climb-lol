import { getRiotApiKey } from "./getRiotApiKey";

export async function resolvePuuid(gameName: string, tagLine: string): Promise<string> {
  const key = getRiotApiKey();

  const res = await fetch(
    `https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    {
      headers: { "X-Riot-Token": key },
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[resolvePuuid] Riot lookup failed", res.status, body.slice(0, 200));
    
    const errorMessages: Record<number, string> = {
      401: "Riot API key is invalid or missing.",
      429: "Riot API rate limit hit. Please try again in a moment.",
    };
    
    throw new Error(errorMessages[res.status] ?? `Riot lookup failed (${res.status}).`);
  }

  const data = (await res.json()) as { puuid: string };
  if (!data?.puuid) throw new Error("No puuid returned from Riot");
  return data.puuid;
}