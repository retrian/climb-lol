'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import FitText from './FitText'
import { championIconUrl } from '@/lib/champions'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'

interface Player {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
  role: string | null
  twitch_url: string | null
  twitter_url: string | null
  sort_order: number
}

interface RankData {
  tier: string | null
  rank: string | null
  league_points: number | null
  wins: number | null
  losses: number | null
  queueType?: string | null
}

interface PlayerCard {
  player: Player
  index: number
  rankData: RankData | null
  stateData: { profile_icon_id?: number | null } | null
  topChamps: Array<{ champion_id: number }>
}

interface MatchSummary {
  matchId: string
  puuid: string
  championId: number
  win: boolean
  k: number
  d: number
  a: number
  cs: number
  endTs?: number | null
  durationS?: number | null
  queueId?: number | null
}

interface MatchDetailResponse {
  metadata: { matchId: string }
  info: {
    gameCreation: number
    gameDuration: number
    gameEndTimestamp?: number
    gameVersion: string
    queueId?: number
    participants: RiotParticipant[]
    teams: RiotTeam[]
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
  perks?: {
    styles: Array<{ style: number; selections: Array<{ perk: number }> }>
  }
  goldEarned?: number
  totalDamageDealtToChampions?: number
  totalDamageTaken?: number
}

interface RiotTeam {
  teamId: number
  win: boolean
  objectives?: Record<string, { kills: number }>
}

interface StaticDataState {
  spells: Record<string, any>
  runes: Array<any>
}

const REGION_MAP: Record<string, string> = {
  NA1: 'na',
  EUW1: 'euw',
  EUN1: 'eune',
  KR: 'kr',
  JP1: 'jp',
  BR1: 'br',
  LA1: 'lan',
  LA2: 'las',
  OC1: 'oce',
  TR1: 'tr',
  RU: 'ru',
  PH2: 'ph',
  SG2: 'sg',
  TH2: 'th',
  TW2: 'tw',
  VN2: 'vn',
}

const QUEUE_LABELS: Record<number, string> = {
  420: 'Ranked Solo/Duo',
  440: 'Ranked Flex',
  400: 'Normal Draft',
  430: 'Normal Blind',
  450: 'ARAM',
}

const summaryCache = new Map<string, any>()
const matchesCache = new Map<string, MatchSummary[]>()
const matchDetailCache = new Map<string, MatchDetailResponse>()
const staticCache = new Map<string, StaticDataState>()

function profileIconUrl(profileIconId?: number | null, ddVersion?: string) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = ddVersion || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profileIconId}.png`
}

function displayRiotId(p: Player) {
  const gn = (p.game_name ?? '').trim()
  const tl = (p.tag_line ?? '').trim()
  if (gn && tl) return `${gn}#${tl}`
  return p.puuid
}

function getOpggUrl(player: Player) {
  const gn = (player.game_name ?? '').trim()
  const tl = (player.tag_line ?? '').trim()
  if (!gn || !tl) return null

  const region = REGION_MAP[tl.toUpperCase()] ?? 'na'
  const riotId = `${gn}-${tl}`
  return `https://op.gg/lol/summoners/${region}/${encodeURIComponent(riotId)}`
}

function getRankIconSrc(tier?: string | null) {
  if (!tier) return '/images/UNRANKED_SMALL.jpg'
  return `/images/${tier.toUpperCase()}_SMALL.jpg`
}

function formatWinrate(wins?: number | null, losses?: number | null) {
  const w = wins ?? 0
  const l = losses ?? 0
  const total = w + l
  if (total === 0) return { label: '0W - 0L', pct: 0, total: 0 }
  const pct = Math.round((w / total) * 100)
  return {
    label: `${w}W - ${l}L`,
    pct: Math.min(100, Math.max(0, pct)),
    total,
  }
}

function formatTierLabel(tier?: string | null, division?: string | null) {
  if (!tier) return 'Unranked'
  const isApex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)
  return isApex ? tier : `${tier} ${division || ''}`.trim()
}

function buildSpellIconUrl(version: string, spell: any) {
  if (!spell?.image?.full) return null
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spell.image.full}`
}

function buildRuneIconUrl(icon?: string | null) {
  if (!icon) return null
  return `https://ddragon.leagueoflegends.com/cdn/img/${icon}`
}

function buildItemIconUrl(version: string, id: number) {
  if (!id) return null
  return `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png`
}

function formatCsPerMin(cs: number, durationS?: number | null) {
  if (!durationS) return '0.0'
  const minutes = durationS / 60
  if (!minutes) return '0.0'
  return (cs / minutes).toFixed(1)
}

function useStaticData(ddVersion: string, active: boolean) {
  const [data, setData] = useState<StaticDataState>({ spells: {}, runes: [] })

  useEffect(() => {
    if (!active) return
    if (staticCache.has(ddVersion)) {
      setData(staticCache.get(ddVersion)!)
      return
    }

    let mounted = true

    Promise.all([
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/summoner.json`),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/runesReforged.json`),
    ])
      .then(async ([spellsRes, runesRes]) => {
        if (!spellsRes.ok || !runesRes.ok) throw new Error('Static data fetch failed')
        const spells = (await spellsRes.json()).data
        const runes = await runesRes.json()
        const payload = { spells, runes }
        staticCache.set(ddVersion, payload)
        if (mounted) setData(payload)
      })
      .catch(() => {
        if (mounted) setData({ spells: {}, runes: [] })
      })

    return () => {
      mounted = false
    }
  }, [ddVersion, active])

  return data
}

function buildSpellMap(spells: Record<string, any>) {
  const map = new Map<number, any>()
  Object.values(spells).forEach((spell: any) => {
    const key = Number(spell.key)
    if (Number.isFinite(key)) map.set(key, spell)
  })
  return map
}

function buildRuneMap(runes: Array<any>) {
  const map = new Map<number, any>()
  runes.forEach((style) => {
    map.set(style.id, style)
    style.slots?.forEach((slot: any) => {
      slot.runes?.forEach((rune: any) => map.set(rune.id, rune))
    })
  })
  return map
}

function MatchDetailSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm animate-pulse dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="ml-auto h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" />
        </div>
      ))}
    </div>
  )
}

function HeaderSkeleton() {
  return (
    <div className="flex items-center gap-4 animate-pulse">
      <div className="h-14 w-14 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-800" />
        <div className="h-3 w-48 rounded bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  )
}

export default function PlayerMatchHistoryClient({
  playerCards,
  champMap,
  ddVersion,
}: {
  playerCards: PlayerCard[]
  champMap: any
  ddVersion: string
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard | null>(null)
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<any>(null)
  const [matches, setMatches] = useState<MatchSummary[]>([])
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [activeTab, setActiveTab] = useState<'matches' | 'stats' | 'champions'>('matches')
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null)
  const [matchDetails, setMatchDetails] = useState<Record<string, MatchDetailResponse | null>>({})
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const matchDetailRequests = useRef(new Set<string>())

  const hasPlayers = playerCards.length > 0
  const top3 = playerCards.slice(0, 3)
  const rest = playerCards.slice(3)

  const staticData = useStaticData(ddVersion, open)
  const spellMap = useMemo(() => buildSpellMap(staticData.spells), [staticData.spells])
  const runeMap = useMemo(() => buildRuneMap(staticData.runes), [staticData.runes])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
      if (event.key === 'Tab') {
        const container = modalRef.current
        if (!container) return
        const focusables = Array.from(
          container.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'))
        if (!focusables.length) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open || !selectedPlayer) return

    const puuid = selectedPlayer.player.puuid
    setActiveTab('matches')
    setExpandedMatchId(null)

    const cachedSummary = summaryCache.get(puuid)
    if (cachedSummary) {
      setSummary(cachedSummary)
    } else {
      setLoadingSummary(true)
      fetch(`/api/player/${puuid}/summary`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          summaryCache.set(puuid, data)
          setSummary(data)
        })
        .catch(() => setSummary(null))
        .finally(() => setLoadingSummary(false))
    }

    const cachedMatches = matchesCache.get(puuid)
    if (cachedMatches) {
      setMatches(cachedMatches)
    } else {
      setLoadingMatches(true)
      fetch(`/api/player/${puuid}/matches?limit=20`)
        .then((res) => (res.ok ? res.json() : Promise.reject()))
        .then((data) => {
          const list = data.matches ?? []
          matchesCache.set(puuid, list)
          setMatches(list)
        })
        .catch(() => setMatches([]))
        .finally(() => setLoadingMatches(false))
    }
  }, [open, selectedPlayer])

  const ensureMatchDetail = async (matchId: string) => {
    if (matchDetailCache.has(matchId) || matchDetailRequests.current.has(matchId)) return
    matchDetailRequests.current.add(matchId)
    try {
      const res = await fetch(`/api/match/${matchId}`)
      if (!res.ok) return
      const data = await res.json()
      if (data?.match) {
        matchDetailCache.set(matchId, data.match)
        setMatchDetails((prev) => ({ ...prev, [matchId]: data.match }))
      }
    } finally {
      matchDetailRequests.current.delete(matchId)
    }
  }

  useEffect(() => {
    if (!open || matches.length === 0) return

    const primed = matches.slice(0, 3)
    let cancelled = false

    const prime = async () => {
      for (const match of primed) {
        if (cancelled) return
        await ensureMatchDetail(match.matchId)
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    }

    prime().catch(() => null)
    return () => {
      cancelled = true
    }
  }, [open, matches])

  const handleOpen = (card: PlayerCard) => {
    setSelectedPlayer(card)
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    setSelectedPlayer(null)
    setSummary(null)
    setMatches([])
    setExpandedMatchId(null)
  }

  const renderPodiumCard = (card: PlayerCard, rank: number) => {
    const rankData = card.rankData
    const winrate = formatWinrate(rankData?.wins, rankData?.losses)
    const icon = profileIconUrl(card.stateData?.profile_icon_id, ddVersion)
    const opggUrl = getOpggUrl(card.player)

    let cardBg = 'bg-white dark:bg-slate-900'
    let accentColor = 'from-slate-400 to-slate-600'
    let rankBg = 'bg-slate-600'
    let rankText = 'text-slate-100'
    let hoverEffect = 'hover:shadow-xl hover:-translate-y-1'
    let sizeClass = 'scale-90'
    let glowEffect = ''

    if (rank === 1) {
      cardBg = 'bg-white dark:bg-slate-900'
      accentColor = 'from-yellow-400 via-yellow-500 to-amber-600'
      rankBg = 'bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-600'
      rankText = 'text-white'
      hoverEffect = 'hover:shadow-2xl hover:-translate-y-2'
      sizeClass = 'scale-110'
      glowEffect = 'shadow-2xl shadow-yellow-500/25 ring-2 ring-yellow-400/30'
    } else if (rank === 2) {
      accentColor = 'from-slate-300 via-slate-400 to-slate-500'
      rankBg = 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500'
      rankText = 'text-white'
      sizeClass = 'scale-100'
    } else if (rank === 3) {
      accentColor = 'from-orange-400 via-amber-600 to-orange-700'
      rankBg = 'bg-gradient-to-r from-orange-400 via-amber-600 to-orange-700'
      rankText = 'text-white'
      sizeClass = 'scale-90'
    }

    const tier = rankData?.tier
    const division = rankData?.rank
    const isApex = tier && ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)
    let tierDisplay = null

    if (tier && !isApex) {
      tierDisplay = `${tier} ${division || ''}`.trim()
    }

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => handleOpen(card)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleOpen(card)
          }
        }}
        className={`group relative flex flex-col ${cardBg} rounded-2xl shadow-lg ${hoverEffect} ${sizeClass} ${glowEffect} transition-all duration-300 overflow-hidden border border-slate-200 dark:border-slate-800 cursor-pointer`}
      >
        <div className={`h-1.5 w-full bg-gradient-to-r ${accentColor}`} />
        <div className="absolute top-3 right-3 z-10">
          <div className={`${rankBg} px-3 py-1.5 rounded-lg shadow-md ${rankText} text-xs font-bold tracking-wide`}>
            #{rank}
          </div>
        </div>
        <div className="p-6 flex flex-col items-center">

          <div className="relative h-24 w-24 rounded-2xl overflow-hidden border-2 border-slate-200 shadow-md bg-slate-100 group-hover:scale-105 transition-transform duration-300 dark:border-slate-700 dark:bg-slate-800">
            {icon ? (
              <img src={icon} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
            )}
          </div>

          <div className="mt-4 text-center w-full px-2">
            {opggUrl ? (
              <a
                href={opggUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex max-w-full items-center justify-center gap-1 text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
                title="View on OP.GG"
              >
                <FitText
                  text={displayRiotId(card.player)}
                  className="block max-w-full whitespace-nowrap font-bold"
                  minScale={0.65}
                />
              </a>
            ) : (
              <FitText
                text={displayRiotId(card.player)}
                className="block max-w-full whitespace-nowrap font-bold text-slate-900 dark:text-slate-100"
                minScale={0.65}
              />
            )}
            {card.player.role && (
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-1 dark:text-slate-400">
                {card.player.role}
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-col items-center gap-3 w-full">
            <div className="flex items-center gap-3 bg-slate-50 px-5 py-3 rounded-xl border border-slate-200 w-full justify-center group-hover:bg-slate-100 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-900 dark:group-hover:bg-slate-800">
              {getRankIconSrc(rankData?.tier) && (
                <img src={getRankIconSrc(rankData?.tier)} alt={rankData?.tier || ''} className="h-11 w-11 object-contain" />
              )}
              <div className="flex flex-col items-start">
                <div className="text-2xl font-black text-slate-900 tabular-nums dark:text-slate-100">
                  {rankData?.league_points ?? 0}
                  <span className="text-sm font-bold text-slate-500 ml-1 dark:text-slate-400">LP</span>
                </div>
                {tierDisplay && (
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide dark:text-slate-500">
                    {tierDisplay}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <div
                className={`font-black tabular-nums ${
                  winrate.pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {winrate.pct}%
              </div>
              <div className="text-slate-400 font-medium dark:text-slate-500">{winrate.label}</div>
            </div>
          </div>

          <div className="mt-5 flex gap-2">
            {card.topChamps.slice(0, 3).map((c) => {
              const champ = champMap[c.champion_id]
              if (!champ) return null
              return (
                <img
                  key={c.champion_id}
                  src={championIconUrl(ddVersion, champ.id)}
                  alt={champ.name}
                  className="h-10 w-10 rounded-lg border-2 border-slate-200 shadow-sm hover:scale-125 hover:border-slate-300 transition-all duration-200 hover:z-10 dark:border-slate-700"
                />
              )
            })}
          </div>

          <div className="mt-5 pt-5 border-t border-slate-100 w-full min-h-[52px] flex items-center justify-center dark:border-slate-800">
            <div className="flex gap-2">
              {card.player.twitch_url && (
                <a
                  href={card.player.twitch_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="flex items-center justify-center h-9 w-9 rounded-lg bg-slate-100 text-slate-400 hover:bg-purple-500 hover:text-white hover:scale-110 transition-all duration-200 shadow-sm dark:bg-slate-800 dark:text-slate-400"
                  title="Twitch"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h2.998L22.286 11.143V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                  </svg>
                </a>
              )}
              {card.player.twitter_url && (
                <a
                  href={card.player.twitter_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="flex items-center justify-center h-9 w-9 rounded-lg bg-slate-100 text-slate-400 hover:bg-blue-500 hover:text-white hover:scale-110 transition-all duration-200 shadow-sm dark:bg-slate-800 dark:text-slate-400"
                  title="Twitter"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                  </svg>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const renderRunnerupRow = (card: PlayerCard) => {
    const rankData = card.rankData
    const winrate = formatWinrate(rankData?.wins, rankData?.losses)
    const icon = profileIconUrl(card.stateData?.profile_icon_id, ddVersion)
    const rankIcon = getRankIconSrc(rankData?.tier)
    const opggUrl = getOpggUrl(card.player)
    const tierLabel = formatTierLabel(rankData?.tier, rankData?.rank)

    return (
      <div
        key={card.player.id}
        role="button"
        tabIndex={0}
        onClick={() => handleOpen(card)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleOpen(card)
          }
        }}
        className="group flex items-center gap-3 lg:gap-4 rounded-2xl border border-slate-200 bg-white px-4 lg:px-6 py-4 transition-all hover:border-slate-300 hover:shadow-lg hover:-translate-y-0.5 duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 cursor-pointer"
      >
        <div className="w-8 shrink-0 flex justify-center">
          <span className="text-sm font-black text-slate-400 group-hover:text-slate-600 transition-colors dark:text-slate-500 dark:group-hover:text-slate-300">
            {card.index}
          </span>
        </div>

        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border-2 border-slate-200 shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
            {icon && <img src={icon} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0 flex-1">
            {opggUrl ? (
              <a
                href={opggUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex max-w-full items-center text-slate-900 transition-colors hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
                title="View on OP.GG"
              >
                <FitText text={displayRiotId(card.player)} className="block max-w-full whitespace-nowrap font-bold" minScale={0.65} />
              </a>
            ) : (
              <FitText
                text={displayRiotId(card.player)}
                className="block max-w-full whitespace-nowrap font-bold text-slate-900 group-hover:text-slate-700 transition-colors dark:text-slate-100 dark:group-hover:text-white"
                minScale={0.65}
              />
            )}
            {card.player.role && (
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5 dark:text-slate-500">
                {card.player.role}
              </div>
            )}
          </div>
        </div>

        <div className="hidden md:flex items-center gap-2 lg:gap-3 shrink-0">
          {rankIcon && <img src={rankIcon} alt="" className="h-9 w-9 object-contain drop-shadow-sm shrink-0" />}
          <div className="flex flex-col">
            <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">
              {rankData?.league_points ?? 0} LP
            </span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap dark:text-slate-500">
              {tierLabel}
            </span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-4 lg:gap-6 shrink-0">
          <div className="flex flex-col items-center w-14">
            <span
              className={`text-sm font-black whitespace-nowrap ${
                winrate.pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {winrate.pct}%
            </span>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">Win</span>
          </div>
          <div className="flex flex-col items-center w-14">
            <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">
              {winrate.total}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">Games</span>
          </div>
        </div>

        <div className="hidden sm:flex items-center justify-center gap-1.5 shrink-0 w-[72px]">
          {card.player.twitch_url ? (
            <a
              href={card.player.twitch_url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-100 text-slate-300 hover:bg-purple-50 hover:text-purple-600 hover:scale-110 transition-all duration-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-purple-500/20"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h2.998L22.286 11.143V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
              </svg>
            </a>
          ) : (
            <div className="h-8 w-8" />
          )}
          {card.player.twitter_url ? (
            <a
              href={card.player.twitter_url}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-100 text-slate-300 hover:bg-blue-50 hover:text-blue-500 hover:scale-110 transition-all duration-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-blue-500/20"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
              </svg>
            </a>
          ) : (
            <div className="h-8 w-8" />
          )}
        </div>

        <div className="hidden lg:flex items-center gap-1 shrink-0">
          {[0, 1, 2].map((idx) => {
            const c = card.topChamps[idx]
            const champ = c ? champMap[c.champion_id] : null
            if (champ) {
              return (
                <img
                  key={c.champion_id}
                  src={championIconUrl(ddVersion, champ.id)}
                  className="h-8 w-8 rounded-lg border-2 border-slate-200 shadow-sm hover:scale-110 hover:border-slate-300 transition-all duration-200 dark:border-slate-700"
                  alt=""
                  title={champ.name}
                />
              )
            }
            return <div key={`empty-${idx}`} className="h-8 w-8" />
          })}
        </div>
      </div>
    )
  }

  const renderMatchRow = (match: MatchSummary) => {
    const champion = champMap[match.championId]
    const champSrc = champion ? championIconUrl(ddVersion, champion.id) : null
    const durationLabel = formatMatchDuration(match.durationS ?? 0)
    const kdaValue = match.d > 0 ? (match.k + match.a) / match.d : 99
    const kdaLabel = match.d === 0 ? 'Perfect' : kdaValue.toFixed(1)
    const kdaColor = match.d === 0 ? 'text-amber-600 font-bold' : getKdaColor(kdaValue)
    const resultLabel = match.win ? 'Victory' : 'Defeat'
    const resultColor = match.win ? 'text-emerald-500' : 'text-rose-500'
    const when = match.endTs ? timeAgo(match.endTs) : '—'
    const queueLabel = match.queueId ? QUEUE_LABELS[match.queueId] ?? 'Custom' : 'Custom'
    const csPerMin = formatCsPerMin(match.cs, match.durationS)
    const detail = matchDetails[match.matchId] ?? matchDetailCache.get(match.matchId) ?? null
    const participant = detail?.info.participants.find((p) => p.puuid === match.puuid)

    const runePrimary = participant?.perks?.styles?.[0]
    const runeSecondary = participant?.perks?.styles?.[1]
    const keystone = runePrimary?.selections?.[0]?.perk ? runeMap.get(runePrimary.selections[0].perk) : null
    const secondaryStyle = runeSecondary?.style ? runeMap.get(runeSecondary.style) : null

    const spell1 = participant ? spellMap.get(participant.summoner1Id) : null
    const spell2 = participant ? spellMap.get(participant.summoner2Id) : null

    const items = participant
      ? [participant.item0, participant.item1, participant.item2, participant.item3, participant.item4, participant.item5, participant.item6]
      : []

    const isExpanded = expandedMatchId === match.matchId

    const rowBg = match.win ? 'bg-emerald-50/80 dark:bg-emerald-500/10' : 'bg-rose-50/80 dark:bg-rose-500/10'
    const rowBorder = match.win ? 'border-emerald-200/80 dark:border-emerald-500/30' : 'border-rose-200/80 dark:border-rose-500/30'
    const rowAccent = match.win ? 'border-emerald-400' : 'border-rose-400'

    return (
      <div key={match.matchId} className={`rounded-2xl border ${rowBorder} ${rowBg} shadow-sm`}>
        <button
          type="button"
          onClick={() => {
            if (!isExpanded) ensureMatchDetail(match.matchId)
            setExpandedMatchId(isExpanded ? null : match.matchId)
          }}
          className="w-full px-4 py-3 text-left transition hover:bg-white/60 dark:hover:bg-slate-900/40"
        >
          <div className={`flex items-center gap-3 text-xs text-slate-500 ${rowAccent} border-l-4 pl-3 min-w-0`}>
            <div className="flex flex-col w-[140px] shrink-0">
              <span className={`text-sm font-bold ${resultColor}`}>{resultLabel}</span>
              <span className="text-[11px] font-semibold text-slate-400">{queueLabel}</span>
              <span className="text-[11px] text-slate-400">
                {when} • {durationLabel}
              </span>
            </div>

            <div className="flex items-center gap-2 w-[160px] shrink-0">
              {champSrc ? (
                <div className="relative">
                  <img
                    src={champSrc}
                    alt=""
                    className="h-11 w-11 rounded-lg border-2 border-slate-200 shadow-sm dark:border-slate-700"
                  />
                  <span className="absolute -bottom-2 -right-2 rounded-full bg-slate-900 px-1.5 text-[10px] font-bold text-white shadow dark:bg-slate-100 dark:text-slate-900">
                    {participant?.champLevel ?? '—'}
                  </span>
                </div>
              ) : (
                <div className="h-11 w-11 rounded-lg bg-slate-200 dark:bg-slate-800" />
              )}
              <div className="min-w-0">
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap truncate">
                  {champion?.name ?? 'Unknown'}
                </div>
                <div className={`text-[11px] font-semibold ${kdaColor} whitespace-nowrap`}>
                  {match.k}/{match.d}/{match.a} • {kdaLabel} KDA
                </div>
              </div>
            </div>

            <div className="flex flex-col w-[120px] shrink-0">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">{match.cs} CS</span>
              <span className="text-[11px] text-slate-400 font-semibold whitespace-nowrap">{csPerMin}/m</span>
            </div>

            <div className="flex items-center gap-1 w-[80px] shrink-0">
              {[spell1, spell2].map((spell, idx) => {
                const icon = buildSpellIconUrl(ddVersion, spell)
                return icon ? (
                  <img
                    key={`${match.matchId}-spell-${idx}`}
                    src={icon}
                    alt=""
                    className="h-6 w-6 rounded-md border border-slate-200 dark:border-slate-700"
                  />
                ) : (
                  <div key={`${match.matchId}-spell-${idx}`} className="h-6 w-6 rounded-md bg-slate-200 dark:bg-slate-800" />
                )
              })}
            </div>

            <div className="flex items-center gap-1 w-[70px] shrink-0">
              {[keystone, secondaryStyle].map((rune, idx) => {
                const icon = buildRuneIconUrl(rune?.icon)
                return icon ? (
                  <img
                    key={`${match.matchId}-rune-${idx}`}
                    src={icon}
                    alt=""
                    className="h-6 w-6 rounded-full bg-slate-100 dark:bg-slate-800"
                  />
                ) : (
                  <div key={`${match.matchId}-rune-${idx}`} className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-800" />
                )
              })}
            </div>

            <div className="flex flex-1 items-center justify-end gap-1 min-w-0">
              {items.length > 0
                ? items.map((itemId, idx) => {
                    const icon = buildItemIconUrl(ddVersion, itemId)
                    return icon ? (
                      <img
                        key={`${match.matchId}-item-${idx}`}
                        src={icon}
                        alt=""
                        className="h-7 w-7 rounded-md border border-slate-200 dark:border-slate-700"
                      />
                    ) : (
                      <div
                        key={`${match.matchId}-item-${idx}`}
                        className="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-800"
                      />
                    )
                  })
                : Array.from({ length: 7 }).map((_, idx) => (
                    <div key={`${match.matchId}-item-empty-${idx}`} className="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-800" />
                  ))}
            </div>

            <div className="ml-2 text-slate-400">
              <svg className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>
        </button>

        {isExpanded && (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
            {!detail ? (
              <MatchDetailSkeleton />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  {[100, 200].map((teamId) => {
                    const team = detail.info.teams.find((t) => t.teamId === teamId)
                    const teamParticipants = detail.info.participants.filter((p) => p.teamId === teamId)
                    const teamLabel = teamId === 100 ? 'Blue Team' : 'Red Team'
                    return (
                      <div key={teamId} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">{teamLabel}</span>
                          <span className={`text-xs font-semibold ${team?.win ? 'text-emerald-500' : 'text-rose-500'}`}>
                            {team?.win ? 'Victory' : 'Defeat'}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {teamParticipants.map((participant) => {
                            const champ = champMap[participant.championId]
                            const champIcon = champ ? championIconUrl(ddVersion, champ.id) : null
                            const cs = (participant.totalMinionsKilled ?? 0) + (participant.neutralMinionsKilled ?? 0)
                            const items = [
                              participant.item0,
                              participant.item1,
                              participant.item2,
                              participant.item3,
                              participant.item4,
                              participant.item5,
                              participant.item6,
                            ]
                            const name = participant.riotIdGameName
                              ? `${participant.riotIdGameName}#${participant.riotIdTagline}`
                              : participant.summonerName

                            return (
                              <div key={participant.puuid} className="flex items-center gap-2 text-xs">
                                {champIcon ? (
                                  <img
                                    src={champIcon}
                                    alt=""
                                    className="h-7 w-7 rounded-md border border-slate-200 dark:border-slate-700"
                                  />
                                ) : (
                                  <div className="h-7 w-7 rounded-md bg-slate-200 dark:bg-slate-800" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{name}</div>
                                  <div className="text-[11px] text-slate-400">
                                    {participant.kills}/{participant.deaths}/{participant.assists} • {cs} CS
                                  </div>
                                </div>
                                <div className="flex items-center gap-1">
                                  {items.map((itemId, idx) => {
                                    const icon = buildItemIconUrl(ddVersion, itemId)
                                    return icon ? (
                                      <img
                                        key={`${participant.puuid}-${idx}`}
                                        src={icon}
                                        alt=""
                                        className="h-6 w-6 rounded border border-slate-200 dark:border-slate-700"
                                      />
                                    ) : (
                                      <div key={`${participant.puuid}-${idx}`} className="h-6 w-6 rounded bg-slate-200 dark:bg-slate-800" />
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {detail.info.teams?.some((team) => team.objectives) && (
                  <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Team Analysis</div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      {[100, 200].map((teamId) => {
                        const team = detail.info.teams.find((t) => t.teamId === teamId)
                        if (!team?.objectives) return null
                        const objectives = team.objectives
                        return (
                          <div key={teamId} className="flex flex-wrap gap-3 text-xs text-slate-600 dark:text-slate-300">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {teamId === 100 ? 'Blue' : 'Red'}
                            </span>
                            {objectives.tower && <span>Towers {objectives.tower.kills}</span>}
                            {objectives.dragon && <span>Dragons {objectives.dragon.kills}</span>}
                            {objectives.baron && <span>Barons {objectives.baron.kills}</span>}
                            {objectives.riftHerald && <span>Heralds {objectives.riftHerald.kills}</span>}
                            {objectives.inhibitor && <span>Inhibitors {objectives.inhibitor.kills}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {top3.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Top Players</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-end">
            {top3.map((card, idx) => {
              const actualRank = idx + 1
              let orderClass = ''
              if (actualRank === 1) orderClass = 'sm:order-2'
              if (actualRank === 2) orderClass = 'sm:order-1'
              if (actualRank === 3) orderClass = 'sm:order-3'
              return (
                <div key={card.player.id} className={orderClass}>
                  {renderPodiumCard(card, actualRank)}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-1 w-6 bg-gradient-to-r from-slate-400 to-slate-600 rounded-full" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Runnerups</h2>
          </div>
          {rest.map((card) => renderRunnerupRow(card))}
        </div>
      )}

      {!hasPlayers && (
        <div className="text-center py-16 bg-gradient-to-br from-slate-50 to-white rounded-3xl border-2 border-dashed border-slate-200 dark:from-slate-950 dark:to-slate-900 dark:border-slate-700">
          <svg className="w-16 h-16 mx-auto text-slate-300 mb-4 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          <p className="text-base font-bold text-slate-500 dark:text-slate-300">No players found</p>
          <p className="text-sm text-slate-400 mt-1 dark:text-slate-500">Add players to get started</p>
        </div>
      )}

      {open && selectedPlayer
        ? createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
              onClick={handleClose}
              aria-hidden="true"
            >
              <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                className="flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      {loadingSummary ? (
                        <HeaderSkeleton />
                      ) : (
                        <>
                          <div className="h-14 w-14 overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-100 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                            {summary?.profileIconId ? (
                              <img
                                src={profileIconUrl(summary.profileIconId, ddVersion) ?? ''}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                {displayRiotId(selectedPlayer.player)}
                              </h3>
                              {selectedPlayer.player.role && (
                                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                                  {selectedPlayer.player.role}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {summary?.rank ? (
                                <span>
                                  {summary.rank.tier ?? 'Unranked'} {summary.rank.rank ?? ''} • {summary.rank.league_points ?? 0}{' '}
                                  LP • {summary.rank.wins ?? 0}W-{summary.rank.losses ?? 0}L
                                </span>
                              ) : (
                                <span>Unranked</span>
                              )}
                            </div>
                            {summary?.lastUpdated && (
                              <div className="mt-1 text-[11px] text-slate-400">
                                Last updated: {timeAgo(new Date(summary.lastUpdated).getTime())}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      ref={closeButtonRef}
                      type="button"
                      aria-label="Close player match history"
                      onClick={handleClose}
                      className="rounded-full border border-slate-200 bg-white p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" />
                      </svg>
                    </button>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold">
                    {(['matches', 'stats', 'champions'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`rounded-full px-4 py-2 transition ${
                          activeTab === tab
                            ? 'bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900'
                            : 'border border-slate-200 bg-white text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'
                        }`}
                      >
                        {tab === 'matches' ? 'Matches' : tab === 'stats' ? 'Stats' : 'Champions'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-hidden">
                  {activeTab === 'matches' && (
                    <div className="h-full overflow-y-auto px-6 py-5 space-y-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                      {loadingMatches ? (
                        <MatchDetailSkeleton />
                      ) : matches.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                          No matches available.
                        </div>
                      ) : (
                        matches.map((match) => renderMatchRow(match))
                      )}
                    </div>
                  )}

                  {activeTab !== 'matches' && (
                    <div className="flex h-full items-center justify-center px-6 py-8 text-sm text-slate-500 dark:text-slate-300">
                      {activeTab === 'stats'
                        ? 'Detailed player stats coming soon.'
                        : 'Champion breakdown coming soon.'}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
