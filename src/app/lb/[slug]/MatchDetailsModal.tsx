'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatMatchDuration } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'

interface MatchResponse {
  metadata: {
    matchId: string
    participants: string[]
  }
  info: {
    gameCreation: number
    gameDuration: number
    gameVersion: string
    gameEndTimestamp?: number
    platformId?: string
    queueId?: number
    participants: RiotParticipant[]
    teams: RiotTeam[]
  }
}

interface TimelineResponse {
  info: {
    frames: Array<{
      timestamp: number
      events: Array<Record<string, any>>
    }>
  }
}

interface RiotParticipant {
  participantId: number
  puuid: string
  championId: number
  champLevel: number
  summonerName: string
  riotIdGameName?: string
  riotIdTagline?: string
  kills: number
  deaths: number
  assists: number
  win: boolean
  teamId: number
  goldEarned: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  visionScore: number
  wardsPlaced?: number
  wardsKilled?: number
  totalMinionsKilled: number
  neutralMinionsKilled: number
  item0: number
  item1: number
  item2: number
  item3: number
  item4: number
  item5: number
  item6: number
  summoner1Id: number
  summoner2Id: number
  perks: {
    styles: Array<{
      style: number
      selections: Array<{ perk: number }>
    }>
    statPerks: {
      defense: number
      flex: number
      offense: number
    }
  }
}

interface RiotTeam {
  teamId: number
  win: boolean
  objectives: Record<string, { kills: number }>
}

interface AccountResponse {
  gameName: string
  tagLine: string
}

interface SummonerResponse {
  summoner: {
    id: string
    puuid: string
    profileIconId: number
    summonerLevel: number
  }
  league?: Array<{
    queueType: string
    tier: string
    rank: string
    leaguePoints: number
    wins: number
    losses: number
  }>
}

interface StaticDataState {
  items: Record<string, any>
  spells: Record<string, any>
  runes: Array<any>
  champions: Record<number, { id: string; name: string; image: { full: string } }>
}

const QUEUE_LABELS: Record<number, string> = {
  420: 'Ranked Solo/Duo',
  440: 'Ranked Flex',
  450: 'ARAM',
}

const EMPTY_STATIC: StaticDataState = {
  items: {},
  spells: {},
  runes: [],
  champions: {},
}

const STATIC_CACHE = new Map<string, StaticDataState>()
const SHARD_LABELS: Record<number, string> = {
  5001: 'HP',
  5002: 'Armor',
  5003: 'MR',
  5005: 'AS',
  5007: 'CDR',
  5008: 'AD',
  5009: 'AP',
}
const FALLBACK_ICON =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" rx="6" ry="6" fill="#1f2937"/></svg>`,
  )

function buildStaticUrl(version: string, path: string) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/${path}`
}

function getItemIconUrl(version: string, itemId: number) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`
}

function getChampionIconUrl(version: string, imageFull: string) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${imageFull}`
}

function getChampionImageFull(champion?: { image?: { full: string }; id?: string }) {
  if (!champion) return null
  if (champion.image?.full) return champion.image.full
  if (champion.id) return `${champion.id}.png`
  return null
}

function buildChampionMap(data: Record<string, any>) {
  const map: Record<number, { id: string; name: string; image: { full: string } }> = {}
  for (const champion of Object.values(data)) {
    const key = Number((champion as { key?: string }).key)
    if (!Number.isFinite(key)) continue
    map[key] = {
      id: (champion as { id: string }).id,
      name: (champion as { name: string }).name,
      image: (champion as { image: { full: string } }).image,
    }
  }
  return map
}

function getMatchPatch(gameVersion?: string | null) {
  if (!gameVersion) return null
  const [major, minor, patchRaw] = gameVersion.split('.')
  if (!major || !minor) return null
  const patchNum = Number(patchRaw)
  let patch = 0
  if (Number.isFinite(patchNum)) {
    patch = patchNum < 10 ? patchNum : Math.floor(patchNum / 100)
  }
  return `${major}.${minor}.${patch}`
}

async function resolveDdragonVersion(gameVersion: string | undefined, fallback: string) {
  const patch = getMatchPatch(gameVersion)
  if (!patch) return fallback
  const [major, minor] = patch.split('.')
  if (!major || !minor) return fallback
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
    if (!res.ok) return fallback
    const versions = (await res.json()) as string[]
    const match = versions.find((version) => version.startsWith(`${major}.${minor}.`))
    return match ?? fallback
  } catch {
    return fallback
  }
}

function handleImageError(event: { currentTarget: HTMLImageElement }) {
  const target = event.currentTarget
  if (target.src !== FALLBACK_ICON) {
    target.src = FALLBACK_ICON
  }
}

function copyToClipboard(value: string) {
  if (!navigator?.clipboard) return
  navigator.clipboard.writeText(value)
}

function getRankTag(entry?: SummonerResponse) {
  const solo = entry?.league?.find((item) => item.queueType === 'RANKED_SOLO_5x5')
  if (!solo?.tier || !solo?.rank) return null
  return `${solo.tier[0]}${solo.rank}`
}

export default function MatchDetailsModal({
  open,
  matchId,
  focusedPuuid,
  champMap,
  ddVersion,
  onClose,
}: {
  open: boolean
  matchId: string | null
  focusedPuuid: string | null
  champMap: any
  ddVersion: string
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'team-analysis' | 'build'>('overview')
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null)
  const [accounts, setAccounts] = useState<Record<string, AccountResponse>>({})
  const [summoners, setSummoners] = useState<Record<string, SummonerResponse>>({})
  const [staticData, setStaticData] = useState<StaticDataState>(EMPTY_STATIC)
  const [error, setError] = useState<string | null>(null)
  const [loadingMatch, setLoadingMatch] = useState(false)
  const [loadingTimeline, setLoadingTimeline] = useState(false)
  const [ddragonVersion, setDdragonVersion] = useState(ddVersion)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return
      const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !matchId) return
    setActiveTab('overview')
    setMatch(null)
    setTimeline(null)
    setAccounts({})
    setSummoners({})
    setError(null)
    setLoadingMatch(true)
    setDdragonVersion(ddVersion)

    const load = async () => {
      try {
        const res = await fetch(`/api/riot/match/${matchId}`)
        if (!res.ok) throw new Error('Failed to load match')
        const data = (await res.json()) as { match: MatchResponse }
        setMatch(data.match)
        setLoadingMatch(false)
      } catch (err) {
        setError('Match details unavailable right now.')
        setLoadingMatch(false)
      }
    }

    load()
  }, [open, matchId])

  useEffect(() => {
    if (!open || !match) return
    const loadVersion = async () => {
      const version = await resolveDdragonVersion(match.info.gameVersion, ddVersion)
      setDdragonVersion(version)
    }
    loadVersion()
  }, [open, match, ddVersion])

  useEffect(() => {
    if (!open || !match) return
    const patch = ddragonVersion
    const loadStatic = async () => {
      try {
        const cached = STATIC_CACHE.get(patch)
        if (cached) {
          setStaticData(cached)
          return
        }
        const [itemsRes, spellsRes, runesRes, champsRes] = await Promise.all([
          fetch(buildStaticUrl(patch, 'data/en_US/item.json')),
          fetch(buildStaticUrl(patch, 'data/en_US/summoner.json')),
          fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/runesReforged.json`),
          fetch(buildStaticUrl(patch, 'data/en_US/champion.json')),
        ])
        if (!itemsRes.ok || !spellsRes.ok || !runesRes.ok || !champsRes.ok) throw new Error('Failed to load DDragon')
        const items = await itemsRes.json()
        const spells = await spellsRes.json()
        const runes = await runesRes.json()
        const champions = await champsRes.json()
        const next = {
          items: items?.data ?? {},
          spells: spells?.data ?? {},
          runes: runes ?? [],
          champions: buildChampionMap(champions?.data ?? {}),
        }
        STATIC_CACHE.set(patch, next)
        setStaticData(next)
      } catch {
        if (patch !== ddVersion) {
          const fallbackCached = STATIC_CACHE.get(ddVersion)
          if (fallbackCached) {
            setStaticData(fallbackCached)
            return
          }
          try {
            const [itemsRes, spellsRes, runesRes, champsRes] = await Promise.all([
              fetch(buildStaticUrl(ddVersion, 'data/en_US/item.json')),
              fetch(buildStaticUrl(ddVersion, 'data/en_US/summoner.json')),
              fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/runesReforged.json`),
              fetch(buildStaticUrl(ddVersion, 'data/en_US/champion.json')),
            ])
            if (!itemsRes.ok || !spellsRes.ok || !runesRes.ok || !champsRes.ok) {
              throw new Error('Failed to load DDragon fallback')
            }
            const items = await itemsRes.json()
            const spells = await spellsRes.json()
            const runes = await runesRes.json()
            const champions = await champsRes.json()
            const next = {
              items: items?.data ?? {},
              spells: spells?.data ?? {},
              runes: runes ?? [],
              champions: buildChampionMap(champions?.data ?? {}),
            }
            STATIC_CACHE.set(ddVersion, next)
            setStaticData(next)
            return
          } catch {
            setStaticData(EMPTY_STATIC)
            return
          }
        }
        setStaticData(EMPTY_STATIC)
      }
    }
    loadStatic()
  }, [open, match, ddVersion])

  useEffect(() => {
    if (!open || !match) return
    const loadTimeline = async () => {
      setLoadingTimeline(true)
      try {
        const res = await fetch(`/api/riot/match/${match.metadata.matchId}/timeline`)
        if (res.ok) {
          const data = (await res.json()) as { timeline: TimelineResponse }
          setTimeline(data.timeline)
        }
      } catch {
        setError((prev) => prev ?? 'Some details are unavailable.')
      } finally {
        setLoadingTimeline(false)
      }
    }
    loadTimeline()
  }, [open, match])

  useEffect(() => {
    if (!open || !match) return
    const loadAccounts = async () => {
      try {
        const entries = await Promise.all(
          match.metadata.participants.map(async (puuid) => {
            try {
              const res = await fetch(`/api/riot/account/${puuid}`)
              if (!res.ok) return [puuid, null] as const
              const data = (await res.json()) as { account: AccountResponse }
              return [puuid, data.account] as const
            } catch {
              return [puuid, null] as const
            }
          }),
        )
        const next: Record<string, AccountResponse> = {}
        for (const [puuid, account] of entries) {
          if (account) next[puuid] = account
        }
        setAccounts(next)
      } catch {
        setError((prev) => prev ?? 'Some details are unavailable.')
      }
    }
    loadAccounts()
  }, [open, match])

  useEffect(() => {
    if (!open || !match) return
    const platform = match.info.platformId
    if (!platform) return

    const loadSummoners = async () => {
      try {
        const entries = await Promise.all(
          match.metadata.participants.map(async (puuid) => {
            try {
              const res = await fetch(`/api/riot/summoner/${platform}/${puuid}`)
              if (!res.ok) return [puuid, null] as const
              const data = (await res.json()) as { summoner: SummonerResponse }
              return [puuid, data.summoner] as const
            } catch {
              return [puuid, null] as const
            }
          }),
        )
        const next: Record<string, SummonerResponse> = {}
        for (const [puuid, entry] of entries) {
          if (entry) next[puuid] = entry
        }
        setSummoners(next)
      } catch {
        setError((prev) => prev ?? 'Some details are unavailable.')
      }
    }

    loadSummoners()
  }, [open, match])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open])

  const focusedParticipant = useMemo(() => {
    if (!match || !focusedPuuid) return null
    return match.info.participants.find((p) => p.puuid === focusedPuuid) ?? null
  }, [match, focusedPuuid])

  const teams = useMemo(() => {
    if (!match) return { blue: [], red: [] }
    const blue = match.info.participants.filter((p) => p.teamId === 100)
    const red = match.info.participants.filter((p) => p.teamId === 200)
    return { blue, red }
  }, [match])

  const teamTotals = useMemo(() => {
    if (!match) {
      return {
        blue: { kills: 0, gold: 0, damage: 0, vision: 0, cs: 0, damageTaken: 0 },
        red: { kills: 0, gold: 0, damage: 0, vision: 0, cs: 0, damageTaken: 0 },
      }
    }
    const getTotals = (participants: RiotParticipant[]) =>
      participants.reduce(
        (acc, p) => {
          acc.kills += p.kills
          acc.gold += p.goldEarned
          acc.damage += p.totalDamageDealtToChampions
          acc.damageTaken += p.totalDamageTaken
          acc.vision += p.visionScore
          acc.cs += p.totalMinionsKilled + p.neutralMinionsKilled
          return acc
        },
        { kills: 0, gold: 0, damage: 0, vision: 0, cs: 0, damageTaken: 0 },
      )
    return { blue: getTotals(teams.blue), red: getTotals(teams.red) }
  }, [match, teams])

  const focusedTimeline = useMemo(() => {
    if (!timeline || !focusedParticipant) return { items: [], skills: [] }
    const events = timeline.info.frames.flatMap((frame) => frame.events ?? [])
    const participantId = focusedParticipant.participantId
    const itemEvents = events.filter(
      (event) => event.participantId === participantId && event.type === 'ITEM_PURCHASED',
    )
    const skillEvents = events.filter(
      (event) => event.participantId === participantId && event.type === 'SKILL_LEVEL_UP',
    )
    return { items: itemEvents, skills: skillEvents }
  }, [timeline, focusedParticipant])

  const focusedRunes = useMemo(() => {
    if (!focusedParticipant) return { keystone: null, primaryTree: null, secondaryTree: null, highlights: [] as any[] }
    const primaryStyle = focusedParticipant.perks?.styles?.[0]
    const secondaryStyle = focusedParticipant.perks?.styles?.[1]
    const keystoneId = primaryStyle?.selections?.[0]?.perk
    const highlightIds = primaryStyle?.selections?.slice(1, 3).map((sel) => sel.perk) ?? []
    const keystone = staticData.runes
      .flatMap((rune) => rune.slots)
      .flatMap((slot) => slot.runes)
      .find((rune) => rune.id === keystoneId)
    const primaryTree = staticData.runes.find((rune) => rune.id === primaryStyle?.style)
    const secondaryTree = staticData.runes.find((rune) => rune.id === secondaryStyle?.style)
    const highlights = staticData.runes
      .flatMap((rune) => rune.slots)
      .flatMap((slot) => slot.runes)
      .filter((rune) => highlightIds.includes(rune.id))
    return { keystone, primaryTree, secondaryTree, highlights }
  }, [focusedParticipant, staticData.runes])

  const focusedPurchaseTimeline = useMemo(() => {
    if (!focusedTimeline.items.length) return []
    const sorted = [...focusedTimeline.items].sort((a, b) => a.timestamp - b.timestamp)
    const condensed: Array<Record<string, any>> = []
    for (const event of sorted) {
      if (!event.itemId) continue
      const last = condensed[condensed.length - 1]
      if (last && last.itemId === event.itemId && event.timestamp - last.timestamp < 1000) {
        continue
      }
      condensed.push(event)
    }
    return condensed
  }, [focusedTimeline.items])

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 md:p-8">
      <div
        ref={containerRef}
        className="flex h-[80vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800/50 bg-slate-950 text-slate-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-details-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Match Details</div>
              <div id="match-details-title" className="text-lg font-semibold text-white">
                {match
                  ? `${match.info.teams?.find((t) => t.teamId === (focusedParticipant?.teamId ?? 100))?.win ? 'Victory' : 'Defeat'} · ${
                      QUEUE_LABELS[match.info.queueId ?? 0] ?? 'Custom'
                    }`
                  : 'Loading match'}
              </div>
              <div className="text-xs text-slate-400">
                {match
                  ? `${formatMatchDuration(match.info.gameDuration)} · ${timeAgo(match.info.gameEndTimestamp ?? match.info.gameCreation)} · Patch ${
                      getMatchPatch(match.info.gameVersion) ?? ddVersion
                    }`
                  : 'Fetching match data'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {match ? (
                <button
                  type="button"
                  className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                  onClick={() => copyToClipboard(match.metadata.matchId)}
                >
                  Copy Match ID
                </button>
              ) : null}
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-700 p-2 text-slate-300 hover:text-white"
                aria-label="Close match details"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            </div>
          </div>
          {focusedParticipant ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300">
              <span className="uppercase tracking-[0.2em] text-slate-500">Focused player</span>
              <span className="font-semibold text-white">
                {accounts[focusedParticipant.puuid]
                  ? `${accounts[focusedParticipant.puuid].gameName}#${accounts[focusedParticipant.puuid].tagLine}`
                  : focusedParticipant.riotIdGameName
                    ? `${focusedParticipant.riotIdGameName}#${focusedParticipant.riotIdTagline}`
                    : focusedParticipant.summonerName}
              </span>
              <span className="text-slate-500">·</span>
              <span>
                {focusedParticipant.kills}/{focusedParticipant.deaths}/{focusedParticipant.assists}
              </span>
            </div>
          ) : null}
        </header>

        <div className="flex flex-col gap-4 border-b border-slate-800 bg-slate-950 px-6 py-3 md:flex-row md:items-center">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'team-analysis', label: 'Team Analysis' },
            { key: 'build', label: 'Build' },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as 'overview' | 'team-analysis' | 'build')}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] ${
                activeTab === tab.key
                  ? 'bg-white text-slate-900'
                  : 'border border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {error ? <span className="text-xs text-amber-300">Some details unavailable.</span> : null}
        </div>

        <div className="flex-1 overflow-hidden px-4 py-6 md:px-6">
          {loadingMatch ? (
            <div className="space-y-4">
              <div className="h-24 rounded-2xl bg-slate-900/60 animate-pulse" />
              <div className="h-64 rounded-2xl bg-slate-900/60 animate-pulse" />
            </div>
          ) : match ? (
            <>
              {activeTab === 'overview' ? (
                <div className="space-y-3">
                  {focusedParticipant ? (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 text-xs text-slate-300">
                      {(() => {
                        const champData =
                          staticData.champions[focusedParticipant.championId] ?? champMap[focusedParticipant.championId]
                        const champImage = getChampionImageFull(champData)
                        if (!champImage) {
                          return <div className="h-8 w-8 rounded-lg border border-slate-800 bg-slate-800" />
                        }
                        return (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={getChampionIconUrl(ddragonVersion, champImage)}
                            alt=""
                            className="h-8 w-8 rounded-lg border border-slate-800"
                            onError={handleImageError}
                          />
                        )
                      })()}
                      <span className="font-semibold text-white">
                        {accounts[focusedParticipant.puuid]
                          ? `${accounts[focusedParticipant.puuid].gameName}#${accounts[focusedParticipant.puuid].tagLine}`
                          : focusedParticipant.riotIdGameName
                            ? `${focusedParticipant.riotIdGameName}#${focusedParticipant.riotIdTagline}`
                            : focusedParticipant.summonerName}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span>
                        {focusedParticipant.kills}/{focusedParticipant.deaths}/{focusedParticipant.assists}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span>{focusedParticipant.goldEarned.toLocaleString()} Gold</span>
                      <span className="text-slate-500">·</span>
                      <span>
                        {((
                          (focusedParticipant.totalMinionsKilled + focusedParticipant.neutralMinionsKilled) /
                          (match.info.gameDuration / 60)
                        ).toFixed(1))}{' '}
                        CS/min
                      </span>
                      <div className="flex items-center gap-1">
                        {(() => {
                          const spells = Object.values(staticData.spells)
                          const spell1 = spells.find((s: any) => Number(s.key) === focusedParticipant.summoner1Id)
                          const spell2 = spells.find((s: any) => Number(s.key) === focusedParticipant.summoner2Id)
                          return (
                            <>
                              {spell1?.image?.full ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={buildStaticUrl(ddragonVersion, `img/spell/${spell1.image.full}`)}
                                  alt={spell1.name}
                                  title={spell1.name}
                                  className="h-6 w-6 rounded"
                                  onError={handleImageError}
                                />
                              ) : null}
                              {spell2?.image?.full ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={buildStaticUrl(ddragonVersion, `img/spell/${spell2.image.full}`)}
                                  alt={spell2.name}
                                  title={spell2.name}
                                  className="h-6 w-6 rounded"
                                  onError={handleImageError}
                                />
                              ) : null}
                              {focusedRunes.keystone?.icon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={`https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.keystone.icon}`}
                                  alt={focusedRunes.keystone.name}
                                  title={focusedRunes.keystone.name}
                                  className="h-6 w-6 rounded-full"
                                  onError={handleImageError}
                                />
                              ) : null}
                            </>
                          )
                        })()}
                      </div>
                      <div className="flex items-center gap-1">
                        {[focusedParticipant.item0, focusedParticipant.item1, focusedParticipant.item2, focusedParticipant.item3, focusedParticipant.item4, focusedParticipant.item5, focusedParticipant.item6]
                          .filter(Boolean)
                          .map((itemId, idx) => {
                            const item = staticData.items[String(itemId)]
                            const src = itemId ? getItemIconUrl(ddragonVersion, itemId) : null
                            return src ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={`${itemId}-${idx}`}
                                src={src}
                                alt={item?.name ?? ''}
                                title={item?.name ?? ''}
                                className="h-6 w-6 rounded"
                                onError={handleImageError}
                              />
                            ) : (
                              <div key={`${itemId}-${idx}`} className="h-6 w-6 rounded bg-slate-800" />
                            )
                          })}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid gap-4 md:grid-cols-2">
                    {[
                      { label: 'Blue Team', teamId: 100, roster: teams.blue },
                      { label: 'Red Team', teamId: 200, roster: teams.red },
                    ].map((team) => (
                      <div key={team.label} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-2">
                        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-300">
                          <span>{team.label}</span>
                          <span>
                            {(team.teamId === 100 ? teamTotals.blue.kills : teamTotals.red.kills).toLocaleString()} K ·{' '}
                            {(team.teamId === 100 ? teamTotals.blue.gold : teamTotals.red.gold).toLocaleString()} G
                          </span>
                        </div>
                        <div className="mt-2 grid gap-1">
                          {team.roster.map((player) => {
                            const champ = staticData.champions[player.championId] ?? champMap[player.championId]
                            const champImage = getChampionImageFull(champ)
                            const champSrc = champImage ? getChampionIconUrl(ddragonVersion, champImage) : null
                            const cs = player.totalMinionsKilled + player.neutralMinionsKilled
                            const csPerMin = match.info.gameDuration
                              ? (cs / (match.info.gameDuration / 60)).toFixed(1)
                              : '0.0'
                            const totalKills =
                              (player.teamId === 100 ? teamTotals.blue.kills : teamTotals.red.kills) || 1
                            const kp = (((player.kills + player.assists) / totalKills) * 100).toFixed(0)
                            const maxDamage = Math.max(
                              ...team.roster.map((p) => p.totalDamageDealtToChampions || 0),
                              1,
                            )
                            const items = [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5]
                            const spells = Object.values(staticData.spells)
                            const spell1 = spells.find((s: any) => Number(s.key) === player.summoner1Id)
                            const spell2 = spells.find((s: any) => Number(s.key) === player.summoner2Id)
                            const keystoneId = player.perks?.styles?.[0]?.selections?.[0]?.perk
                            const keystone = staticData.runes
                              .flatMap((rune) => rune.slots)
                              .flatMap((slot) => slot.runes)
                              .find((rune) => rune.id === keystoneId)

                            return (
                              <div
                                key={player.puuid}
                                className={`grid items-center gap-2 rounded-xl border border-slate-800/60 bg-slate-950/40 px-2 py-1.5 md:grid-cols-[170px_80px_1fr_60px_60px_140px] ${
                                  focusedPuuid === player.puuid ? 'ring-1 ring-amber-400/60' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  {champSrc ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={champSrc}
                                      alt=""
                                      className="h-8 w-8 rounded-lg border border-slate-800"
                                      onError={handleImageError}
                                    />
                                  ) : (
                                    <div className="h-8 w-8 rounded-lg border border-slate-800 bg-slate-800" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="truncate text-[11px] font-semibold text-white">
                                      {accounts[player.puuid]
                                        ? `${accounts[player.puuid].gameName}#${accounts[player.puuid].tagLine}`
                                        : player.riotIdGameName
                                          ? `${player.riotIdGameName}#${player.riotIdTagline}`
                                          : player.summonerName}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-[10px] text-slate-300">
                                  <div className="font-semibold text-white">
                                    {player.kills}/{player.deaths}/{player.assists}
                                  </div>
                                  <div className="text-slate-400">KP {kp}%</div>
                                </div>
                                <div className="text-[10px] text-slate-300">
                                  <div className="flex items-center justify-between text-[9px] text-slate-400">
                                    <span>Dmg</span>
                                    <span>{player.totalDamageDealtToChampions.toLocaleString()}</span>
                                  </div>
                                  <div className="mt-1 h-1 w-full rounded-full bg-slate-800">
                                    <div
                                      className="h-1 rounded-full bg-rose-500"
                                      style={{ width: `${(player.totalDamageDealtToChampions / maxDamage) * 100}%` }}
                                    />
                                  </div>
                                </div>
                                <div className="text-[10px] text-slate-300">
                                  <div className="text-[9px] text-slate-400">CS</div>
                                  <div className="font-semibold text-white">{cs}</div>
                                  <div className="text-[9px] text-slate-400">{csPerMin}</div>
                                </div>
                                <div className="text-[10px] text-slate-300">
                                  <div className="text-[9px] text-slate-400">Vis</div>
                                  <div className="font-semibold text-white">{player.visionScore}</div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                  {items.map((itemId, idx) => {
                                    if (!itemId) return null
                                    const item = staticData.items[String(itemId)]
                                    const src = itemId ? getItemIconUrl(ddragonVersion, itemId) : null
                                    return src ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={`${player.puuid}-item-${idx}`}
                                        src={src}
                                        alt={item?.name ?? ''}
                                        title={item?.name ?? ''}
                                        className="h-5 w-5 rounded"
                                        onError={handleImageError}
                                      />
                                    ) : (
                                      <div key={`${player.puuid}-item-${idx}`} className="h-5 w-5 rounded bg-slate-800" />
                                    )
                                  })}
                                  {player.item6 ? (
                                    (() => {
                                      const item = staticData.items[String(player.item6)]
                                      const src = player.item6 ? getItemIconUrl(ddragonVersion, player.item6) : null
                                      return src ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={src}
                                          alt={item?.name ?? ''}
                                          title={item?.name ?? ''}
                                          className="h-5 w-5 rounded border border-slate-700"
                                          onError={handleImageError}
                                        />
                                      ) : (
                                        <div className="h-5 w-5 rounded bg-slate-800" />
                                      )
                                    })()
                                  ) : null}
                                  {spell1?.image?.full ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={buildStaticUrl(ddragonVersion, `img/spell/${spell1.image.full}`)}
                                      alt={spell1.name}
                                      title={spell1.name}
                                      className="h-5 w-5 rounded"
                                      onError={handleImageError}
                                    />
                                  ) : (
                                    <div className="h-5 w-5 rounded bg-slate-800" />
                                  )}
                                  {spell2?.image?.full ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={buildStaticUrl(ddragonVersion, `img/spell/${spell2.image.full}`)}
                                      alt={spell2.name}
                                      title={spell2.name}
                                      className="h-5 w-5 rounded"
                                      onError={handleImageError}
                                    />
                                  ) : (
                                    <div className="h-5 w-5 rounded bg-slate-800" />
                                  )}
                                  {keystone?.icon ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={`https://ddragon.leagueoflegends.com/cdn/img/${keystone.icon}`}
                                      alt={keystone.name}
                                      title={keystone.name}
                                      className="h-5 w-5 rounded-full"
                                      onError={handleImageError}
                                    />
                                  ) : (
                                    <div className="h-5 w-5 rounded-full bg-slate-800" />
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Player names and ranks use Account-V1, Summoner-V4, and League-V4. Icons use Data Dragon.
                  </div>
                </div>
              ) : null}

              {activeTab === 'team-analysis' ? (
                <div className="max-h-full overflow-y-auto pr-1">
                  <div className="space-y-6">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span>Team analysis</span>
                    <span>Match-V5 /lol/match/v5/matches</span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {[
                      { label: 'Champion Kills', key: 'kills' },
                      { label: 'Gold', key: 'gold' },
                      { label: 'Damage Dealt', key: 'damage' },
                      { label: 'Damage Taken', key: 'damageTaken' },
                      { label: 'Vision/Wards', key: 'vision' },
                      { label: 'CS', key: 'cs' },
                    ].map((block) => {
                      const blueTotal = teamTotals.blue[block.key as keyof typeof teamTotals.blue]
                      const redTotal = teamTotals.red[block.key as keyof typeof teamTotals.red]
                      const total = blueTotal + redTotal || 1
                      const blueMax = Math.max(
                        ...teams.blue.map((player) => {
                          return block.key === 'kills'
                            ? player.kills
                            : block.key === 'gold'
                              ? player.goldEarned
                              : block.key === 'damage'
                                ? player.totalDamageDealtToChampions
                                : block.key === 'vision'
                                  ? player.visionScore
                                  : block.key === 'damageTaken'
                                    ? player.totalDamageTaken
                                    : player.totalMinionsKilled + player.neutralMinionsKilled
                        }),
                        1,
                      )
                      const redMax = Math.max(
                        ...teams.red.map((player) => {
                          return block.key === 'kills'
                            ? player.kills
                            : block.key === 'gold'
                              ? player.goldEarned
                              : block.key === 'damage'
                                ? player.totalDamageDealtToChampions
                                : block.key === 'vision'
                                  ? player.visionScore
                                  : block.key === 'damageTaken'
                                    ? player.totalDamageTaken
                                    : player.totalMinionsKilled + player.neutralMinionsKilled
                        }),
                        1,
                      )
                      return (
                        <div key={block.label} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                            <span>{block.label}</span>
                            <span>
                              {blueTotal.toLocaleString()} / {redTotal.toLocaleString()}
                            </span>
                          </div>
                          <div className="mt-3 flex items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-slate-800">
                              <div className="h-2 rounded-full bg-blue-500" style={{ width: `${(blueTotal / total) * 100}%` }} />
                            </div>
                            <div className="h-2 flex-1 rounded-full bg-slate-800">
                              <div className="h-2 rounded-full bg-rose-500" style={{ width: `${(redTotal / total) * 100}%` }} />
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 text-xs text-slate-400 md:grid-cols-2">
                            <div className="space-y-1">
                              {teams.blue.map((player) => {
                                const value =
                                  block.key === 'kills'
                                    ? player.kills
                                    : block.key === 'gold'
                                      ? player.goldEarned
                                      : block.key === 'damage'
                                        ? player.totalDamageDealtToChampions
                                        : block.key === 'vision'
                                          ? player.visionScore
                                          : block.key === 'damageTaken'
                                            ? player.totalDamageTaken
                                            : player.totalMinionsKilled + player.neutralMinionsKilled
                                const champ = staticData.champions[player.championId] ?? champMap[player.championId]
                                const champImage = getChampionImageFull(champ)
                                const champSrc = champImage ? getChampionIconUrl(ddragonVersion, champImage) : null
                                return (
                                  <div key={`${block.label}-blue-${player.puuid}`} className="flex items-center gap-2">
                                    {champSrc ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={champSrc}
                                        alt=""
                                        className="h-5 w-5 rounded-md border border-slate-800"
                                        onError={handleImageError}
                                      />
                                    ) : (
                                      <div className="h-5 w-5 rounded-md border border-slate-800 bg-slate-800" />
                                    )}
                                    <span className="w-12 text-[11px] text-slate-300">{value}</span>
                                    <div className="h-1 w-full rounded-full bg-slate-800">
                                      <div className="h-1 rounded-full bg-blue-500" style={{ width: `${(value / blueMax) * 100}%` }} />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            <div className="space-y-1">
                              {teams.red.map((player) => {
                                const value =
                                  block.key === 'kills'
                                    ? player.kills
                                    : block.key === 'gold'
                                      ? player.goldEarned
                                      : block.key === 'damage'
                                        ? player.totalDamageDealtToChampions
                                        : block.key === 'vision'
                                          ? player.visionScore
                                          : block.key === 'damageTaken'
                                            ? player.totalDamageTaken
                                            : player.totalMinionsKilled + player.neutralMinionsKilled
                                const champ = staticData.champions[player.championId] ?? champMap[player.championId]
                                const champImage = getChampionImageFull(champ)
                                const champSrc = champImage ? getChampionIconUrl(ddragonVersion, champImage) : null
                                return (
                                  <div key={`${block.label}-red-${player.puuid}`} className="flex items-center gap-2">
                                    {champSrc ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={champSrc}
                                        alt=""
                                        className="h-5 w-5 rounded-md border border-slate-800"
                                        onError={handleImageError}
                                      />
                                    ) : (
                                      <div className="h-5 w-5 rounded-md border border-slate-800 bg-slate-800" />
                                    )}
                                    <span className="w-12 text-[11px] text-slate-300">{value}</span>
                                    <div className="h-1 w-full rounded-full bg-slate-800">
                                      <div className="h-1 rounded-full bg-rose-500" style={{ width: `${(value / redMax) * 100}%` }} />
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  </div>
                </div>
              ) : null}

              {activeTab === 'build' ? (
                <div className="max-h-full overflow-y-auto pr-1">
                  <div className="space-y-6">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span>Build</span>
                    <span>Match-V5 + Timeline-V5</span>
                  </div>
                  {!focusedParticipant ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
                      Focused player not found for this match.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Final build</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {[focusedParticipant.item0, focusedParticipant.item1, focusedParticipant.item2, focusedParticipant.item3, focusedParticipant.item4, focusedParticipant.item5].map(
                              (itemId, idx) => {
                                if (!itemId) {
                                  return <div key={`${itemId}-${idx}`} className="h-9 w-9 rounded border border-slate-800/80" />
                                }
                                const item = staticData.items[String(itemId)]
                                const src = itemId ? getItemIconUrl(ddragonVersion, itemId) : null
                                return src ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    key={`${itemId}-${idx}`}
                                    src={src}
                                    alt={item?.name ?? ''}
                                    title={item?.name ?? ''}
                                    className="h-9 w-9 rounded"
                                    onError={handleImageError}
                                  />
                                ) : (
                                  <div key={`${itemId}-${idx}`} className="h-9 w-9 rounded border border-slate-800/80" />
                                )
                              },
                            )}
                            {focusedParticipant.item6 ? (
                              (() => {
                                const item = staticData.items[String(focusedParticipant.item6)]
                                const src = focusedParticipant.item6
                                  ? getItemIconUrl(ddragonVersion, focusedParticipant.item6)
                                  : null
                                return src ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={src}
                                    alt={item?.name ?? ''}
                                    title={item?.name ?? ''}
                                    className="h-9 w-9 rounded border border-slate-700"
                                    onError={handleImageError}
                                  />
                                ) : (
                                  <div className="h-9 w-9 rounded bg-slate-800" />
                                )
                              })()
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Runes</div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {focusedRunes.keystone?.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.keystone.icon}`}
                                alt={focusedRunes.keystone.name}
                                title={focusedRunes.keystone.name}
                                className="h-9 w-9 rounded-full"
                                onError={handleImageError}
                              />
                            ) : (
                              <div className="h-9 w-9 rounded-full bg-slate-800" />
                            )}
                            {focusedRunes.primaryTree?.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.primaryTree.icon}`}
                                alt={focusedRunes.primaryTree.name}
                                title={focusedRunes.primaryTree.name}
                                className="h-8 w-8 rounded-full"
                                onError={handleImageError}
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-slate-800" />
                            )}
                            {focusedRunes.secondaryTree?.icon ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={`https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.secondaryTree.icon}`}
                                alt={focusedRunes.secondaryTree.name}
                                title={focusedRunes.secondaryTree.name}
                                className="h-8 w-8 rounded-full"
                                onError={handleImageError}
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-slate-800" />
                            )}
                            {focusedRunes.highlights.map((rune) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                key={rune.id}
                                src={`https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`}
                                alt={rune.name}
                                title={rune.name}
                                className="h-7 w-7 rounded-full"
                                onError={handleImageError}
                              />
                            ))}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
                            {focusedParticipant.perks?.statPerks ? (
                              <>
                                <span className="rounded-full border border-slate-700 px-2 py-0.5">
                                  {SHARD_LABELS[focusedParticipant.perks.statPerks.offense] ?? `Shard ${focusedParticipant.perks.statPerks.offense}`}
                                </span>
                                <span className="rounded-full border border-slate-700 px-2 py-0.5">
                                  {SHARD_LABELS[focusedParticipant.perks.statPerks.flex] ?? `Shard ${focusedParticipant.perks.statPerks.flex}`}
                                </span>
                                <span className="rounded-full border border-slate-700 px-2 py-0.5">
                                  {SHARD_LABELS[focusedParticipant.perks.statPerks.defense] ?? `Shard ${focusedParticipant.perks.statPerks.defense}`}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Summ spells + start</div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {(() => {
                              const spells = Object.values(staticData.spells)
                              const spell1 = spells.find((s: any) => Number(s.key) === focusedParticipant.summoner1Id)
                              const spell2 = spells.find((s: any) => Number(s.key) === focusedParticipant.summoner2Id)
                              return (
                                <>
                                  {spell1?.image?.full ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={buildStaticUrl(ddragonVersion, `img/spell/${spell1.image.full}`)}
                                      alt={spell1.name}
                                      title={spell1.name}
                                      className="h-9 w-9 rounded"
                                      onError={handleImageError}
                                    />
                                  ) : (
                                    <div className="h-9 w-9 rounded bg-slate-800" />
                                  )}
                                  {spell2?.image?.full ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                      src={buildStaticUrl(ddragonVersion, `img/spell/${spell2.image.full}`)}
                                      alt={spell2.name}
                                      title={spell2.name}
                                      className="h-9 w-9 rounded"
                                      onError={handleImageError}
                                    />
                                  ) : (
                                    <div className="h-9 w-9 rounded bg-slate-800" />
                                  )}
                                </>
                              )
                            })()}
                            {focusedPurchaseTimeline
                              .filter((event) => event.type === 'ITEM_PURCHASED' && event.timestamp <= 120000)
                              .slice(0, 3)
                              .map((event, idx) => {
                                const item = staticData.items[String(event.itemId)]
                                const src = event.itemId ? getItemIconUrl(ddragonVersion, event.itemId) : null
                              return src ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={`${event.timestamp}-${idx}`}
                                  src={src}
                                  alt={item?.name ?? ''}
                                  title={item?.name ?? ''}
                                  className="h-8 w-8 rounded"
                                  onError={handleImageError}
                                />
                              ) : (
                                <div key={`${event.timestamp}-${idx}`} className="h-8 w-8 rounded bg-slate-800" />
                              )
                            })}
                          </div>
                        </div>
                      </div>
                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Item build order</div>
                          {loadingTimeline ? (
                            <div className="mt-3 h-24 rounded-xl bg-slate-800/60 animate-pulse" />
                          ) : focusedPurchaseTimeline.length ? (
                            <ul className="mt-3 space-y-2 text-xs text-slate-300">
                              {focusedPurchaseTimeline.slice(0, 10).map((event, idx) => {
                                const item = staticData.items[String(event.itemId)]
                                const src = event.itemId ? getItemIconUrl(ddragonVersion, event.itemId) : null
                                const minutes = Math.floor(event.timestamp / 60000)
                                const seconds = Math.floor((event.timestamp % 60000) / 1000)
                                const label = item?.name ?? `Item ${event.itemId}`
                                return (
                                  <li key={`${event.timestamp}-${idx}`} className="flex items-center justify-between">
                                    <span className="flex items-center gap-2">
                                      {src ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={src} alt={label} title={label} className="h-8 w-8 rounded" onError={handleImageError} />
                                      ) : (
                                        <div className="h-8 w-8 rounded bg-slate-800" />
                                      )}
                                      <span>{label}</span>
                                    </span>
                                    <span>
                                      {minutes}:{seconds.toString().padStart(2, '0')}
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          ) : (
                            <div className="mt-3 text-xs text-slate-400">No item timeline available.</div>
                          )}
                        </div>
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Skill order</div>
                          {focusedTimeline.skills.length ? (
                            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
                              {focusedTimeline.skills.map((event, idx) => (
                                <span key={`${event.timestamp}-${idx}`} className="rounded bg-slate-800 px-2 py-1">
                                  {event.skillSlot === 1 ? 'Q' : event.skillSlot === 2 ? 'W' : event.skillSlot === 3 ? 'E' : 'R'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 text-xs text-slate-400">Skill order unavailable.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
              Match data unavailable.
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (!open || !mounted) return null

  return createPortal(
    <div role="presentation" onClick={onClose}>
      {modalContent}
    </div>,
    document.body,
  )
}
