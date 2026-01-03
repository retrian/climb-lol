export function parseRiotId(input: string): { gameName: string; tagLine: string } {
  const trimmed = input.trim();
  const parts = trimmed.split("#");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error("Riot ID must be in the format gameName#tagLine");
  }
  return { gameName: parts[0].trim(), tagLine: parts[1].trim() };
}
