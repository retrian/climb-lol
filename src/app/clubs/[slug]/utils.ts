import type { ClubTab } from './types'

export function resolveTab(value?: string | null): ClubTab {
  if (!value) return 'home'
  return value === 'home' || value === 'members' || value === 'leaderboards' || value === 'highlights' ? value : 'home'
}

export function clubUrl(slug: string, opts: { tab?: ClubTab; ok?: string; err?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.tab && opts.tab !== 'home') params.set('tab', opts.tab)
  if (opts.ok) params.set('club_ok', opts.ok)
  if (opts.err) params.set('club_err', opts.err)
  const qs = params.toString()
  return `/clubs/${slug}${qs ? `?${qs}` : ''}`
}

export function formatDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function parseRiotId(input: string): { gameName: string; tagLine: string } {
  const trimmed = input.trim()
  const parts = trimmed.split('#')
  if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
    throw new Error('Riot ID must be in the format gameName#tagLine')
  }
  return { gameName: parts[0].trim(), tagLine: parts[1].trim() }
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

export function profileIconUrl(profileIconId?: number | null) {
  if (!profileIconId) return null
  return `https://ddragon.leagueoflegends.com/cdn/${process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'}/img/profileicon/${profileIconId}.png`
}
