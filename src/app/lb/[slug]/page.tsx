import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { timeAgo } from '@/lib/timeAgo'
import { getChampionMap, championIconUrl } from '@/lib/champions'
import { getLatestDdragonVersion } from '@/lib/riot/getLatestDdragonVersion'
import { compareRanks } from '@/lib/rankSort'
import FitText from './FitText'
import Link from 'next/link'
import LatestGamesFeedClient from './LatestGamesFeedClient'
import PlayerMatchHistoryClient from './PlayerMatchHistoryClient'

// --- Types ---

type Visibility = 'PUBLIC' | 'UNLISTED' | 'PRIVATE'

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
}

interface Game {
  matchId: string
  puuid: string
  championId: number
  win: boolean
  k: number
  d: number
  a: number
  cs: number
  endTs?: number
  durationS?: number
  queueId?: number
  lpChange?: number | null
  lpNote?: string | null
  rankTier?: string | null
  rankDivision?: string | null
  endType?: 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL'
}

interface MatchParticipant {
  matchId: string
  puuid: string
  championId: number
  kills: number
  deaths: number
  assists: number
  cs: number
  win: boolean
}

// --- Constants ---

// Optimization: Move static object out of function scope to prevent reallocation on every call
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

// --- Helpers ---

function getRankIconSrc(tier?: string | null) {
  if (!tier) return '/images/UNRANKED_SMALL.jpg'
  return `/images/${tier.toUpperCase()}_SMALL.jpg`
}

function formatTierShort(tier?: string | null, division?: string | null) {
  if (!tier) return 'UR'
  const normalizedTier = tier.toUpperCase()
  const tierMap: Record<string, string> = {
    IRON: 'I',
    BRONZE: 'B',
    SILVER: 'S',
    GOLD: 'G',
    PLATINUM: 'P',
    EMERALD: 'E',
    DIAMOND: 'D',
    MASTER: 'M',
    GRANDMASTER: 'GM',
    CHALLENGER: 'C',
  }
  const tierShort = tierMap[normalizedTier] ?? normalizedTier[0] ?? 'U'
  if (['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(normalizedTier)) return tierShort

  const divisionMap: Record<string, string> = {
    I: '1',
    II: '2',
    III: '3',
    IV: '4',
  }
  const normalizedDivision = division?.toUpperCase() ?? ''
  const divisionShort = divisionMap[normalizedDivision] ?? normalizedDivision
  return divisionShort ? `${tierShort}${divisionShort}` : tierShort
}

function syncTimeAgo(iso?: string | null) {
  if (!iso) return 'never'
  return timeAgo(new Date(iso).getTime())
}

function profileIconUrl(profileIconId?: number | null, ddVersion?: string) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = ddVersion || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
  return `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profileIconId}.png`
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

function normalizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeTier(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null
}

function normalizeDivision(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null
}

const RANK_TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
]

const RANK_DIVISIONS = ['IV', 'III', 'II', 'I']

function isApexTier(tier: string) {
  return ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)
}

function getPromotedRank(tier: string | null, division: string | null) {
  if (!tier) return { tier: null, division: null }
  if (isApexTier(tier)) {
    const idx = RANK_TIERS.indexOf(tier)
    const nextTier = idx >= 0 && idx < RANK_TIERS.length - 1 ? RANK_TIERS[idx + 1] : tier
    return { tier: nextTier, division: null }
  }
  if (!division) return { tier, division: null }
  const divIdx = RANK_DIVISIONS.indexOf(division)
  if (divIdx > 0) {
    return { tier, division: RANK_DIVISIONS[divIdx - 1] }
  }
  const tierIdx = RANK_TIERS.indexOf(tier)
  const nextTier = tierIdx >= 0 && tierIdx < RANK_TIERS.length - 1 ? RANK_TIERS[tierIdx + 1] : tier
  if (nextTier && isApexTier(nextTier)) return { tier: nextTier, division: null }
  return { tier: nextTier, division: RANK_DIVISIONS[0] ?? null }
}

function getDemotedRank(tier: string | null, division: string | null) {
  if (!tier) return { tier: null, division: null }
  if (isApexTier(tier)) {
    const idx = RANK_TIERS.indexOf(tier)
    const prevTier = idx > 0 ? RANK_TIERS[idx - 1] : tier
    if (prevTier && isApexTier(prevTier)) return { tier: prevTier, division: null }
    return { tier: prevTier, division: 'I' }
  }
  if (!division) return { tier, division: null }
  const divIdx = RANK_DIVISIONS.indexOf(division)
  if (divIdx >= 0 && divIdx < RANK_DIVISIONS.length - 1) {
    return { tier, division: RANK_DIVISIONS[divIdx + 1] }
  }
  const tierIdx = RANK_TIERS.indexOf(tier)
  const prevTier = tierIdx > 0 ? RANK_TIERS[tierIdx - 1] : tier
  return { tier: prevTier, division: RANK_DIVISIONS[RANK_DIVISIONS.length - 1] ?? null }
}

function getLpDeltaFromRow(row: any) {
  const rowDelta = normalizeNumber(row.lp_change ?? row.lp_delta ?? row.lp_diff ?? null)
  const before = normalizeNumber(row.lp_before ?? row.lp_prior ?? null)
  const after = normalizeNumber(row.lp_after ?? row.lp_current ?? row.lp ?? null)
  const diff = before !== null && after !== null ? after - before : null
  return { rowDelta, diff }
}

function resolveMatchRank(row: any, lpNoteRaw: string | null) {
  const lpNote = lpNoteRaw?.toUpperCase() ?? null
  const beforeTier = normalizeTier(row.rank_tier ?? row.tier ?? row.rankTier ?? null)
  const beforeDivision = normalizeDivision(row.rank_division ?? row.rank ?? row.rankDivision ?? null)
  const afterTier = normalizeTier(
    row.rank_after_tier ??
      row.rankTierAfter ??
      row.tier_after ??
      row.after_tier ??
      row.post_tier ??
      null,
  )
  const afterDivision = normalizeDivision(
    row.rank_after_division ??
      row.rankDivisionAfter ??
      row.rank_division_after ??
      row.tier_division_after ??
      row.after_division ??
      row.post_division ??
      null,
  )

  const hasAfterRank = Boolean(afterTier)
  const sameAsBefore =
    hasAfterRank &&
    afterTier === beforeTier &&
    (afterDivision ?? null) === (beforeDivision ?? null)

  if (lpNote === 'PROMOTED') {
    if (!hasAfterRank || sameAsBefore) {
      return getPromotedRank(beforeTier, beforeDivision)
    }
    return { tier: afterTier, division: afterDivision }
  }

  if (lpNote === 'DEMOTED') {
    if (!hasAfterRank || sameAsBefore) {
      return getDemotedRank(beforeTier, beforeDivision)
    }
    return { tier: afterTier, division: afterDivision }
  }

  if (hasAfterRank) {
    return { tier: afterTier, division: afterDivision }
  }

  return { tier: beforeTier, division: beforeDivision }
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

function computeEndType({
  gameEndedInEarlySurrender,
  gameEndedInSurrender,
  gameDurationS,
  lpChange,
}: {
  gameEndedInEarlySurrender?: boolean | null
  gameEndedInSurrender?: boolean | null
  gameDurationS?: number
  lpChange?: number | null
}): 'REMAKE' | 'EARLY_SURRENDER' | 'SURRENDER' | 'NORMAL' {
  const normalizedLpChange = typeof lpChange === 'number' && Number.isFinite(lpChange) ? lpChange : null

  if (gameEndedInEarlySurrender === true) {
    if (typeof gameDurationS === 'number') {
      return gameDurationS <= 210 ? 'REMAKE' : 'EARLY_SURRENDER'
    }
    if (normalizedLpChange !== null && normalizedLpChange < 0) return 'EARLY_SURRENDER'
    return 'REMAKE'
  }

  if (gameEndedInSurrender === true) return 'SURRENDER'

  if (typeof gameDurationS === 'number') {
    if (gameDurationS <= 210 && (normalizedLpChange === null || normalizedLpChange === 0)) return 'REMAKE'
    if (gameDurationS <= 300 && normalizedLpChange !== null && normalizedLpChange < 0) return 'EARLY_SURRENDER'
  }

  return 'NORMAL'
}


// --- Components ---

function PodiumCard({
  rank,
  player,
  icon,
  rankData,
  winrate,
  topChamps,
  champMap,
  ddVersion,
}: {
  rank: number
  player: Player
  icon: string | null
  rankData: RankData | null
  winrate: ReturnType<typeof formatWinrate>
  topChamps: any[]
  champMap: any
  ddVersion: string
}) {
  const rankIcon = getRankIconSrc(rankData?.tier)
  const opggUrl = getOpggUrl(player)

  // Gold, Silver, Bronze colors with sizing
  let cardBg = 'bg-white dark:bg-slate-900'
  let accentColor = 'from-slate-400 to-slate-600'
  let rankBg = 'bg-slate-600'
  let rankText = 'text-slate-100'
  let hoverEffect = 'hover:shadow-xl hover:-translate-y-1'
  let sizeClass = 'scale-90'
  let glowEffect = ''

  if (rank === 1) {
    // Gold
    cardBg = 'bg-white dark:bg-slate-900'
    accentColor = 'from-yellow-400 via-yellow-500 to-amber-600'
    rankBg = 'bg-gradient-to-r from-yellow-400 via-yellow-500 to-amber-600'
    rankText = 'text-white'
    hoverEffect = 'hover:shadow-2xl hover:-translate-y-2'
    sizeClass = 'scale-110'
    glowEffect = 'shadow-2xl shadow-yellow-500/25 ring-2 ring-yellow-400/30'
  } else if (rank === 2) {
    // Silver
    accentColor = 'from-slate-300 via-slate-400 to-slate-500'
    rankBg = 'bg-gradient-to-r from-slate-300 via-slate-400 to-slate-500'
    rankText = 'text-white'
    sizeClass = 'scale-100'
  } else if (rank === 3) {
    // Bronze
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
      className={`group relative flex flex-col ${cardBg} rounded-2xl shadow-lg ${hoverEffect} ${sizeClass} ${glowEffect} transition-all duration-300 overflow-hidden border border-slate-200 dark:border-slate-800`}
    >
      {/* Accent bar at top */}
      <div className={`h-1.5 w-full bg-gradient-to-r ${accentColor}`} />

      {/* Rank badge - corner ribbon style */}
      <div className="absolute top-3 right-3 z-10">
        <div className={`${rankBg} px-3 py-1.5 rounded-lg shadow-md ${rankText} text-xs font-bold tracking-wide`}>
          #{rank}
        </div>
      </div>

      {/* Card Content */}
      <div className="p-6 flex flex-col items-center">
        {/* Profile Icon */}
        <div className="relative h-24 w-24 rounded-2xl overflow-hidden border-2 border-slate-200 shadow-md bg-slate-100 group-hover:scale-105 transition-transform duration-300 dark:border-slate-700 dark:bg-slate-800">
          {icon ? (
            <img src={icon} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
          )}
        </div>

        {/* Player Name & Role */}
        <div className="mt-4 text-center w-full px-2">
          {opggUrl ? (
            <a
              href={opggUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center justify-center gap-1 text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
              title="View on OP.GG"
            >
              <FitText
                text={displayRiotId(player)}
                className="block max-w-full whitespace-nowrap font-bold"
                minScale={0.65}
              />
            </a>
          ) : (
            <FitText
              text={displayRiotId(player)}
              className="block max-w-full whitespace-nowrap font-bold text-slate-900 dark:text-slate-100"
              minScale={0.65}
            />
          )}
          {player.role && (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-1 dark:text-slate-400">
              {player.role}
            </div>
          )}
        </div>

        {/* Rank Info */}
        <div className="mt-5 flex flex-col items-center gap-3 w-full">
          {/* LP Display */}
          <div className="flex items-center gap-3 bg-slate-50 px-5 py-3 rounded-xl border border-slate-200 w-full justify-center group-hover:bg-slate-100 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-900 dark:group-hover:bg-slate-800">
            {rankIcon && (
              <img src={rankIcon} alt={rankData?.tier || ''} className="h-11 w-11 object-contain" />
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

          {/* Winrate */}
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

        {/* Champion Pool */}
        <div className="mt-5 flex gap-2">
          {topChamps.slice(0, 3).map((c) => {
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

        {/* Social Links - Always reserve space */}
        <div className="mt-5 pt-5 border-t border-slate-100 w-full min-h-[52px] flex items-center justify-center dark:border-slate-800">
          <div className="flex gap-2">
            {player.twitch_url && (
              <a
                href={player.twitch_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center h-9 w-9 rounded-lg bg-slate-100 text-slate-400 hover:bg-purple-500 hover:text-white hover:scale-110 transition-all duration-200 shadow-sm dark:bg-slate-800 dark:text-slate-400"
                title="Twitch"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h2.998L22.286 11.143V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
                </svg>
              </a>
            )}
            {player.twitter_url && (
              <a
                href={player.twitter_url}
                target="_blank"
                rel="noreferrer"
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

function PlayerListRow({
  player,
  index,
  rankData,
  stateData,
  topChamps,
  winrate,
  champMap,
  ddVersion,
}: {
  player: Player
  index: number
  rankData: any
  stateData: any
  topChamps: any[]
  winrate: any
  champMap: any
  ddVersion: string
}) {
  const icon = profileIconUrl(stateData?.profile_icon_id, ddVersion)
  const rankIcon = getRankIconSrc(rankData?.tier)
  const opggUrl = getOpggUrl(player)

  const tier = rankData?.tier
  const division = rankData?.rank
  let tierDisplay = 'Unranked'
  
  if (tier) {
    const isApex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)
    tierDisplay = isApex ? tier : `${tier} ${division || ''}`.trim()
  }

  return (
    <div className="group flex items-center gap-3 lg:gap-4 rounded-2xl border border-slate-200 bg-white px-4 lg:px-6 py-4 transition-all hover:border-slate-300 hover:shadow-lg hover:-translate-y-0.5 duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      {/* 1. Rank # */}
      <div className="w-8 shrink-0 flex justify-center">
        <span className="text-sm font-black text-slate-400 group-hover:text-slate-600 transition-colors dark:text-slate-500 dark:group-hover:text-slate-300">
          {index}
        </span>
      </div>

      {/* 2. Player Profile */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border-2 border-slate-200 shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
          {icon && (
            <img src={icon} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {opggUrl ? (
            <a
              href={opggUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center text-slate-900 transition-colors hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
              title="View on OP.GG"
            >
              <FitText
                text={displayRiotId(player)}
                className="block max-w-full whitespace-nowrap font-bold"
                minScale={0.65}
              />
            </a>
          ) : (
            <FitText
              text={displayRiotId(player)}
              className="block max-w-full whitespace-nowrap font-bold text-slate-900 group-hover:text-slate-700 transition-colors dark:text-slate-100 dark:group-hover:text-white"
              minScale={0.65}
            />
          )}
          {player.role && (
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5 dark:text-slate-500">
              {player.role}
            </div>
          )}
        </div>
      </div>

      {/* 3. Rank Section */}
      <div className="hidden md:flex items-center gap-2 lg:gap-3 shrink-0">
        {rankIcon && (
          <img src={rankIcon} alt="" className="h-9 w-9 object-contain drop-shadow-sm shrink-0" />
        )}
        <div className="flex flex-col">
          <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">
            {rankData?.league_points ?? 0} LP
          </span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap dark:text-slate-500">
            {tierDisplay}
          </span>
        </div>
      </div>

      {/* 4. Stats Section - Fixed width containers */}
      <div className="hidden md:flex items-center gap-4 lg:gap-6 shrink-0">
        <div className="flex flex-col items-center w-14">
          <span className={`text-sm font-black whitespace-nowrap ${winrate.pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
            {winrate.pct}%
          </span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">
            Win
          </span>
        </div>
        <div className="flex flex-col items-center w-14">
          <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">
            {winrate.total}
          </span>
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">
            Games
          </span>
        </div>
      </div>

      {/* 5. Social Icons - Fixed width, always reserve space */}
      <div className="hidden sm:flex items-center justify-center gap-1.5 shrink-0 w-[72px]">
        {player.twitch_url ? (
          <a
            href={player.twitch_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center h-8 w-8 rounded-lg bg-slate-100 text-slate-300 hover:bg-purple-50 hover:text-purple-600 hover:scale-110 transition-all duration-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-purple-500/20"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h2.998L22.286 11.143V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
            </svg>
          </a>
        ) : (
          <div className="h-8 w-8" />
        )}
        {player.twitter_url ? (
          <a
            href={player.twitter_url}
            target="_blank"
            rel="noreferrer"
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

      {/* 6. Champion Icons - Fixed width, always reserve space */}
      <div className="hidden lg:flex items-center gap-1 shrink-0">
        {[0, 1, 2].map((idx) => {
          const c = topChamps[idx]
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

// --- Page ---

export default async function LeaderboardDetail({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()

  const latestPatch = await getLatestDdragonVersion()
  const ddVersion = latestPatch || process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
  const champMap = await getChampionMap(ddVersion)

  // Fetches banner_url directly from DB
  const { data: lb } = await supabase
    .from('leaderboards')
    .select('id, user_id, name, description, visibility, banner_url, updated_at')
    .eq('slug', slug)
    .maybeSingle()

  if (!lb) notFound()

  if ((lb.visibility as Visibility) === 'PRIVATE') {
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user || user.id !== lb.user_id) notFound()
  }

  const { data: playersRaw } = await supabase
    .from('leaderboard_players')
    .select('id, puuid, game_name, tag_line, role, twitch_url, twitter_url, sort_order')
    .eq('leaderboard_id', lb.id)
    .order('sort_order', { ascending: true })
    .limit(50)

  const players: Player[] = playersRaw ?? []
  const puuids = players.map((p) => p.puuid).filter(Boolean)

  // Fetch Details
  const [{ data: statesRaw }, { data: ranksRaw }, { data: champsRaw }] = await Promise.all([
    supabase.from('player_riot_state').select('*').in('puuid', puuids),
    supabase.from('player_rank_snapshot').select('*').in('puuid', puuids),
    supabase.from('player_top_champions').select('*').in('puuid', puuids),
  ])

  // Optimization: Process states and find max update time in one pass
  const stateBy = new Map<string, any>()
  let maxLastUpdatedTs = 0
  let lastUpdatedIso: string | null = null
  
  if (statesRaw) {
    for (const s of statesRaw) {
      stateBy.set(s.puuid, s)
      if (s.last_rank_sync_at) {
        const ts = new Date(s.last_rank_sync_at).getTime()
        if (ts > maxLastUpdatedTs) {
          maxLastUpdatedTs = ts
          lastUpdatedIso = s.last_rank_sync_at
        }
      }
    }
  }

  // Optimization: Process ranks in one pass, respecting season start and type preference
  const rankBy = new Map<string, any>()
  const seasonStartRaw = process.env.RANKED_SEASON_START
  const seasonStartMs = seasonStartRaw ? new Date(seasonStartRaw).getTime() : 0
  
  if (ranksRaw) {
    // Intermediate map to hold both queues before selection
    const queuesByPuuid = new Map<string, { solo: any; flex: any }>()
    
    for (const r of ranksRaw) {
      if (r.fetched_at && (!seasonStartMs || new Date(r.fetched_at).getTime() >= seasonStartMs)) {
        let entry = queuesByPuuid.get(r.puuid)
        if (!entry) {
          entry = { solo: null, flex: null }
          queuesByPuuid.set(r.puuid, entry)
        }
        
        if (r.queue_type === 'RANKED_SOLO_5x5') entry.solo = r
        else if (r.queue_type === 'RANKED_FLEX_SR') entry.flex = r
      }
    }

    // Assign final rank
    for (const pid of puuids) {
      const entry = queuesByPuuid.get(pid)
      rankBy.set(pid, entry?.solo ?? entry?.flex ?? null)
    }
  }

  const playersSorted = [...players].sort((a, b) => {
    const rankA = rankBy.get(a.puuid)
    const rankB = rankBy.get(b.puuid)
    return compareRanks(rankA, rankB)
  })

  // Optimization: Efficient map construction for champs
  const champsBy = new Map<string, any[]>()
  if (champsRaw) {
    for (const c of champsRaw) {
      let arr = champsBy.get(c.puuid)
      if (!arr) {
        arr = []
        champsBy.set(c.puuid, arr)
      }
      arr.push(c)
    }
  }
  for (const arr of champsBy.values()) {
    arr.sort((a, b) => b.games - a.games)
  }

  // Cutoffs
  const { data: cutsRaw } = await supabase
    .from('rank_cutoffs')
    .select('queue_type, tier, cutoff_lp')
    .in('tier', ['GRANDMASTER', 'CHALLENGER'])

  const cutoffsMap = new Map<string, number>()
  if (cutsRaw) {
    for (const c of cutsRaw) {
      cutoffsMap.set(`${c.queue_type}::${c.tier}`, c.cutoff_lp)
    }
  }

  const cutoffs = [
    { key: 'RANKED_SOLO_5x5::CHALLENGER', label: 'Challenger', icon: '/images/CHALLENGER_SMALL.jpg' },
    { key: 'RANKED_SOLO_5x5::GRANDMASTER', label: 'Grandmaster', icon: '/images/GRANDMASTER_SMALL.jpg' },
  ]
    .map((i) => ({
      label: i.label,
      lp: cutoffsMap.get(i.key) as number,
      icon: i.icon,
    }))
    .filter((x) => x.lp !== undefined)

  // Latest Games
  const { data: latestRaw } = await supabase.rpc('get_leaderboard_latest_games', { lb_id: lb.id, lim: 10 })
  const seasonStartIso = '2025-01-08T20:00:00.000Z'
  
  // Optimization: Map directly to Set to avoid intermediate array creation if possible, 
  // but here we need array for the .in() query. Filter only once.
  const latestMatchIds: string[] = []
  const seenMatchIds = new Set<string>()
  if (latestRaw) {
    for (const row of latestRaw) {
      if (row.match_id && !seenMatchIds.has(row.match_id)) {
        seenMatchIds.add(row.match_id)
        latestMatchIds.push(row.match_id)
      }
    }
  }

  const seasonStartMsLatest = new Date(seasonStartIso).getTime()
  const { data: latestMatchesRaw } = latestMatchIds.length
    ? await supabase
        .from('matches')
        .select('match_id, fetched_at, game_end_ts')
        .in('match_id', latestMatchIds)
        .gte('fetched_at', seasonStartIso)
        .gte('game_end_ts', seasonStartMsLatest)
    : { data: [] as Array<{ match_id: string; fetched_at: string }> }

  const allowedMatchIds = new Set((latestMatchesRaw ?? []).map((row) => row.match_id))
  const filteredLatestRaw = (latestRaw ?? []).filter((row: any) => allowedMatchIds.has(row.match_id))
  const filteredMatchIds = latestMatchIds.filter((matchId) => allowedMatchIds.has(matchId))

  // FIX: Collect PUUIDs from the games themselves so we get LP data even if the player isn't in the Top 50 loaded above
  const gamePuuids = filteredLatestRaw.map((row: any) => row.puuid).filter(Boolean)
  const allRelevantPuuids = Array.from(new Set([...puuids, ...gamePuuids]))

  const lpByMatchAndPlayer = new Map<string, { delta: number; note: string | null }>()

  if (filteredMatchIds.length > 0 && allRelevantPuuids.length > 0) {
    const { data: lpEventsRaw } = await supabase
      .from('player_lp_events')
      .select('match_id, puuid, lp_delta, note')
      .in('match_id', filteredMatchIds)
      .in('puuid', allRelevantPuuids)

    if (lpEventsRaw) {
      for (const row of lpEventsRaw) {
        if (row.match_id && row.puuid && typeof row.lp_delta === 'number') {
          lpByMatchAndPlayer.set(`${row.match_id}-${row.puuid}`, {
            delta: row.lp_delta,
            note: row.note ?? null,
          })
        }
      }
    }
  }

  const latestGames: Game[] = filteredLatestRaw.map((row: any) => {
    const lpEvent = lpByMatchAndPlayer.get(`${row.match_id}-${row.puuid}`)
    const { rowDelta, diff } = getLpDeltaFromRow(row)
    const eventDelta = normalizeNumber(lpEvent?.delta)
    let lpChange = rowDelta ?? eventDelta ?? diff ?? null
    if ((lpChange === null || lpChange === 0) && eventDelta !== null && eventDelta !== 0) {
      lpChange = eventDelta
    }
    if ((lpChange === null || lpChange === 0) && diff !== null && diff !== 0) {
      lpChange = diff
    }
    const durationS = row.game_duration_s ?? row.gameDuration
    const matchRank = resolveMatchRank(row, row.lp_note ?? row.note ?? lpEvent?.note ?? null)
    const endType = computeEndType({
      gameEndedInEarlySurrender: row.game_ended_in_early_surrender ?? row.gameEndedInEarlySurrender,
      gameEndedInSurrender: row.game_ended_in_surrender ?? row.gameEndedInSurrender,
      gameDurationS: durationS,
      lpChange,
    })

    return {
      matchId: row.match_id,
      puuid: row.puuid,
      championId: row.champion_id,
      win: row.win,
      k: row.kills ?? 0,
      d: row.deaths ?? 0,
      a: row.assists ?? 0,
      cs: row.cs ?? 0,
      endTs: row.game_end_ts,
      durationS,
      queueId: row.queue_id,
      lpChange,
      lpNote: row.lp_note ?? row.note ?? lpEvent?.note ?? null,
      rankTier: matchRank.tier,
      rankDivision: matchRank.division,
      endType,
    }
  })

  const { data: matchParticipantsRaw } = filteredMatchIds.length
    ? await supabase
        .from('match_participants')
        .select('match_id, puuid, champion_id, kills, deaths, assists, cs, win')
        .in('match_id', filteredMatchIds)
    : { data: [] as Array<Record<string, unknown>> }

  const participantsByMatch = new Map<string, MatchParticipant[]>()
  if (matchParticipantsRaw) {
    for (const row of matchParticipantsRaw as Array<{
      match_id?: string | null
      puuid?: string | null
      champion_id?: number | null
      kills?: number | null
      deaths?: number | null
      assists?: number | null
      cs?: number | null
      win?: boolean | null
    }>) {
      if (!row.match_id || !row.puuid) continue
      const entry: MatchParticipant = {
        matchId: row.match_id,
        puuid: row.puuid,
        championId: row.champion_id ?? 0,
        kills: row.kills ?? 0,
        deaths: row.deaths ?? 0,
        assists: row.assists ?? 0,
        cs: row.cs ?? 0,
        win: row.win ?? false,
      }
      const list = participantsByMatch.get(entry.matchId)
      if (list) {
        list.push(entry)
      } else {
        participantsByMatch.set(entry.matchId, [entry])
      }
    }
  }

  const playersByPuuidRecord = Object.fromEntries(players.map((player) => [player.puuid, player]))
  const rankByPuuidRecord = Object.fromEntries(rankBy.entries())
  const participantsByMatchRecord = Object.fromEntries(participantsByMatch.entries())

  const playerCards = playersSorted.map((player, idx) => ({
    player,
    index: idx + 1,
    rankData: rankBy.get(player.puuid) ?? null,
    stateData: stateBy.get(player.puuid) ?? null,
    topChamps: champsBy.get(player.puuid) ?? [],
  }))

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-7xl px-4 py-8 lg:py-12 space-y-10 lg:space-y-12">
        {/* 1. Header & Cutoffs */}
        <TeamHeaderCard
          name={lb.name}
          description={lb.description}
          visibility={lb.visibility}
          lastUpdated={lastUpdatedIso}
          cutoffs={cutoffs}
          bannerUrl={lb.banner_url}
          actionHref={`/lb/${slug}/graph`}
          actionLabel="View graph"
          secondaryActionHref={`/lb/${slug}/stats`}
          secondaryActionLabel="View stats"
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
          {/* Left Sidebar: Activity */}
          <aside className="lg:col-span-3 lg:sticky lg:top-6 order-2 lg:order-1">
            <div className="flex items-center gap-2 mb-5">
              <div className="h-1 w-6 bg-gradient-to-r from-blue-400 to-blue-600 rounded-full" />
              <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Latest Activity
              </h3>
            </div>
            <LatestGamesFeedClient
              games={latestGames}
              playersByPuuid={playersByPuuidRecord}
              champMap={champMap}
              ddVersion={ddVersion}
              rankByPuuid={rankByPuuidRecord}
              participantsByMatch={participantsByMatchRecord}
            />
          </aside>

          {/* Right Content */}
          <div className="lg:col-span-9 order-1 lg:order-2 space-y-10 lg:space-y-12">
            <PlayerMatchHistoryClient playerCards={playerCards} champMap={champMap} ddVersion={ddVersion} />
          </div>
        </div>
      </div>
    </main>
  )
}
function TeamHeaderCard({
  name,
  description,
  visibility,
  lastUpdated,
  cutoffs,
  bannerUrl,
  actionHref,
  actionLabel,
  secondaryActionHref,
  secondaryActionLabel,
}: {
  name: string
  description?: string | null
  visibility: string
  lastUpdated: string | null
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  bannerUrl: string | null
  actionHref: string
  actionLabel: string
  secondaryActionHref?: string
  secondaryActionLabel?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      {/* Background pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900" />
      <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] pointer-events-none dark:bg-grid-slate-800 dark:[mask-image:linear-gradient(0deg,rgba(15,23,42,0.9),rgba(15,23,42,0.4))]" />

      {/* Banner Image Area */}
      {bannerUrl && (
        <div className="relative h-48 w-full border-b border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bannerUrl}
            alt="Leaderboard Banner"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Content Area */}
      <div className="relative flex flex-col lg:flex-row">
        {/* Left: Info */}
        <div className="flex-1 p-8 lg:p-10">
          <div className="flex flex-wrap items-center gap-2.5 mb-6">
            <span className="inline-flex items-center rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300/50 uppercase tracking-wider shadow-sm dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:ring-slate-700/70">
              {visibility}
            </span>
            {actionHref && actionLabel && (
              <>
                <Link
                  href={actionHref}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 7-7" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18" />
                  </svg>
                  {actionLabel}
                </Link>
                {secondaryActionHref && secondaryActionLabel && (
                  <Link
                    href={secondaryActionHref}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
                  >
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                    {secondaryActionLabel}
                  </Link>
                )}
              </>
            )}
          </div>

          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 mb-4 pb-2 dark:from-white dark:via-slate-200 dark:to-slate-400">
            {name}
          </h1>
          {description && (
            <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">
              {description}
            </p>
          )}
        </div>

        {/* Right: Cutoffs Widget */}
        {cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Rank Cutoffs
              </div>
            </div>
            {cutoffs.map((c) => (
              <div
                key={c.label}
                className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.icon} alt={c.label} className="w-12 h-12 object-contain drop-shadow-sm" />
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">
                    {c.label}
                  </div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
