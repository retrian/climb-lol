export function getRiotApiKey(): string {
  const rawKey = process.env.RIOT_API_KEY ?? process.env.NEXT_PUBLIC_RIOT_API_KEY;
  if (!rawKey) throw new Error("RIOT_API_KEY is not set");

  const sanitized = rawKey.trim().replace(/^['"]|['"]$/g, "");
  if (!sanitized) throw new Error("RIOT_API_KEY is not set");

  return sanitized;
}
