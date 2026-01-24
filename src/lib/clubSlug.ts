const MAX_SLUG_PART_LENGTH = 5
const SLUG_PART_RE = /^[a-z0-9]{1,5}$/

function sanitizePart(input: string, fallback: string) {
  const cleaned = input.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, MAX_SLUG_PART_LENGTH)
  return cleaned || fallback
}

export function randomSlugTag() {
  const raw = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(2, 7)
  return raw.padEnd(MAX_SLUG_PART_LENGTH, '0').slice(0, MAX_SLUG_PART_LENGTH)
}

export function normalizeSlugPart(input: string, fallback: string) {
  return sanitizePart(input, fallback)
}

export function parseClubSlug(slug?: string | null) {
  if (!slug) {
    return { prefix: 'club', tag: randomSlugTag() }
  }
  const [prefixRaw = '', tagRaw = ''] = slug.split('-', 2)
  return {
    prefix: sanitizePart(prefixRaw, 'club'),
    tag: sanitizePart(tagRaw, randomSlugTag()),
  }
}

export function validateSlugPart(part: string) {
  if (!part) return `Must be 1-${MAX_SLUG_PART_LENGTH} letters or numbers`
  if (!SLUG_PART_RE.test(part)) return `Use only letters/numbers (${MAX_SLUG_PART_LENGTH} max)`
  return null
}

export function buildClubSlug(prefix: string, tag: string) {
  const safePrefix = sanitizePart(prefix, 'club')
  const safeTag = sanitizePart(tag, randomSlugTag())
  return `${safePrefix}-${safeTag}`
}

export const CLUB_SLUG_PART_MAX = MAX_SLUG_PART_LENGTH
