'use client'

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { createPortal } from 'react-dom'
import FitText from './FitText'
import MatchDetailsModal, { preloadStaticData } from './MatchDetailsModal'
import { championIconUrl } from '@/lib/champions'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'

// --- Types ---
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
  visionScore?: number | null
  // ✅ Added fields to support LP Change & Snapshot Rank
  lpChange?: number | null
  lpNote?: string | null
  rankTier?: string | null
  rankDivision?: string | null
  endType?: 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL'
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
  roleBoundItem?: number
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

// --- Constants & Caches ---
const QUEUE_LABELS: Record<number, string> = {
  420: 'Ranked Solo/Duo', 440: 'Ranked Flex', 400: 'Normal Draft',
  430: 'Normal Blind', 450: 'ARAM',
}

const summaryCache = new Map<string, { value: any; expiresAt: number }>()
const matchesCache = new Map<string, { value: MatchSummary[]; expiresAt: number }>()
const matchDetailCache = new Map<string, { value: MatchDetailResponse; expiresAt: number }>()
const staticCache = new Map<string, { value: StaticDataState; expiresAt: number }>()
const MAX_CACHE_ENTRIES = 50
const CACHE_TTL_MS = {
  summary: 5 * 60 * 1000,
  matches: 5 * 60 * 1000,
  matchDetail: 10 * 60 * 1000,
  static: 24 * 60 * 60 * 1000,
}

function pruneCache<T>(cache: Map<string, { value: T; expiresAt: number }>) {
  const now = Date.now()
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
  if (cache.size <= MAX_CACHE_ENTRIES) return
  const overflow = cache.size - MAX_CACHE_ENTRIES
  const keys = Array.from(cache.keys()).slice(0, overflow)
  keys.forEach((key) => cache.delete(key))
}

function getCacheValue<T>(cache: Map<string, { value: T; expiresAt: number }>, key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return entry.value
}

function setCacheValue<T>(
  cache: Map<string, { value: T; expiresAt: number }>,
  key: string,
  value: T,
  ttlMs: number
) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  pruneCache(cache)
}

// --- Pure Helper Functions ---
const DD_VERSION = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'

function profileIconUrl(profileIconId?: number | null, ddVersion = DD_VERSION) {
  return profileIconId != null ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${profileIconId}.png` : null
}

function displayRiotId(p: Player) {
  const gn = (p.game_name ?? '').trim()
  const tl = (p.tag_line ?? '').trim()
  return gn && tl ? `${gn} #${tl}` : p.puuid
}

function buildOpggUrl(p: Player) {
  const gn = (p.game_name ?? '').trim()
  const tl = (p.tag_line ?? '').trim()
  if (!gn || !tl) return null
  const encoded = encodeURIComponent(`${gn}-${tl}`)
  return `https://op.gg/lol/summoners/na/${encoded}`
}

function getRankIconSrc(tier?: string | null) {
  return `/images/${tier ? tier.toUpperCase() : 'UNRANKED'}_SMALL.jpg`
}

function formatTierShort(tier?: string | null, division?: string | null) {
  if (!tier) return 'UR'
  const normalizedTier = tier.toUpperCase()
  const tierMap: Record<string, string> = {
    IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
    EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'C',
  }
  const tierShort = tierMap[normalizedTier] ?? normalizedTier[0] ?? 'U'
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(normalizedTier)) return tierShort

  const divisionMap: Record<string, string> = { I: '1', II: '2', III: '3', IV: '4' }
  const normalizedDivision = division?.toUpperCase() ?? ''
  const divisionShort = divisionMap[normalizedDivision] ?? normalizedDivision
  return divisionShort ? `${tierShort}${divisionShort}` : tierShort
}

function formatWinrate(wins?: number | null, losses?: number | null) {
  const w = wins ?? 0, l = losses ?? 0, total = w + l
  if (!total) return { label: '0W - 0L', pct: 0, total: 0 }
  const pct = Math.min(100, Math.max(0, Math.round((w / total) * 100)))
  return { label: `${w}W - ${l}L`, pct, total }
}

function formatPercent(value: number, total: number, digits = 0) {
  if (!total) return '0'
  const pct = (value / total) * 100
  return pct.toFixed(digits)
}

function buildSpellIconUrl(version: string, spell: any) {
  return spell?.image?.full ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/spell/${spell.image.full}` : null
}

function buildRuneIconUrl(icon?: string | null) {
  return icon ? `https://ddragon.leagueoflegends.com/cdn/img/${icon}` : null
}

function buildItemIconUrl(version: string, id: number) {
  return id ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${id}.png` : null
}

function formatCsPerMin(cs: number, durationS?: number | null) {
  return durationS ? (cs / (durationS / 60)).toFixed(1) : '0.0'
}

function formatHoursMinutes(totalSeconds: number) {
  const totalMinutes = Math.max(0, Math.floor(totalSeconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function buildSpellMap(spells: Record<string, any>) {
  const map = new Map<number, any>()
  if (!spells) return map;
  for (const spell of Object.values(spells)) {
    const key = Number(spell.key)
    if (Number.isFinite(key)) map.set(key, spell)
  }
  return map
}

function buildRuneMap(runes: Array<any>) {
  const map = new Map<number, any>()
  if (!runes) return map;
  for (const style of runes) {
    map.set(style.id, style)
    if (style.slots) {
      for (const slot of style.slots) {
        if (slot.runes) {
          for (const rune of slot.runes) {
            map.set(rune.id, rune)
          }
        }
      }
    }
  }
  return map
}

// --- Hooks ---
function useStaticData(ddVersion: string, active: boolean) {
  const [data, setData] = useState<StaticDataState>(() => {
    return getCacheValue(staticCache, ddVersion) ?? { spells: {}, runes: [] }
  })

  useEffect(() => {
    if (!active || getCacheValue(staticCache, ddVersion)) return

    let mounted = true
    Promise.all([
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/summoner.json`).then(r => r.json()),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${ddVersion}/data/en_US/runesReforged.json`).then(r => r.json()),
    ])
      .then(([spellsData, runes]) => {
        const payload = { spells: spellsData.data, runes }
        setCacheValue(staticCache, ddVersion, payload, CACHE_TTL_MS.static)
        if (mounted) setData(payload)
      })
      .catch(() => mounted && setData({ spells: {}, runes: [] }))

    return () => { mounted = false }
  }, [ddVersion, active])

  return data
}

// --- Sub-Components ---
const MatchDetailSkeleton = memo(() => (
  <div className="space-y-3">
    {[0, 1, 2, 3].map(row => (
      <div key={row} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 shadow-sm animate-pulse dark:border-slate-800 dark:bg-slate-900">
        <div className="h-10 w-10 rounded-lg bg-slate-200 dark:bg-slate-700" />
        <div className="h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="ml-auto h-4 w-28 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    ))}
  </div>
))
MatchDetailSkeleton.displayName = 'MatchDetailSkeleton'

const StatGridSkeleton = memo(() => (
  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {Array.from({ length: 4 }).map((_, idx) => (
      <div key={idx} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm animate-pulse dark:border-slate-800 dark:bg-slate-900">
        <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-3 h-6 w-16 rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    ))}
  </div>
))
StatGridSkeleton.displayName = 'StatGridSkeleton'

const PodiumCard = memo(({ card, rank, ddVersion, onOpen, champMap }: { card: PlayerCard, rank: number, ddVersion: string, onOpen: (c: PlayerCard) => void, champMap: any }) => {
  const rankData = card.rankData
  const winrate = useMemo(() => formatWinrate(rankData?.wins, rankData?.losses), [rankData?.wins, rankData?.losses])
  const icon = useMemo(() => profileIconUrl(card.stateData?.profile_icon_id, ddVersion), [card.stateData?.profile_icon_id, ddVersion])
  const displayId = useMemo(() => displayRiotId(card.player), [card.player])
  
  const styles = useMemo(() => {
    if (rank === 1) return {
      cardBg: 'bg-white dark:bg-slate-900', accentColor: 'from-yellow-400 via-yellow-500 to-amber-600',
      rankBg: 'bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-600', rankText: 'text-white',
      hoverEffect: 'hover:shadow-2xl hover:-translate-y-2', sizeClass: 'scale-110',
      glowEffect: 'shadow-2xl shadow-yellow-500/25 ring-2 ring-yellow-400/30'
    }
    if (rank === 2) return {
      cardBg: 'bg-white dark:bg-slate-900', accentColor: 'from-slate-300 via-slate-400 to-slate-500',
      rankBg: 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500', rankText: 'text-white',
      hoverEffect: 'hover:shadow-xl hover:-translate-y-1', sizeClass: 'scale-100', glowEffect: ''
    }
    if (rank === 3) return {
      cardBg: 'bg-white dark:bg-slate-900', accentColor: 'from-orange-400 via-amber-600 to-orange-700',
      rankBg: 'bg-gradient-to-r from-orange-400 via-amber-600 to-orange-700', rankText: 'text-white',
      hoverEffect: 'hover:shadow-xl hover:-translate-y-1', sizeClass: 'scale-90', glowEffect: ''
    }
    return {
      cardBg: 'bg-white dark:bg-slate-900', accentColor: 'from-slate-400 to-slate-600',
      rankBg: 'bg-slate-600', rankText: 'text-slate-100',
      hoverEffect: 'hover:shadow-xl hover:-translate-y-1', sizeClass: 'scale-90', glowEffect: ''
    }
  }, [rank])

  const isApex = rankData?.tier && ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier)
  const tierDisplay = rankData?.tier && !isApex ? `${rankData.tier} ${rankData.rank || ''}`.trim() : null

  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(card)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen(card)} className={`group relative flex flex-col ${styles.cardBg} rounded-2xl shadow-lg ${styles.hoverEffect} ${styles.sizeClass} ${styles.glowEffect} transition-all duration-300 overflow-hidden border border-slate-200 dark:border-slate-800 cursor-pointer`}>
      <div className={`h-1.5 w-full bg-gradient-to-r ${styles.accentColor}`} />
      <div className="absolute top-3 right-3 z-10">
        <div className={`${styles.rankBg} px-3 py-1.5 rounded-lg shadow-md ${styles.rankText} text-xs font-bold tracking-wide`}>#{rank}</div>
      </div>
      <div className="p-6 flex flex-col items-center">
        <div className="relative h-24 w-24 rounded-2xl overflow-hidden border-2 border-slate-200 shadow-md bg-slate-100 group-hover:scale-105 transition-transform duration-300 dark:border-slate-700 dark:bg-slate-800">
          {icon ? <img loading="lazy" decoding="async" src={icon} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />}
        </div>
        <div className="mt-4 text-center w-full px-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(card)
            }}
            className="inline-flex max-w-full items-center justify-center gap-1 text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
          >
            <FitText text={displayId} className="block max-w-full whitespace-nowrap font-bold" minScale={0.65} />
          </button>
          {card.player.role && <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-1 dark:text-slate-400">{card.player.role}</div>}
        </div>
        <div className="mt-5 flex flex-col items-center gap-3 w-full">
          <div className="flex items-center gap-3 bg-slate-50 px-5 py-3 rounded-xl border border-slate-200 w-full justify-center group-hover:bg-slate-100 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-900 dark:group-hover:bg-slate-800">
             <img loading="lazy" decoding="async" src={getRankIconSrc(rankData?.tier)} alt="" className="h-11 w-11 object-contain" />
             <div className="flex flex-col items-start">
               <div className="text-2xl font-black text-slate-900 tabular-nums dark:text-slate-100">{rankData?.league_points ?? 0}<span className="text-sm font-bold text-slate-500 ml-1 dark:text-slate-400">LP</span></div>
               {tierDisplay && <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide dark:text-slate-500">{tierDisplay}</div>}
             </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <div className={`font-black tabular-nums ${winrate.pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{winrate.pct}%</div>
            <div className="text-slate-400 font-medium dark:text-slate-500">{winrate.label}</div>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          {card.topChamps.slice(0, 3).map(c => {
            // Defensive check: champMap might be undefined or missing key
            const champ = champMap?.[c.champion_id]
            return champ ? <img loading="lazy" decoding="async" key={c.champion_id} src={championIconUrl(ddVersion, champ.id)} alt={champ.name} className="h-10 w-10 rounded-lg border-2 border-slate-200 shadow-sm hover:scale-125 hover:border-slate-300 transition-all duration-200 hover:z-10 dark:border-slate-700" /> : null
          })}
        </div>
      </div>
    </div>
  )
})
PodiumCard.displayName = 'PodiumCard'

const RunnerupRow = memo(({ card, ddVersion, onOpen, champMap }: { card: PlayerCard, ddVersion: string, onOpen: (c: PlayerCard) => void, champMap: any }) => {
  const rankData = card.rankData
  const winrate = useMemo(() => formatWinrate(rankData?.wins, rankData?.losses), [rankData?.wins, rankData?.losses])
  const displayId = useMemo(() => displayRiotId(card.player), [card.player])

  const icon = useMemo(
    () => profileIconUrl(card.stateData?.profile_icon_id, ddVersion),
    [card.stateData?.profile_icon_id, ddVersion]
  )

  const isApex = rankData?.tier && ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(rankData.tier)
  const tierLabel = isApex ? rankData?.tier : `${rankData?.tier || 'Unranked'} ${rankData?.rank || ''}`.trim()

  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(card)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen(card)} className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 transition-all hover:border-slate-300 hover:shadow-xl hover:-translate-y-1 hover:scale-[1.01] duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 dark:focus:ring-offset-slate-900 md:grid md:grid-cols-[2rem_minmax(0,1fr)_160px_120px] md:gap-4 lg:grid-cols-[2rem_minmax(0,1fr)_160px_140px_120px] lg:px-6">
      <div className="w-8 shrink-0 flex justify-center">
        {card.index <= 3 ? (
          <div className={`flex items-center justify-center h-6 w-6 rounded-full ${
            card.index === 1 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-md' :
            card.index === 2 ? 'bg-gradient-to-br from-slate-300 to-slate-500 text-white shadow-md' :
            'bg-gradient-to-br from-amber-600 to-amber-800 text-white shadow-md'
          }`}>
            <span className="text-xs font-black">{card.index}</span>
          </div>
        ) : (
          <span className="text-sm font-black text-slate-400 group-hover:text-slate-600 transition-colors dark:text-slate-500 dark:group-hover:text-slate-300">{card.index}</span>
        )}
      </div>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
          {icon ? (
            <img loading="lazy" decoding="async" src={icon} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen(card)
            }}
            className="inline-flex max-w-full items-center text-slate-900 transition-colors hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
          >
            <FitText text={displayId} className="block max-w-full whitespace-nowrap font-bold" minScale={0.65} />
          </button>
          {card.player.role && <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5 dark:text-slate-500">{card.player.role}</div>}
        </div>
      </div>
      <div className="hidden md:flex items-center gap-2 lg:gap-3 shrink-0">
        <div className="flex h-10 w-10 items-center justify-center shrink-0">
          <img
            loading="lazy"
            decoding="async"
            src={getRankIconSrc(rankData?.tier)}
            alt=""
            className="block h-10 w-10 object-contain drop-shadow-sm"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">{rankData?.league_points ?? 0} LP</span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap dark:text-slate-500">{tierLabel}</span>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-4 lg:gap-6 shrink-0">
        <div className="flex flex-col items-center w-14">
          <span className={`text-sm font-black whitespace-nowrap ${winrate.pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>{winrate.pct}%</span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">Win</span>
        </div>
        <div className="flex flex-col items-center w-14">
          <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">{winrate.total}</span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">Games</span>
        </div>
      </div>
      <div className="hidden lg:flex items-center gap-1 shrink-0">
        {[0, 1, 2].map(idx => {
          // Defensive check
          const c = card.topChamps[idx], champ = c && champMap ? champMap[c.champion_id] : null
          return champ ? <img loading="lazy" decoding="async" key={c.champion_id} src={championIconUrl(ddVersion, champ.id)} className="h-8 w-8 rounded-lg border-2 border-slate-200 shadow-sm hover:scale-110 hover:border-slate-300 transition-all duration-200 dark:border-slate-700" alt="" title={champ.name} /> : <div key={`empty-${idx}`} className="h-8 w-8" />
        })}
      </div>
    </div>
  )
})
RunnerupRow.displayName = 'RunnerupRow'

const MatchRow = memo(({ match, champMap, ddVersion, detail, onOpen, onHover, spellMap, runeMap, currentRankData, focusedPuuid }: { match: MatchSummary, champMap: any, ddVersion: string, detail: MatchDetailResponse | null, onOpen: (match: MatchSummary) => void, onHover: (match: MatchSummary) => void, spellMap: Map<number, any>, runeMap: Map<number, any>, currentRankData?: any, focusedPuuid?: string | null }) => {
    // 5. Defensive Checks: Guard against undefined maps
    const champion = champMap?.[match.championId]
    const champSrc = champion ? championIconUrl(ddVersion, champion.id) : null
    const durationLabel = formatMatchDuration(match.durationS ?? 0)
    const kdaValue = match.d > 0 ? (match.k + match.a) / match.d : 99
    const kdaLabel = match.d === 0 ? 'Perfect' : kdaValue.toFixed(1)
    const kdaColor = match.d === 0 ? 'text-amber-600 font-bold' : getKdaColor(kdaValue)
    
    // Handle Remake logic
    const isRemake = match.endType === 'REMAKE'
    const resultLabel = isRemake ? 'Remake' : (match.win ? 'Victory' : 'Defeat')
    const resultColor = isRemake ? 'text-slate-500' : (match.win ? 'text-emerald-500' : 'text-rose-500')
    const rowAccent = isRemake ? 'border-slate-300' : (match.win ? 'border-emerald-400' : 'border-rose-400')
    const rowBg = isRemake ? 'bg-slate-50/80 dark:bg-slate-500/10' : (match.win ? 'bg-emerald-50/80 dark:bg-emerald-500/10' : 'bg-rose-50/80 dark:bg-rose-500/10')
    const rowBorder = isRemake ? 'border-slate-200/80 dark:border-slate-500/30' : (match.win ? 'border-emerald-200/80 dark:border-emerald-500/30' : 'border-rose-200/80 dark:border-rose-500/30')

    const when = match.endTs ? timeAgo(match.endTs) : '—'
    const queueLabel = match.queueId ? QUEUE_LABELS[match.queueId] ?? 'Custom' : 'Custom'
    const csPerMin = formatCsPerMin(match.cs, match.durationS)
    const targetPuuid = focusedPuuid ?? match.puuid
    const participants = detail?.info.participants ?? []
    const participantByPuuid =
      participants.find((p) => p.puuid === targetPuuid) ??
      (targetPuuid !== match.puuid
        ? participants.find((p) => p.puuid === match.puuid)
        : undefined)

    // If PUUID matching fails (stale migrated IDs), recover row assets by strict stat signature.
    // This keeps spells/runes/items rendering even when historical participant PUUID differs.
    const participantByStats = !participantByPuuid
      ? participants.find((p) => {
          const participantCs = Number(p.totalMinionsKilled ?? 0) + Number(p.neutralMinionsKilled ?? 0)
          return (
            Number(p.championId ?? 0) === Number(match.championId ?? 0) &&
            Number(p.kills ?? 0) === Number(match.k ?? 0) &&
            Number(p.deaths ?? 0) === Number(match.d ?? 0) &&
            Number(p.assists ?? 0) === Number(match.a ?? 0) &&
            participantCs === Number(match.cs ?? 0)
          )
        })
      : undefined

    const participant = participantByPuuid ?? participantByStats
  
    const runePrimary = participant?.perks?.styles?.[0]
    const runeSecondary = participant?.perks?.styles?.[1]
    const keystone = runePrimary?.selections?.[0]?.perk ? runeMap?.get(runePrimary.selections[0].perk) : null
    const secondaryStyle = runeSecondary?.style ? runeMap?.get(runeSecondary.style) : null
    const spell1 = participant ? spellMap?.get(participant.summoner1Id) : null
    const spell2 = participant ? spellMap?.get(participant.summoner2Id) : null
    const items = participant ? [participant.item0, participant.item1, participant.item2, participant.item3, participant.item4, participant.item5, participant.item6, participant.roleBoundItem ?? 0] : []
    const imageIssueReason = !detail
      ? 'Waiting for match detail data'
      : !participant
        ? 'Player PUUID not found in match participants'
        : null
    const killParticipationPct = useMemo(() => {
      if (!detail?.info?.participants?.length) return null
      const teamId = participant?.teamId
      if (!teamId) return null
      const teamKills = detail.info.participants
        .filter(p => p.teamId === teamId)
        .reduce((sum, p) => sum + (p.kills ?? 0), 0)
      if (!teamKills) return null
      return Math.round(((match.k + match.a) / teamKills) * 100)
    }, [detail?.info?.participants, participant?.teamId, match.k, match.a])
  
    // Rank Fallback Data: Prioritize match snapshot, fallback to current rank
    const tier = match.rankTier ?? currentRankData?.tier
    const division = match.rankDivision ?? currentRankData?.rank
    const rankIcon = tier ? getRankIconSrc(tier) : null
    const rankLabel = tier ? formatTierShort(tier, division) : null

    return (
      <div className={`rounded-2xl border ${rowBorder} ${rowBg} shadow-sm`}>
        <button type="button" onClick={() => onOpen(match)} onMouseEnter={() => onHover(match)} className="w-full px-4 py-2 text-left transition hover:bg-white/60 dark:hover:bg-slate-900/40">
          <div className={`flex items-center gap-3 text-xs text-slate-500 ${rowAccent} border-l-4 pl-3 min-w-0`}>
            
            {/* --- COLUMN 1: Result, Duration, LP, Queue, Time --- */}
            <div className="flex flex-col w-[130px] shrink-0 leading-tight gap-0.5">
              {/* Row 1: Result + Duration */}
              <div className="flex items-baseline gap-1.5">
                <span className={`text-[12px] font-black uppercase tracking-wide ${resultColor}`}>{resultLabel}</span>
                <span className="text-[10px] text-slate-400 font-medium">{durationLabel}</span>
              </div>

              {/* Row 2: LP Change / Note */}
              <div className="h-4 flex items-center">
                {match.lpChange !== undefined && match.lpChange !== null ? (
                  match.lpNote ? (
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                        match.lpNote === 'PROMOTED' 
                        ? 'text-emerald-700 bg-emerald-100/50 dark:text-emerald-200 dark:bg-emerald-500/20' 
                        : 'text-rose-700 bg-rose-100/50 dark:text-rose-200 dark:bg-rose-500/20'
                    }`}>
                      {match.lpNote}
                    </span>
                  ) : (
                    <span className={`text-[11px] font-bold ${match.lpChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                        {match.lpChange > 0 ? '▲' : '▼'} {Math.abs(match.lpChange)} LP
                    </span>
                  )
                ) : (
                  // Fallback: Show snapshot rank or current rank if LP data missing
                  rankLabel && !isRemake ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700/50 dark:text-slate-300">
                      {rankIcon && <img src={rankIcon} alt="" className="h-3 w-3 object-contain" loading="lazy" />}
                      {rankLabel} <span className="text-[9px] opacity-70">(N/A)</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-300 dark:text-slate-600 font-medium opacity-50">— LP</span>
                  )
                )}
              </div>

              {/* Row 3: Queue Type */}
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mt-0.5">{queueLabel}</span>

              {/* Row 4: Time Ago */}
              <span className="text-[10px] text-slate-400">{when}</span>
            </div>

            <div className="flex items-center gap-3 w-[190px] shrink-0">
              {champSrc ? (
                <div className="relative">
                  <img loading="lazy" decoding="async" src={champSrc} alt="" className="h-[50px] w-[50px] rounded-lg border-2 border-slate-200 shadow-sm dark:border-slate-700" />
                  <span className="absolute -bottom-2 -right-2 rounded-full bg-slate-900 px-1.5 text-[10px] font-bold text-white shadow dark:bg-slate-100 dark:text-slate-900">{participant?.champLevel ?? '—'}</span>
                </div>
              ) : <div className="h-[50px] w-[50px] rounded-lg bg-slate-200 dark:bg-slate-800" />}
              <div className="mt-1 grid grid-cols-[24px_24px] grid-rows-2 gap-1">
                {spell1 ? (
                  <img loading="lazy" decoding="async" src={buildSpellIconUrl(ddVersion, spell1) ?? ''} alt="" className="h-6 w-6 rounded-md border border-slate-200 dark:border-slate-700" />
                ) : (
                  <div className="h-6 w-6 rounded-md bg-slate-200 dark:bg-slate-800" />
                )}
                {keystone ? (
                  <img loading="lazy" decoding="async" src={buildRuneIconUrl(keystone.icon) ?? ''} alt="" className="h-6 w-6 rounded-full bg-slate-100 dark:bg-slate-800" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-800" />
                )}
                {spell2 ? (
                  <img loading="lazy" decoding="async" src={buildSpellIconUrl(ddVersion, spell2) ?? ''} alt="" className="h-6 w-6 rounded-md border border-slate-200 dark:border-slate-700" />
                ) : (
                  <div className="h-6 w-6 rounded-md bg-slate-200 dark:bg-slate-800" />
                )}
                {secondaryStyle ? (
                  <img loading="lazy" decoding="async" src={buildRuneIconUrl(secondaryStyle.icon) ?? ''} alt="" className="h-6 w-6 rounded-full bg-slate-100 dark:bg-slate-800" />
                ) : (
                  <div className="h-6 w-6 rounded-full bg-slate-200 dark:bg-slate-800" />
                )}
              </div>
            </div>
            <div className="flex flex-col w-[150px] shrink-0 leading-tight">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                {match.k} / {match.d} / {match.a}
              </span>
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {kdaLabel === 'Perfect' ? 'Perfect' : `${kdaLabel} KDA`}
              </span>
            </div>
            <div className="flex flex-col w-[150px] shrink-0 border-l border-slate-200 pl-3 leading-tight dark:border-slate-800">
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {killParticipationPct !== null ? `${killParticipationPct}% KP` : '—'}
              </span>
              <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">{match.cs} CS</span>
            </div>
            <div className="grid grid-cols-8 gap-2 ml-auto min-w-0">
              {items.length > 0 ? items.map((itemId, idx) => {
                  const icon = buildItemIconUrl(ddVersion, itemId)
                  return (
                    <div key={idx} className="h-9 w-9 rounded-md border border-slate-200 bg-slate-100 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                      {icon ? (
                        <img loading="lazy" decoding="async" src={icon} alt="" className="h-full w-full rounded-md object-cover" style={{ aspectRatio: '1 / 1' }} />
                      ) : null}
                    </div>
                  )
                }) : Array.from({ length: 8 }).map((_, idx) => (
                  <div key={`e-${idx}`} className="h-9 w-9 rounded-md border border-slate-200 bg-slate-100 shadow-sm dark:border-slate-700 dark:bg-slate-800" style={{ aspectRatio: '1 / 1' }} />
                ))}
            </div>
            {imageIssueReason && (
              <div
                className="ml-2 inline-flex max-w-[220px] shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                title={imageIssueReason}
              >
                <span aria-hidden="true">⚠</span>
                <span className="truncate">{`No images: ${imageIssueReason}`}</span>
              </div>
            )}
            <div className="ml-2 text-slate-400">
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
            </div>
          </div>
        </button>
      </div>
    )
  }, (prev, next) => prev.match === next.match && prev.detail === next.detail)
  MatchRow.displayName = 'MatchRow'

// --- Main Component ---
export default function PlayerMatchHistoryClient({ playerCards, champMap, ddVersion }: { playerCards: PlayerCard[], champMap: any, ddVersion: string }) {
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerCard | null>(null)
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<any>(null)
  const [matches, setMatches] = useState<MatchSummary[]>([])
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [activeTab, setActiveTab] = useState<'matches' | 'stats' | 'champions'>('matches')
  const [selectedMatch, setSelectedMatch] = useState<MatchSummary | null>(null)
  const [matchDetails, setMatchDetails] = useState<Record<string, MatchDetailResponse>>({})
  const [visibleMatchesCount, setVisibleMatchesCount] = useState(10)
  const [imagesReady, setImagesReady] = useState(true)
  const initialImagesReady = useRef(false)
  const preloadIdRef = useRef(0)
  const imagesTimeoutRef = useRef<number | null>(null)
  const [isCompact, setIsCompact] = useState(false)
  
  const modalRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const fetchingMatches = useRef(new Set<string>())

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => {
      setIsCompact(window.matchMedia('(min-width: 1024px) and (max-width: 1400px)').matches)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const { top3, rest } = useMemo(() => ({ top3: playerCards.slice(0, 3), rest: playerCards.slice(3) }), [playerCards])

  const staticData = useStaticData(ddVersion, open)
  const spellMap = useMemo(() => buildSpellMap(staticData.spells), [staticData.spells])
  const runeMap = useMemo(() => buildRuneMap(staticData.runes), [staticData.runes])

  const playerMatches = useMemo(() => matches, [matches])

  const prefetchMatchIds = useMemo(
    () => matches.slice(0, visibleMatchesCount).map((match) => match.matchId),
    [matches, visibleMatchesCount]
  )

  const statsSnapshot = useMemo(() => {
    if (!playerMatches.length) return null
    const totals = playerMatches.reduce(
      (acc, match) => {
        acc.games += 1
        acc.wins += match.win ? 1 : 0
        acc.kills += match.k
        acc.deaths += match.d
        acc.assists += match.a
        acc.cs += match.cs
        acc.durationS += match.durationS ?? 0
        acc.vision += match.visionScore ?? 0
        if (match.durationS && match.durationS > acc.longestGameS) {
          acc.longestGameS = match.durationS
          acc.longestGameChampionId = match.championId
        }
        if (match.k > acc.maxKills.value) acc.maxKills = { value: match.k, championId: match.championId }
        if (match.d > acc.maxDeaths.value) acc.maxDeaths = { value: match.d, championId: match.championId }
        if (match.a > acc.maxAssists.value) acc.maxAssists = { value: match.a, championId: match.championId }
        if (match.cs > acc.maxCs.value) acc.maxCs = { value: match.cs, championId: match.championId }
        if ((match.visionScore ?? 0) > acc.maxVision.value) {
          acc.maxVision = { value: match.visionScore ?? 0, championId: match.championId }
        }
        return acc
      },
      {
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
        durationS: 0,
        vision: 0,
        longestGameS: 0,
        longestGameChampionId: 0,
        maxKills: { value: 0, championId: 0 },
        maxDeaths: { value: 0, championId: 0 },
        maxAssists: { value: 0, championId: 0 },
        maxCs: { value: 0, championId: 0 },
        maxVision: { value: 0, championId: 0 },
      }
    )

    const losses = totals.games - totals.wins
    const avgKills = totals.kills / totals.games
    const avgDeaths = totals.deaths / totals.games
    const avgAssists = totals.assists / totals.games
    const kdaRatio = (totals.kills + totals.assists) / Math.max(1, totals.deaths)
    const csPerMin = totals.durationS ? totals.cs / (totals.durationS / 60) : 0
    const avgDuration = totals.durationS ? totals.durationS / totals.games : 0

    return {
      games: totals.games,
      wins: totals.wins,
      losses,
      winrate: Number(formatPercent(totals.wins, totals.games, 0)),
      avgKills,
      avgDeaths,
      avgAssists,
      kdaRatio,
      csPerMin,
      avgDuration,
      totalKills: totals.kills,
      totalDeaths: totals.deaths,
      totalAssists: totals.assists,
      totalVision: totals.vision,
      longestGameS: totals.longestGameS,
      longestGameChampionId: totals.longestGameChampionId,
      timePlayedS: totals.durationS,
      maxKills: totals.maxKills,
      maxDeaths: totals.maxDeaths,
      maxAssists: totals.maxAssists,
      maxCs: totals.maxCs,
      maxVision: totals.maxVision,
    }
  }, [playerMatches])

  const championSnapshot = useMemo(() => {
    if (!playerMatches.length) return []
    const map = new Map<number, { championId: number; games: number; wins: number; kills: number; deaths: number; assists: number; cs: number }>()
    for (const match of playerMatches) {
      const entry = map.get(match.championId) ?? {
        championId: match.championId,
        games: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        cs: 0,
      }
      entry.games += 1
      entry.wins += match.win ? 1 : 0
      entry.kills += match.k
      entry.deaths += match.d
      entry.assists += match.a
      entry.cs += match.cs
      map.set(match.championId, entry)
    }

    return Array.from(map.values())
      .map((entry) => {
        const champ = champMap?.[entry.championId]
        const winrate = Number(formatPercent(entry.wins, entry.games, 0))
        const kda = (entry.kills + entry.assists) / Math.max(1, entry.deaths)
        return {
          ...entry,
          name: champ?.name ?? `Champion ${entry.championId}`,
          icon: champ ? championIconUrl(ddVersion, champ.id) : null,
          winrate,
          kda,
          avgCs: entry.cs / entry.games,
        }
      })
      .sort((a, b) => b.games - a.games || b.winrate - a.winrate)
  }, [playerMatches, champMap, ddVersion])

  const championTotals = useMemo(() => {
    if (!championSnapshot.length) {
      return {
        totalGames: 0,
        wins: 0,
        losses: 0,
        kda: 0,
        avgCs: 0,
      }
    }

    const totals = championSnapshot.reduce(
      (acc, champ) => {
        acc.totalGames += champ.games
        acc.wins += champ.wins
        acc.kills += champ.kills
        acc.deaths += champ.deaths
        acc.assists += champ.assists
        acc.cs += champ.cs
        return acc
      },
      { totalGames: 0, wins: 0, kills: 0, deaths: 0, assists: 0, cs: 0 }
    )

    return {
      totalGames: totals.totalGames,
      wins: totals.wins,
      losses: Math.max(0, totals.totalGames - totals.wins),
      kda: (totals.kills + totals.assists) / Math.max(1, totals.deaths),
      avgCs: totals.cs / Math.max(1, totals.totalGames),
    }
  }, [championSnapshot])

  const championTotalsMismatch = useMemo(() => {
    if (!playerMatches.length) return false
    const expectedGames = playerMatches.length
    const expectedWins = playerMatches.reduce((acc, match) => acc + (match.win ? 1 : 0), 0)
    const expectedLosses = Math.max(0, expectedGames - expectedWins)
    return championTotals.totalGames !== expectedGames
      || championTotals.wins !== expectedWins
      || championTotals.losses !== expectedLosses
  }, [championTotals, playerMatches])

  const topChampions = useMemo(() => championSnapshot.slice(0, 5), [championSnapshot])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && handleClose()
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open || activeTab !== 'matches') return
    initialImagesReady.current = false
    setImagesReady(false)
  }, [open, activeTab, selectedPlayer])

  useEffect(() => {
    if (!open || activeTab !== 'matches') {
      if (imagesTimeoutRef.current !== null) {
        window.clearTimeout(imagesTimeoutRef.current)
        imagesTimeoutRef.current = null
      }
      return
    }

    if (imagesTimeoutRef.current !== null) {
      window.clearTimeout(imagesTimeoutRef.current)
    }

    imagesTimeoutRef.current = window.setTimeout(() => {
      setImagesReady(true)
      initialImagesReady.current = true
      imagesTimeoutRef.current = null
    }, 3000)

    return () => {
      if (imagesTimeoutRef.current !== null) {
        window.clearTimeout(imagesTimeoutRef.current)
        imagesTimeoutRef.current = null
      }
    }
  }, [open, activeTab, selectedPlayer, loadingMatches])

  useEffect(() => {
    if (!open || activeTab !== 'matches') {
      setImagesReady(true)
      initialImagesReady.current = false
      return
    }

    if (loadingMatches) {
      setImagesReady(false)
      return
    }

    if (initialImagesReady.current) return

    const run = async () => {
      const localId = ++preloadIdRef.current
      setImagesReady(false)

      await new Promise(requestAnimationFrame)

      const container = modalRef.current
      if (!container) {
        if (preloadIdRef.current === localId) setImagesReady(true)
        return
      }

      const srcs = Array.from(container.querySelectorAll('img'))
        .map((img) => img.currentSrc || img.src)
        .filter((src) => !!src)

      const uniqueSrcs = Array.from(new Set(srcs))
      if (uniqueSrcs.length === 0) {
        if (preloadIdRef.current === localId) {
          setImagesReady(true)
          initialImagesReady.current = true
        }
        return
      }

      const preloadPromise = Promise.allSettled(
        uniqueSrcs.map(
          (src) =>
            new Promise<void>((resolve) => {
              const img = new Image()
              img.onload = () => resolve()
              img.onerror = () => resolve()
              img.src = src
            })
        )
      )

      const timeoutPromise = new Promise<void>((resolve) => {
        window.setTimeout(resolve, 3000)
      })

      await Promise.race([preloadPromise, timeoutPromise])

      if (preloadIdRef.current === localId) {
        setImagesReady(true)
        initialImagesReady.current = true
      }
    }

    run()
  }, [open, activeTab, matches, loadingMatches])

  useEffect(() => {
    if (!open || !selectedPlayer) return

    const puuid = selectedPlayer.player.puuid
    setActiveTab('matches')
    setSelectedMatch(null)
    setVisibleMatchesCount(10)

    const cachedSummary = getCacheValue(summaryCache, puuid)
    if (cachedSummary) {
      setSummary(cachedSummary)
    } else {
      setLoadingSummary(true)
      fetch(`/api/player/${puuid}/summary`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
          setCacheValue(summaryCache, puuid, data, CACHE_TTL_MS.summary)
          setSummary(data)
        })
        .catch(() => setSummary(null))
        .finally(() => setLoadingSummary(false))
    }

    // 3. Inefficient Sorting Fix: Use cached if available, otherwise fetch -> sort -> cache
    const cachedMatches = getCacheValue(matchesCache, puuid)
    if (cachedMatches) {
      setMatches(cachedMatches)
    } else {
      setLoadingMatches(true)
      fetch(`/api/player/${puuid}/matches?limit=all`)
        .then(res => res.ok ? res.json() : Promise.reject())
        .then(data => {
          const rawList: any[] = data.matches ?? []
          // MAPPER to handle potential casing differences (lp_change -> lpChange) and missing rank fields
          const list: MatchSummary[] = rawList.map(m => ({
            matchId: m.matchId,
            puuid: m.puuid,
            championId: m.championId,
            win: m.win,
            k: m.k,
            d: m.d,
            a: m.a,
            cs: m.cs,
            endTs: m.endTs,
            durationS: m.durationS,
            queueId: m.queueId,
            visionScore: m.visionScore,
            // Prioritize snake_case from DB if standard API key is missing
            lpChange: m.lpChange ?? m.lp_change ?? null,
            lpNote: m.lpNote ?? m.lp_note ?? null,
            rankTier: m.rankTier ?? m.rank_tier ?? null,
            rankDivision: m.rankDivision ?? m.rank_division ?? null,
            endType: m.endType ?? m.end_type,
          }))

          // Sort ONCE here
          const matchIdToSortKey = (matchId: string) => {
            const [, raw] = matchId.split('_')
            const num = Number(raw)
            return Number.isFinite(num) ? num : 0
          }
          list.sort((a, b) => {
            const aKey = a.endTs ?? matchIdToSortKey(a.matchId)
            const bKey = b.endTs ?? matchIdToSortKey(b.matchId)
            return bKey - aKey
          })
          setCacheValue(matchesCache, puuid, list, CACHE_TTL_MS.matches)
          setMatches(list)
        })
        .catch(() => setMatches([]))
        .finally(() => setLoadingMatches(false))
    }
  }, [open, selectedPlayer])

  const ensureMatchDetail = useCallback(async (matchId: string) => {
    const cachedDetail = getCacheValue(matchDetailCache, matchId)
    if (cachedDetail) {
      setMatchDetails(prev => ({ ...prev, [matchId]: cachedDetail }))
      return
    }
    if (fetchingMatches.current.has(matchId)) return

    fetchingMatches.current.add(matchId)
    try {
      const res = await fetch(`/api/match/${matchId}`)
      if (res.ok) {
        const data = await res.json()
        if (data?.match) {
          setCacheValue(matchDetailCache, matchId, data.match, CACHE_TTL_MS.matchDetail)
          setMatchDetails(prev => ({ ...prev, [matchId]: data.match }))
        }
      }
    } finally {
      fetchingMatches.current.delete(matchId)
    }
  }, [])

  const handleMatchUpdate = useCallback((matchId: string, match: MatchDetailResponse) => {
    setCacheValue(matchDetailCache, matchId, match, CACHE_TTL_MS.matchDetail)
    setMatchDetails(prev => ({ ...prev, [matchId]: match }))
  }, [])

  useEffect(() => {
    if (!open || prefetchMatchIds.length === 0) return

    let cancelled = false
    const cachedDetails: Record<string, MatchDetailResponse> = {}
    const queue: string[] = []
    prefetchMatchIds.forEach((id) => {
      const cached = getCacheValue(matchDetailCache, id)
      if (cached) {
        cachedDetails[id] = cached
      } else {
        queue.push(id)
      }
    })

    if (Object.keys(cachedDetails).length > 0) {
      setMatchDetails((prev) => ({ ...cachedDetails, ...prev }))
    }

    if (!queue.length) return

    const processBatch = async () => {
      while (queue.length && !cancelled) {
        const batch = queue.splice(0, 3)
        await Promise.allSettled(batch.map(async id => {
          if (getCacheValue(matchDetailCache, id) || fetchingMatches.current.has(id)) return
            fetchingMatches.current.add(id)
            try {
              const res = await fetch(`/api/match/${id}`)
              if (res.ok) {
                const data = await res.json()
                if (data?.match) {
                  setCacheValue(matchDetailCache, id, data.match, CACHE_TTL_MS.matchDetail)
                  if (!cancelled) setMatchDetails(prev => ({ ...prev, [id]: data.match }))
                }
              }
          } finally {
            fetchingMatches.current.delete(id)
          }
        }))
        await new Promise(r => setTimeout(r, 500))
      }
    }

    const timer = setTimeout(processBatch, 1000)
    // 1. Critical Race Condition Fix: Clear fetchingMatches set on unmount/re-run
    return () => { 
        cancelled = true; 
        clearTimeout(timer);
        fetchingMatches.current.clear();
    }
  }, [open, prefetchMatchIds])

  const handleOpen = useCallback((card: PlayerCard) => {
    setSelectedPlayer(card)
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setSelectedPlayer(null)
    setSummary(null)
    setMatches([])
    setSelectedMatch(null)
    setVisibleMatchesCount(10)
    // 2. Memory Leak Fix: Clear heavy detail state
    setMatchDetails({})
  }, [])

  const socialLinks = useMemo(() => {
    if (!selectedPlayer) return [] as Array<{ key: string; href: string; label: string }>
    const links: Array<{ key: string; href: string; label: string }> = []
    const twitter = (selectedPlayer.player.twitter_url ?? '').trim()
    const twitch = (selectedPlayer.player.twitch_url ?? '').trim()
    const opgg = buildOpggUrl(selectedPlayer.player)
    if (twitter) links.push({ key: 'x', href: twitter, label: 'X' })
    if (twitch) links.push({ key: 'twitch', href: twitch, label: 'Twitch' })
    if (opgg) links.push({ key: 'opgg', href: opgg, label: 'OP.GG' })
    return links
  }, [selectedPlayer])

  const openMatchWithAutoRepair = useCallback((match: MatchSummary) => {
    const focusedPuuid = selectedPlayer?.player.puuid ?? match.puuid
    setSelectedMatch({
      ...match,
      puuid: focusedPuuid,
    })
    ensureMatchDetail(match.matchId)
  }, [ensureMatchDetail, selectedPlayer])

  const handleMatchHover = useCallback((match: MatchSummary) => {
    preloadStaticData(ddVersion)
    void ensureMatchDetail(match.matchId)
  }, [ddVersion, ensureMatchDetail])

  const handleOpenMatch = useCallback((match: MatchSummary) => {
    console.log('[openMatchModal]', {
      row_puuid: match.puuid,
      row_match_id: match.matchId,
      globalFocusedPuuid: selectedPlayer?.player?.puuid ?? null,
    })
    openMatchWithAutoRepair(match)
  }, [openMatchWithAutoRepair, selectedPlayer])

  const handleCloseMatchModal = useCallback(() => {
    setSelectedMatch(null)
  }, [])

  useEffect(() => {
    if (!open) return
    preloadStaticData(ddVersion)
  }, [open, ddVersion])

  return (
    <>
      {top3.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Top Players</h2>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-6 items-end ${isCompact ? 'max-w-[720px] mx-auto' : ''}`}>
            {top3.map((card, idx) => {
              const actualRank = idx + 1
              const orderClass = actualRank === 1 ? 'sm:order-2' : actualRank === 2 ? 'sm:order-1' : 'sm:order-3'
              return (
                <div key={card.player.id} className={orderClass}>
                  <PodiumCard card={card} rank={actualRank} ddVersion={ddVersion} onOpen={handleOpen} champMap={champMap} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <div className={isCompact ? 'max-w-[720px] mx-auto space-y-3' : 'space-y-3'}>
          <div className="flex items-center gap-2 mb-4 mt-8">
            <div className="h-1 w-6 bg-gradient-to-r from-slate-400 to-slate-600 rounded-full" />
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Runnerups</h2>
          </div>
          {rest.map(card => <RunnerupRow key={card.player.id} card={card} ddVersion={ddVersion} onOpen={handleOpen} champMap={champMap} />)}
        </div>
      )}

      {!playerCards.length && (
        <div className="text-center py-16 bg-gradient-to-br from-slate-50 to-white rounded-3xl border-2 border-dashed border-slate-200 dark:from-slate-950 dark:to-slate-900 dark:border-slate-700">
          <svg className="w-16 h-16 mx-auto text-slate-300 mb-4 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
          <p className="text-base font-bold text-slate-500 dark:text-slate-300">No players found</p>
          <p className="text-sm text-slate-400 mt-1 dark:text-slate-500">Add players to get started</p>
        </div>
      )}

      {open && selectedPlayer && createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4" onClick={handleClose}>
            {/* 4. Backdrop Click Fix: Stop propagation on content click */}
            <div ref={modalRef} role="dialog" aria-modal="true" className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950" onClick={e => e.stopPropagation()}>
              {!imagesReady && activeTab === 'matches' && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 backdrop-blur dark:bg-slate-950/80">
                  <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Loading match images…
                  </div>
                </div>
              )}
              <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    {loadingSummary ? (
                      <div className="flex items-center gap-4 animate-pulse">
                        <div className="h-14 w-14 rounded-2xl bg-slate-200 dark:bg-slate-800" />
                        <div className="space-y-2">
                           <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-800" />
                           <div className="h-3 w-48 rounded bg-slate-200 dark:bg-slate-800" />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="h-20 w-20 overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-100 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          {summary?.profileIconId && <img loading="eager" decoding="async" src={profileIconUrl(summary.profileIconId, ddVersion) ?? ''} alt="" className="h-full w-full object-cover" />}
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="flex items-baseline gap-1.5 text-lg font-semibold text-slate-900 dark:text-slate-100">
                              {selectedPlayer.player.game_name ? (
                                <>
                                  <span className="font-bold">{selectedPlayer.player.game_name}</span>
                                  {selectedPlayer.player.tag_line && (
                                    <span className="text-sm font-medium text-slate-400 dark:text-slate-500">#{selectedPlayer.player.tag_line}</span>
                                  )}
                                </>
                              ) : (
                                <span className="font-bold">{displayRiotId(selectedPlayer.player)}</span>
                              )}
                            </h3>
                            {selectedPlayer.player.role && <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">{selectedPlayer.player.role}</span>}
                            {socialLinks.length > 0 && (
                              <div className="flex flex-wrap items-center gap-2">
                                {socialLinks.map((link) => (
                                  <a
                                    key={link.key}
                                    href={link.href}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={link.label}
                                    className={`inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border transition ${
                                      link.key === 'x'
                                        ? 'border-slate-200 bg-slate-900 text-white hover:border-slate-900/80 hover:bg-slate-900/90 dark:border-slate-700'
                                        : link.key === 'twitch'
                                          ? 'border-purple-200 bg-purple-600 text-white hover:border-purple-500 hover:bg-purple-700 dark:border-purple-500'
                                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:text-white'
                                    }`}
                                  >
                                    {link.key === 'x' && (
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                                        <path d="M18.901 2H22l-6.77 7.743L23.5 22h-6.62l-5.18-6.62L5.5 22H2.4l7.23-8.27L.5 2h6.78l4.69 6.02L18.9 2Zm-1.16 18h1.84L7.38 3.9H5.41l12.33 16.1Z" />
                                      </svg>
                                    )}
                                    {link.key === 'twitch' && (
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                                        <path d="M4 3h17v10.2L15.6 19H12l-3 3H6v-3H2V6l2-3Zm2 2v11h3v2l2-2h4l4-4.1V5H6Zm10 2v5h-2V7h2Zm-4 0v5h-2V7h2Z" />
                                      </svg>
                                    )}
                                    {link.key === 'opgg' && (
                                      <img
                                        src="/images/opgg.png"
                                        alt=""
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    )}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {summary?.rank ? (
                              <span className="inline-flex items-center gap-3">
                                <img loading="eager" decoding="async" src={getRankIconSrc(summary.rank.tier)} alt="" className="h-10 w-10" />
                                <span className="grid grid-cols-[auto_auto] gap-x-6 gap-y-0.5 text-[11px] font-semibold">
                                  <span className="text-slate-700 dark:text-slate-300">
                                    {summary.rank.tier ?? 'Unranked'}
                                    {!['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes((summary.rank.tier ?? '').toUpperCase())
                                      ? ` ${summary.rank.rank ?? ''}`
                                      : ''}
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400">
                                    {summary.rank.wins ?? 0}W {summary.rank.losses ?? 0}L
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400">
                                    {summary.rank.league_points ?? 0} LP
                                  </span>
                                  <span className="text-slate-400 dark:text-slate-500">
                                    {(() => {
                                      const wins = summary.rank.wins ?? 0
                                      const losses = summary.rank.losses ?? 0
                                      const total = wins + losses
                                      const pct = total ? Math.round((wins / total) * 100) : 0
                                      return `${pct}% WR`
                                    })()}
                                  </span>
                                </span>
                              </span>
                            ) : <span>Unranked</span>}
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
                  <div className="flex flex-col items-end gap-2">
                    <button
                      ref={closeButtonRef}
                      type="button"
                      aria-label="Close"
                      onClick={handleClose}
                      className="rounded-full border border-slate-200 bg-white p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                    </button>
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold">
                  {(['matches', 'stats', 'champions'] as const).map(tab => (
                    <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-full px-4 py-2 transition ${activeTab === tab ? 'bg-slate-900 text-white shadow dark:bg-slate-100 dark:text-slate-900' : 'border border-slate-200 bg-white text-slate-500 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300'}`}>
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeTab === 'matches' && (
                  <div
                    className="h-[calc(90vh-240px)] overflow-y-auto px-6 py-5 space-y-3 overscroll-contain"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '1200px' }}
                  >
                    {loadingMatches ? <MatchDetailSkeleton /> : !matches.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">No matches available.</div>
                    ) : (
                      <>
                        {matches
                          .slice(0, visibleMatchesCount)
                          .map(match => (
                            <MatchRow
                              key={match.matchId}
                              match={match}
                              champMap={champMap}
                              ddVersion={ddVersion}
                              detail={matchDetails[match.matchId] || null}
                              onOpen={handleOpenMatch}
                              onHover={handleMatchHover}
                              spellMap={spellMap}
                              runeMap={runeMap}
                              currentRankData={summary?.rank}
                              focusedPuuid={selectedPlayer?.player.puuid ?? null}
                            />
                          ))}
                        {visibleMatchesCount < matches.length && (
                          <div className="pt-2">
                            <button
                              type="button"
                              onClick={() => setVisibleMatchesCount(prev => Math.min(prev + 10, matches.length))}
                              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-slate-700"
                            >
                              Show more
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
                {activeTab === 'stats' && (
                  <div className="h-[calc(90vh-240px)] overflow-y-auto px-6 py-6 space-y-6">
                    {loadingMatches ? (
                      <StatGridSkeleton />
                    ) : !statsSnapshot ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        No stats available.
                      </div>
                    ) : (
                      <>
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {[
                            { label: 'Total Kills', value: statsSnapshot.totalKills },
                            { label: 'Total Deaths', value: statsSnapshot.totalDeaths },
                            { label: 'Total Assists', value: statsSnapshot.totalAssists },
                            { label: 'Overall KDA', value: statsSnapshot.kdaRatio.toFixed(2) },
                            { label: 'Time Played', value: formatHoursMinutes(statsSnapshot.timePlayedS) },
                            { label: 'Total Games', value: statsSnapshot.games },
                          ].map((stat) => (
                            <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{stat.label}</div>
                              <div className="mt-2 text-xl font-bold text-slate-900 dark:text-slate-100">{stat.value}</div>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <h4 className="text-sm font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">Records</h4>
                          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                            {([
                              { label: 'Most Kills', stat: statsSnapshot.maxKills },
                              { label: 'Most Deaths', stat: statsSnapshot.maxDeaths },
                              { label: 'Most Assists', stat: statsSnapshot.maxAssists },
                              { label: 'Most CS', stat: statsSnapshot.maxCs },
                              { label: 'Most Vision Score', stat: statsSnapshot.maxVision },
                              {
                                label: 'Longest Game',
                                stat: { value: statsSnapshot.longestGameS, championId: statsSnapshot.longestGameChampionId },
                                formatValue: (value: number) => formatMatchDuration(value),
                              },
                            ] as Array<{
                              label: string
                              stat: { value: number; championId: number }
                              formatValue?: (value: number) => string | number
                            }>).map(({ label, stat, formatValue }) => {
                              const formatStatValue = formatValue ?? ((value: number) => value)
                              const champ = champMap?.[stat.championId]
                              return (
                                <div key={label} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-950">
                                  {champ ? (
                                    <img
                                      loading="lazy"
                                      decoding="async"
                                      src={championIconUrl(ddVersion, champ.id)}
                                      alt=""
                                      className="h-12 w-12 rounded-lg border border-slate-200 dark:border-slate-700"
                                    />
                                  ) : (
                                    <div className="h-12 w-12 rounded-lg bg-slate-200 dark:bg-slate-800" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
                                    <div className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
                                      {formatStatValue(stat.value as number)}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {activeTab === 'champions' && (
                  <div className="h-[calc(90vh-240px)] overflow-y-auto px-6 py-6">
                    {loadingMatches ? (
                      <StatGridSkeleton />
                    ) : !championSnapshot.length ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                        No champion data available.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className={`rounded-2xl border px-4 py-3 ${championTotalsMismatch ? 'border-amber-300 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/10' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900'}`}>
                          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total Games</div>
                              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{championTotals.totalGames}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">W-L</div>
                              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{championTotals.wins}W {championTotals.losses}L</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Overall KDA</div>
                              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{championTotals.kda.toFixed(2)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Avg CS</div>
                              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">{championTotals.avgCs.toFixed(1)}</div>
                            </div>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Match Record</div>
                              <div className="text-base font-bold tabular-nums text-slate-900 dark:text-slate-100">
                                {championTotals.wins}W {championTotals.losses}L
                              </div>
                            </div>
                          </div>
                          {championTotalsMismatch && (
                            <div className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                              Champion rollup mismatch detected in current match dataset.
                            </div>
                          )}
                        </div>

                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <div className="grid grid-cols-[minmax(360px,1fr)_72px_72px_72px] items-center gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:border-slate-800 dark:bg-slate-950">
                            <div>Champion</div>
                            <div className="text-right tabular-nums">KDA</div>
                            <div className="text-right tabular-nums">CS</div>
                            <div className="text-right tabular-nums">Games</div>
                          </div>
                          <div className="divide-y divide-slate-200 dark:divide-slate-800">
                            {championSnapshot.map((champ) => {
                              const losses = Math.max(0, champ.games - champ.wins)
                              const winPct = champ.games ? (champ.wins / champ.games) * 100 : 0
                              return (
                                <div key={champ.championId} className="grid grid-cols-[minmax(360px,1fr)_72px_72px_72px] items-center gap-4 px-5 py-3 text-[13px] text-slate-700 dark:text-slate-200">
                                  <div className="flex items-center gap-3 min-w-0">
                                    {champ.icon ? (
                                      <img loading="lazy" decoding="async" src={champ.icon} alt="" className="h-12 w-12 rounded-lg border border-slate-200 dark:border-slate-700" />
                                    ) : (
                                      <div className="h-12 w-12 rounded-lg bg-slate-200 dark:bg-slate-800" />
                                    )}
                                    <div className="grid min-w-0 flex-1 items-center gap-3" style={{ gridTemplateColumns: '160px 240px 44px' }}>
                                      <div className="truncate font-semibold text-slate-900 dark:text-slate-100">{champ.name}</div>
                                      <div className="flex h-6 overflow-hidden rounded-full border border-slate-200 text-[11px] font-semibold tabular-nums dark:border-slate-700">
                                        {winPct === 100 ? (
                                          <span className="flex w-full items-center justify-center bg-blue-400 px-2 text-white">
                                            {champ.wins}W
                                          </span>
                                        ) : winPct === 0 ? (
                                          <span className="flex w-full items-center justify-center bg-rose-400 px-2 text-white">
                                            {losses}L
                                          </span>
                                        ) : (
                                          <>
                                            <span
                                              className="flex items-center justify-center bg-blue-400 px-2 text-white"
                                              style={{ width: `${winPct}%` }}
                                            >
                                              {champ.wins}W
                                            </span>
                                            <span
                                              className="flex items-center justify-center bg-rose-400 px-2 text-white"
                                              style={{ width: `${100 - winPct}%` }}
                                            >
                                              {losses}L
                                            </span>
                                          </>
                                        )}
                                      </div>
                                      <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                                        {champ.winrate}%
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-right text-slate-500 dark:text-slate-400 tabular-nums">{champ.kda.toFixed(2)}</div>
                                  <div className="text-right text-slate-500 dark:text-slate-400 tabular-nums">{champ.avgCs.toFixed(1)}</div>
                                  <div className="text-right font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{champ.games}</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
        <MatchDetailsModal
          open={Boolean(selectedMatch)}
          matchId={selectedMatch?.matchId ?? null}
          focusedPuuid={selectedPlayer?.player.puuid ?? null}
        champMap={champMap}
        ddVersion={ddVersion}
        participants={[]}
          onClose={handleCloseMatchModal}
          onMatchUpdate={handleMatchUpdate}
          preloadedData={selectedMatch?.matchId && matchDetails[selectedMatch.matchId]
            ? { match: matchDetails[selectedMatch.matchId] }
            : undefined}
        />
    </>
  )
}
