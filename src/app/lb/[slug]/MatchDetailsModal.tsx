'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { championIconUrl } from '@/lib/champions'
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
}

function buildStaticUrl(version: string, path: string) {
  return `https://ddragon.leagueoflegends.com/cdn/${version}/${path}`
}

function getMatchPatch(gameVersion?: string | null) {
  if (!gameVersion) return null
  const [major, minor] = gameVersion.split('.')
  if (!major || !minor) return null
  return `${major}.${minor}`
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
  const [activeTab, setActiveTab] = useState<'overview' | 'build' | 'timeline'>('overview')
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null)
  const [accounts, setAccounts] = useState<Record<string, AccountResponse>>({})
  const [summoners, setSummoners] = useState<Record<string, SummonerResponse>>({})
  const [staticData, setStaticData] = useState<StaticDataState>(EMPTY_STATIC)
  const [error, setError] = useState<string | null>(null)
  const [loadingMatch, setLoadingMatch] = useState(false)
  const [loadingTimeline, setLoadingTimeline] = useState(false)
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
    const patch = getMatchPatch(match.info.gameVersion) ?? ddVersion
    const loadStatic = async () => {
      try {
        const [itemsRes, spellsRes, runesRes] = await Promise.all([
          fetch(buildStaticUrl(patch, 'data/en_US/item.json')),
          fetch(buildStaticUrl(patch, 'data/en_US/summoner.json')),
          fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/runesReforged.json`),
        ])
        const items = itemsRes.ok ? await itemsRes.json() : null
        const spells = spellsRes.ok ? await spellsRes.json() : null
        const runes = runesRes.ok ? await runesRes.json() : null
        setStaticData({
          items: items?.data ?? {},
          spells: spells?.data ?? {},
          runes: runes ?? [],
        })
      } catch {
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

  const ddragonVersion = useMemo(() => {
    if (!match) return ddVersion
    return getMatchPatch(match.info.gameVersion) ?? ddVersion
  }, [match, ddVersion])

  const focusedTimeline = useMemo(() => {
    if (!timeline || !focusedParticipant) return { items: [], skills: [], timeline: [] }
    const events = timeline.info.frames.flatMap((frame) => frame.events ?? [])
    const participantId = focusedParticipant.participantId
    const itemEvents = events.filter(
      (event) =>
        event.participantId === participantId &&
        ['ITEM_PURCHASED', 'ITEM_SOLD', 'ITEM_UNDO'].includes(event.type),
    )
    const skillEvents = events.filter(
      (event) => event.participantId === participantId && event.type === 'SKILL_LEVEL_UP',
    )
    const timelineEvents = events.filter(
      (event) =>
        event.participantId === participantId &&
        ['ITEM_PURCHASED', 'ITEM_SOLD', 'ITEM_UNDO', 'SKILL_LEVEL_UP', 'LEVEL_UP'].includes(event.type),
    )
    return { items: itemEvents, skills: skillEvents, timeline: timelineEvents }
  }, [timeline, focusedParticipant])

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 md:p-8">
      <div
        ref={containerRef}
        className="flex h-full max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800/50 bg-slate-950 text-slate-100 shadow-2xl"
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
          {['overview', 'build', 'timeline'].map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab as 'overview' | 'build' | 'timeline')}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] ${
                activeTab === tab
                  ? 'bg-white text-slate-900'
                  : 'border border-slate-800 text-slate-300 hover:border-slate-600'
              }`}
            >
              {tab}
            </button>
          ))}
          {error ? <span className="text-xs text-amber-300">Some details unavailable.</span> : null}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
          {loadingMatch ? (
            <div className="space-y-4">
              <div className="h-24 rounded-2xl bg-slate-900/60 animate-pulse" />
              <div className="h-64 rounded-2xl bg-slate-900/60 animate-pulse" />
            </div>
          ) : match ? (
            <>
              {activeTab === 'overview' ? (
                <div className="space-y-8">
                  <section className="space-y-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                      <span>Team scoreboard</span>
                      <span>Match-V5 /lol/match/v5/matches</span>
                    </div>
                    {[
                      { label: 'Blue Team', teamId: 100, roster: teams.blue },
                      { label: 'Red Team', teamId: 200, roster: teams.red },
                    ].map((team) => (
                      <div key={team.label} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
                          <span>{team.label}</span>
                          <span>
                            {team.teamId === 100 ? teamTotals.blue.kills : teamTotals.red.kills} Kills ·{' '}
                            {(team.teamId === 100 ? teamTotals.blue.gold : teamTotals.red.gold).toLocaleString()} Gold
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {team.roster.map((player) => {
                            const champ = champMap[player.championId]
                            const champSrc = champ ? championIconUrl(ddVersion, champ.id) : null
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
                            const maxTaken = Math.max(...team.roster.map((p) => p.totalDamageTaken || 0), 1)
                            const items = [player.item0, player.item1, player.item2, player.item3, player.item4, player.item5]
                            const spells = Object.values(staticData.spells)
                            const spell1 = spells.find((s: any) => Number(s.key) === player.summoner1Id)
                            const spell2 = spells.find((s: any) => Number(s.key) === player.summoner2Id)
                            const keystoneId = player.perks?.styles?.[0]?.selections?.[0]?.perk
                            const secondaryStyle = player.perks?.styles?.[1]?.style
                            const rankTag = getRankTag(summoners[player.puuid])
                            const keystone = staticData.runes
                              .flatMap((rune) => rune.slots)
                              .flatMap((slot) => slot.runes)
                              .find((rune) => rune.id === keystoneId)
                            const secondaryTree = staticData.runes.find((rune) => rune.id === secondaryStyle)

                            return (
                              <div
                                key={player.puuid}
                                className={`grid gap-3 rounded-xl border border-slate-800/60 bg-slate-950/40 p-3 md:grid-cols-[220px_120px_1fr_1fr_120px_120px_140px] ${
                                  focusedPuuid === player.puuid ? 'ring-1 ring-amber-400/60' : ''
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  {champSrc ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={champSrc} alt="" className="h-10 w-10 rounded-xl border border-slate-800" />
                                  ) : (
                                    <div className="h-10 w-10 rounded-xl border border-slate-800 bg-slate-800" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-white">
                                      {accounts[player.puuid]
                                        ? `${accounts[player.puuid].gameName}#${accounts[player.puuid].tagLine}`
                                        : player.riotIdGameName
                                          ? `${player.riotIdGameName}#${player.riotIdTagline}`
                                          : player.summonerName}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                      <span>
                                        Level {player.champLevel} · {champ?.name ?? 'Unknown'}
                                      </span>
                                      {rankTag ? (
                                        <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-300">
                                          {rankTag}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                                <div className="text-xs text-slate-300">
                                  <div className="font-semibold text-white">
                                    {player.kills}/{player.deaths}/{player.assists}
                                  </div>
                                  <div className="text-slate-400">KP {kp}%</div>
                                </div>
                                <div className="text-xs text-slate-300">
                                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                                    <span>Dmg</span>
                                    <span>{player.totalDamageDealtToChampions.toLocaleString()}</span>
                                  </div>
                                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                                    <div
                                      className="h-1.5 rounded-full bg-rose-500"
                                      style={{ width: `${(player.totalDamageDealtToChampions / maxDamage) * 100}%` }}
                                    />
                                  </div>
                                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                                    <span>Taken</span>
                                    <span>{player.totalDamageTaken.toLocaleString()}</span>
                                  </div>
                                  <div className="mt-1 h-1.5 w-full rounded-full bg-slate-800">
                                    <div
                                      className="h-1.5 rounded-full bg-blue-500"
                                      style={{ width: `${(player.totalDamageTaken / maxTaken) * 100}%` }}
                                    />
                                  </div>
                                </div>
                                <div className="text-xs text-slate-300">
                                  <div className="text-[11px] text-slate-400">CS</div>
                                  <div className="font-semibold text-white">{cs}</div>
                                  <div className="text-[11px] text-slate-400">{csPerMin} / min</div>
                                </div>
                                <div className="text-xs text-slate-300">
                                  <div className="text-[11px] text-slate-400">Vision</div>
                                  <div className="font-semibold text-white">{player.visionScore}</div>
                                  <div className="text-[11px] text-slate-400">
                                    {player.wardsPlaced ?? 0}/{player.wardsKilled ?? 0} W
                                  </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-1">
                                  {items.map((itemId, idx) => {
                                    if (!itemId) {
                                      return <div key={`${player.puuid}-item-${idx}`} className="h-7 w-7 rounded bg-slate-800" />
                                    }
                                    const item = staticData.items[String(itemId)]
                                    const src = item ? buildStaticUrl(ddragonVersion, `img/item/${item.image.full}`) : null
                                    return src ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        key={`${player.puuid}-item-${idx}`}
                                        src={src}
                                        alt={item?.name ?? ''}
                                        title={item?.name ?? ''}
                                        className="h-7 w-7 rounded"
                                      />
                                    ) : (
                                      <div key={`${player.puuid}-item-${idx}`} className="h-7 w-7 rounded bg-slate-800" />
                                    )
                                  })}
                                  {player.item6 ? (
                                    (() => {
                                      const item = staticData.items[String(player.item6)]
                                      const src = item ? buildStaticUrl(ddragonVersion, `img/item/${item.image.full}`) : null
                                      return src ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={src}
                                          alt={item?.name ?? ''}
                                          title={item?.name ?? ''}
                                          className="h-7 w-7 rounded border border-slate-700"
                                        />
                                      ) : (
                                        <div className="h-7 w-7 rounded bg-slate-800" />
                                      )
                                    })()
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-300">
                                  <div className="flex items-center gap-1">
                                    {spell1?.image?.full ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={buildStaticUrl(ddragonVersion, `img/spell/${spell1.image.full}`)}
                                        alt={spell1.name}
                                        title={spell1.name}
                                        className="h-6 w-6 rounded"
                                      />
                                    ) : (
                                      <div className="h-6 w-6 rounded bg-slate-800" />
                                    )}
                                    {spell2?.image?.full ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={buildStaticUrl(ddragonVersion, `img/spell/${spell2.image.full}`)}
                                        alt={spell2.name}
                                        title={spell2.name}
                                        className="h-6 w-6 rounded"
                                      />
                                    ) : (
                                      <div className="h-6 w-6 rounded bg-slate-800" />
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {keystone?.icon ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={`https://ddragon.leagueoflegends.com/cdn/img/${keystone.icon}`} alt={keystone.name} className="h-6 w-6 rounded-full" />
                                    ) : (
                                      <div className="h-6 w-6 rounded-full bg-slate-800" />
                                    )}
                                    {secondaryTree?.icon ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={`https://ddragon.leagueoflegends.com/cdn/img/${secondaryTree.icon}`} alt={secondaryTree.name} className="h-6 w-6 rounded-full" />
                                    ) : (
                                      <div className="h-6 w-6 rounded-full bg-slate-800" />
                                    )}
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                    <div className="grid gap-3 md:grid-cols-2">
                      {[
                        { label: 'Total kills', blue: teamTotals.blue.kills, red: teamTotals.red.kills },
                        { label: 'Total gold', blue: teamTotals.blue.gold, red: teamTotals.red.gold },
                      ].map((row) => {
                        const total = row.blue + row.red || 1
                        return (
                          <div key={row.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                            <div className="text-xs uppercase tracking-[0.2em] text-slate-400">{row.label}</div>
                            <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                              <span>{row.blue.toLocaleString()}</span>
                              <span>{row.red.toLocaleString()}</span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-slate-800">
                              <div
                                className="h-2 rounded-full bg-blue-500"
                                style={{ width: `${(row.blue / total) * 100}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Player names and ranks use Account-V1, Summoner-V4, and League-V4. Icons use Data Dragon.
                    </div>
                  </section>

                  <section className="space-y-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                      <span>Match analysis</span>
                      <span>Match-V5 /lol/match/v5/matches</span>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {[
                        { label: 'Champion Kills', key: 'kills' },
                        { label: 'Gold', key: 'gold' },
                        { label: 'Damage', key: 'damage' },
                        { label: 'Wards/Vision', key: 'vision' },
                        { label: 'Damage Taken', key: 'damageTaken' },
                        { label: 'CS', key: 'cs' },
                      ].map((block) => {
                        const blueTotal = teamTotals.blue[block.key as keyof typeof teamTotals.blue]
                        const redTotal = teamTotals.red[block.key as keyof typeof teamTotals.red]
                        const total = blueTotal + redTotal || 1
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
                            <div className="mt-3 grid gap-1 text-xs text-slate-400">
                              {teams.blue.map((player) => (
                                <div key={`${block.label}-${player.puuid}`} className="flex items-center justify-between">
                                  <span className="truncate text-slate-300">
                                    {accounts[player.puuid]
                                      ? `${accounts[player.puuid].gameName}`
                                      : player.riotIdGameName ?? player.summonerName}
                                  </span>
                                  <span>
                                    {block.key === 'kills'
                                      ? player.kills
                                      : block.key === 'gold'
                                        ? player.goldEarned
                                        : block.key === 'damage'
                                          ? player.totalDamageDealtToChampions
                                          : block.key === 'vision'
                                            ? player.visionScore
                                            : block.key === 'damageTaken'
                                              ? player.totalDamageTaken
                                              : player.totalMinionsKilled + player.neutralMinionsKilled}
                                  </span>
                                </div>
                              ))}
                              <div className="h-px bg-slate-800/60" />
                              {teams.red.map((player) => (
                                <div key={`${block.label}-red-${player.puuid}`} className="flex items-center justify-between">
                                  <span className="truncate text-slate-300">
                                    {accounts[player.puuid]
                                      ? `${accounts[player.puuid].gameName}`
                                      : player.riotIdGameName ?? player.summonerName}
                                  </span>
                                  <span>
                                    {block.key === 'kills'
                                      ? player.kills
                                      : block.key === 'gold'
                                        ? player.goldEarned
                                        : block.key === 'damage'
                                          ? player.totalDamageDealtToChampions
                                          : block.key === 'vision'
                                            ? player.visionScore
                                            : block.key === 'damageTaken'
                                              ? player.totalDamageTaken
                                              : player.totalMinionsKilled + player.neutralMinionsKilled}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                </div>
              ) : null}

              {activeTab === 'build' ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span>Focused build</span>
                    <span>Match-V5 + Timeline-V5</span>
                  </div>
                  {!focusedParticipant ? (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
                      Focused player not found for this match.
                    </div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Item build timeline</div>
                        {loadingTimeline ? (
                          <div className="mt-3 h-24 rounded-xl bg-slate-800/60 animate-pulse" />
                        ) : focusedTimeline.items.length ? (
                          <ul className="mt-3 space-y-2 text-xs text-slate-300">
                            {focusedTimeline.items.slice(0, 12).map((event, idx) => {
                              const item = staticData.items[String(event.itemId)]
                              const src = item ? buildStaticUrl(ddragonVersion, `img/item/${item.image.full}`) : null
                              return (
                                <li key={`${event.timestamp}-${idx}`} className="flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    {src ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={src} alt={item?.name ?? ''} title={item?.name ?? ''} className="h-7 w-7 rounded" />
                                    ) : (
                                      <div className="h-7 w-7 rounded bg-slate-800" />
                                    )}
                                    <span>{item?.name ?? `Item ${event.itemId}`}</span>
                                  </span>
                                  <span>{Math.floor(event.timestamp / 60000)}m</span>
                                </li>
                              )
                            })}
                          </ul>
                        ) : (
                          <div className="mt-3 text-xs text-slate-400">No timeline items found.</div>
                        )}
                      </div>
                      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
                        <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Final items & runes</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {[focusedParticipant.item0, focusedParticipant.item1, focusedParticipant.item2, focusedParticipant.item3, focusedParticipant.item4, focusedParticipant.item5, focusedParticipant.item6]
                            .filter(Boolean)
                            .map((itemId, idx) => {
                              const item = staticData.items[String(itemId)]
                              const src = item ? buildStaticUrl(ddragonVersion, `img/item/${item.image.full}`) : null
                              return src ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={`${itemId}-${idx}`} src={src} alt={item?.name ?? ''} title={item?.name ?? ''} className="h-9 w-9 rounded" />
                              ) : (
                                <div key={`${itemId}-${idx}`} className="h-9 w-9 rounded bg-slate-800" />
                              )
                            })}
                        </div>
                        <div className="mt-4 grid gap-3">
                          <div className="text-xs uppercase tracking-[0.2em] text-slate-400">Skill order</div>
                          {focusedTimeline.skills.length ? (
                            <div className="flex flex-wrap gap-2 text-xs text-slate-300">
                              {focusedTimeline.skills.map((event, idx) => (
                                <span key={`${event.timestamp}-${idx}`} className="rounded bg-slate-800 px-2 py-1">
                                  {event.skillSlot === 1 ? 'Q' : event.skillSlot === 2 ? 'W' : event.skillSlot === 3 ? 'E' : 'R'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-400">Skill order unavailable.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}

              {activeTab === 'timeline' ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span>Timeline</span>
                    <span>Timeline-V5 /lol/match/v5/matches/{match.metadata.matchId}/timeline</span>
                  </div>
                  {loadingTimeline ? (
                    <div className="h-24 rounded-xl bg-slate-800/60 animate-pulse" />
                  ) : focusedTimeline.timeline.length ? (
                    <ul className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-300">
                      {focusedTimeline.timeline.slice(0, 20).map((event, idx) => (
                        <li key={`${event.timestamp}-${idx}`} className="flex items-center justify-between">
                          <span>{event.type.replaceAll('_', ' ').toLowerCase()}</span>
                          <span>{Math.floor(event.timestamp / 60000)}m</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-400">
                      Timeline events unavailable.
                    </div>
                  )}
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
