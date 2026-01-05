import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { timeAgo } from '@/lib/timeAgo'
import { getChampionMap, championIconUrl } from '@/lib/champions'
import { compareRanks } from '@/lib/rankSort'
import FitText from './FitText'

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
}

// --- Helpers ---

function getRankIconSrc(tier?: string | null) {
  if (!tier) return '/images/UNRANKED_SMALL.jpg'
  return `/images/${tier.toUpperCase()}_SMALL.jpg`
}

function syncTimeAgo(iso?: string | null) {
  if (!iso) return 'never'
  return timeAgo(new Date(iso).getTime())
}

function profileIconUrl(profileIconId?: number | null) {
  if (!profileIconId && profileIconId !== 0) return null
  const v = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
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

function displayRiotId(p: Player) {
  const gn = (p.game_name ?? '').trim()
  const tl = (p.tag_line ?? '').trim()
  if (gn && tl) return `${gn}#${tl}`
  return p.puuid
}

function formatDuration(durationS?: number) {
  if (!durationS) return ''
  const m = Math.floor(durationS / 60)
  const s = durationS % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getKdaColor(kda: number) {
  if (kda >= 5) return 'text-amber-600 font-bold dark:text-amber-400'
  if (kda >= 4) return 'text-blue-600 font-bold dark:text-blue-400'
  if (kda >= 3) return 'text-emerald-600 font-bold dark:text-emerald-400'
  return 'text-slate-600 font-semibold dark:text-slate-300'
}

// --- Components ---

function TeamHeaderCard({
  name,
  description,
  visibility,
  lastUpdated,
  cutoffs,
  bannerUrl,
}: {
  name: string
  description?: string | null
  visibility: string
  lastUpdated: string | null
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  bannerUrl: string | null
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
          <div className="flex flex-wrap gap-2.5 mb-6">
            <span className="inline-flex items-center rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300/50 uppercase tracking-wider shadow-sm dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:ring-slate-700/70">
              {visibility}
            </span>
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
  const isFirst = rank === 1
  const rankIcon = getRankIconSrc(rankData?.tier)

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
            // eslint-disable-next-line @next/next/no-img-element
            <img src={icon} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
          )}
        </div>

        {/* Player Name & Role */}
        <div className="mt-4 text-center w-full px-2">
          <FitText
            text={displayRiotId(player)}
            className="block max-w-full whitespace-nowrap font-bold text-slate-900 dark:text-slate-100"
          />
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
              // eslint-disable-next-line @next/next/no-img-element
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
              // eslint-disable-next-line @next/next/no-img-element
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
  const icon = profileIconUrl(stateData?.profile_icon_id)
  const rankIcon = getRankIconSrc(rankData?.tier)

  // Logic to display division (I, II, III, IV) for Diamond and below
  const tier = rankData?.tier
  const division = rankData?.rank
  let tierDisplay = 'Unranked'
  
  if (tier) {
    const isApex = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(tier)
    // Only show division if NOT Apex tier
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
      <div className="flex items-center gap-3 w-64 lg:w-72 shrink-0">
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 border-2 border-slate-200 shadow-sm dark:from-slate-800 dark:to-slate-900 dark:border-slate-700">
          {icon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={icon} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <FitText
            text={displayRiotId(player)}
            className="block max-w-full whitespace-nowrap font-bold text-slate-900 transition-colors group-hover:text-slate-700 dark:text-slate-100 dark:group-hover:text-white"
          />
          {player.role && (
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mt-0.5 dark:text-slate-500">
              {player.role}
            </div>
          )}
        </div>
      </div>

      {/* 3. Rank & Stats Grid - Flexible Center */}
      <div className="flex-1 flex items-center gap-4 lg:gap-6 min-w-0">
        {/* Rank Section */}
        <div className="flex items-center gap-2 lg:gap-3 shrink-0">
          {rankIcon && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={rankIcon} alt="" className="h-9 w-9 object-contain drop-shadow-sm shrink-0" />
          )}
          <div className="flex flex-col">
            <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">
              {rankData?.league_points ?? 0} LP
            </span>
            {/* Displays Tier + Division (e.g. DIAMOND I) */}
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide whitespace-nowrap dark:text-slate-500">
              {tierDisplay}
            </span>
          </div>
        </div>

        {/* Stats Section */}
        <div className="hidden sm:flex items-center gap-4 lg:gap-6 ml-auto">
          <div className="flex flex-col items-center">
            <span
              className={`text-sm font-black whitespace-nowrap ${
                winrate.pct >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {winrate.pct}%
            </span>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">
              Win
            </span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-sm font-black text-slate-900 whitespace-nowrap dark:text-slate-100">
              {winrate.total}
            </span>
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide dark:text-slate-500">
              Games
            </span>
          </div>
        </div>
      </div>

      {/* 4. Socials & Champs - Right Aligned (fixed width so stats don't shift) */}
      <div className="flex items-center justify-end gap-2 lg:gap-3 shrink-0 w-[84px] lg:w-[200px]">
        {/* Social Icons: reserve space even if empty */}
        <div className="flex justify-end gap-1.5 w-[74px]">
          {player.twitch_url && (
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
          )}

          {player.twitter_url && (
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
          )}
        </div>

        {/* Champs: reserve space on lg so it's always the same width */}
        <div className="hidden lg:flex justify-end gap-1 w-[104px]">
          {topChamps.slice(0, 3).map((c) => {
            const champ = champMap[c.champion_id]
            if (!champ) return null
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={c.champion_id}
                src={championIconUrl(ddVersion, champ.id)}
                className="h-8 w-8 rounded-lg border-2 border-slate-200 shadow-sm hover:scale-110 hover:border-slate-300 transition-all duration-200 dark:border-slate-700"
                alt=""
                title={champ.name}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LatestGamesFeed({
  games,
  playersByPuuid,
  champMap,
  ddVersion,
}: {
  games: Game[]
  playersByPuuid: Map<string, Player>
  champMap: any
  ddVersion: string
}) {
  if (games.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-900">
        <svg className="w-12 h-12 mx-auto text-slate-300 mb-3 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-300">No recent matches</p>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      {games.map((g) => {
        const p = playersByPuuid.get(g.puuid)
        const name = p ? displayRiotId(p) : 'Unknown'
        const when = g.endTs ? timeAgo(g.endTs) : ''
        const champ = champMap[g.championId]
        const champSrc = champ ? championIconUrl(ddVersion, champ.id) : null
        const kdaValue = g.d > 0 ? (g.k + g.a) / g.d : 99
        const kda = g.d === 0 ? 'Perfect' : kdaValue.toFixed(1)
        const kdaColor = g.d === 0 ? 'text-amber-600 font-black' : getKdaColor(kdaValue)
        const duration = formatDuration(g.durationS)
        const lpChange = g.lpChange

        return (
          <div
            key={`${g.matchId}-${g.puuid}`}
            className={`group flex flex-col gap-2 rounded-xl border-l-4 bg-white p-3 shadow-sm hover:shadow-md transition-all duration-200 dark:bg-slate-900 ${
              g.win
                ? 'border-l-emerald-400 border-y border-r border-emerald-100 hover:border-emerald-200 dark:border-emerald-500/40 dark:hover:border-emerald-400/60'
                : 'border-l-rose-400 border-y border-r border-rose-100 hover:border-rose-200 dark:border-rose-500/40 dark:hover:border-rose-400/60'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 shrink-0">
                {champSrc && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={champSrc}
                    alt=""
                    className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                  />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <FitText
                    text={name}
                    className="block max-w-full whitespace-nowrap text-xs font-bold text-slate-900 dark:text-slate-100"
                    minScale={0.7}
                  />
                  <span className="text-[10px] text-slate-400 font-medium dark:text-slate-500">{when}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[11px] text-slate-600 font-medium dark:text-slate-300">
                    {champ?.name || 'Unknown'}
                  </span>
                </div>
              </div>
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-2 text-[10px] border-t border-slate-100 pt-2 -mb-1 dark:border-slate-800">
              {duration && (
                <>
                  <span className="font-semibold text-slate-600 tabular-nums dark:text-slate-300">{duration}</span>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                </>
              )}
              <span className="font-bold text-slate-700 tabular-nums dark:text-slate-200">
                {g.k}/{g.d}/{g.a}
              </span>
              {typeof lpChange === 'number' && !Number.isNaN(lpChange) && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      lpChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {lpChange >= 0 ? `+${lpChange}` : lpChange} LP
                  </span>
                </>
              )}
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className={`tabular-nums ${kdaColor}`}>{kda} KDA</span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className="font-semibold text-slate-600 tabular-nums dark:text-slate-300">{g.cs} CS</span>
            </div>
          </div>
        )
      })}
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

  const ddVersion = process.env.NEXT_PUBLIC_DDRAGON_VERSION || '15.24.1'
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

  const stateBy = new Map((statesRaw ?? []).map((s) => [s.puuid, s]))
  const rankBy = new Map()
  const ranksList = ranksRaw ?? []

  puuids.forEach((pid) => {
    const solo = ranksList.find((r) => r.puuid === pid && r.queue_type === 'RANKED_SOLO_5x5')
    const flex = ranksList.find((r) => r.puuid === pid && r.queue_type === 'RANKED_FLEX_SR')
    rankBy.set(pid, solo ?? flex ?? null)
  })

  const playersSorted = [...players].sort((a, b) => {
    const rankA = rankBy.get(a.puuid)
    const rankB = rankBy.get(b.puuid)
    return compareRanks(rankA, rankB)
  })

  const champsBy = new Map<string, any[]>()
  ;(champsRaw ?? []).forEach((c) => {
    const arr = champsBy.get(c.puuid) || []
    arr.push(c)
    champsBy.set(c.puuid, arr)
  })
  for (const [pid, arr] of champsBy.entries()) {
    arr.sort((a, b) => b.games - a.games)
  }

  // Cutoffs
  const { data: cutsRaw } = await supabase
    .from('rank_cutoffs')
    .select('queue_type, tier, cutoff_lp')
    .in('tier', ['GRANDMASTER', 'CHALLENGER'])

  const cutoffsMap = new Map((cutsRaw ?? []).map((c) => [`${c.queue_type}::${c.tier}`, c.cutoff_lp]))
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
  const latestGames: Game[] = (latestRaw ?? []).map((row: any) => ({
    matchId: row.match_id,
    puuid: row.puuid,
    championId: row.champion_id,
    win: row.win,
    k: row.kills ?? 0,
    d: row.deaths ?? 0,
    a: row.assists ?? 0,
    cs: row.cs ?? 0,
    endTs: row.game_end_ts,
    durationS: row.game_duration_s,
    queueId: row.queue_id,
    lpChange: row.lp_change ?? row.lp_delta ?? row.lp_diff ?? null,
  }))

  const lastUpdatedIso = puuids.map((p) => stateBy.get(p)?.last_rank_sync_at).sort().at(-1) || null
  const playersByPuuid = new Map(players.map((p) => [p.puuid, p]))

  const top3 = playersSorted.slice(0, 3)
  const rest = playersSorted.slice(3)

  const finalPodium = top3.filter(Boolean)

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
            <LatestGamesFeed games={latestGames} playersByPuuid={playersByPuuid} champMap={champMap} ddVersion={ddVersion} />
          </aside>

          {/* Right Content */}
          <div className="lg:col-span-9 order-1 lg:order-2 space-y-10 lg:space-y-12">
            {/* 2. Podium */}
            {finalPodium.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-6">
                  <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
                  <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Top Players
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-end">
                  {finalPodium.map((p, idx) => {
                    const actualRank = idx + 1 // This is 1, 2, or 3
                    const r = rankBy.get(p.puuid)
                    
                    // CSS Grid ordering for desktop: 2nd left, 1st center, 3rd right
                    let orderClass = ''
                    if (actualRank === 1) orderClass = 'sm:order-2' // 1st place in center on desktop
                    if (actualRank === 2) orderClass = 'sm:order-1' // 2nd place on left on desktop
                    if (actualRank === 3) orderClass = 'sm:order-3' // 3rd place on right on desktop
                    
                    return (
                      <div key={p.id} className={orderClass}>
                        <PodiumCard
                          rank={actualRank}
                          player={p}
                          icon={profileIconUrl(stateBy.get(p.puuid)?.profile_icon_id)}
                          rankData={r}
                          winrate={formatWinrate(r?.wins, r?.losses)}
                          topChamps={champsBy.get(p.puuid) ?? []}
                          champMap={champMap}
                          ddVersion={ddVersion}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 3. Detailed List */}
            {rest.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-1 w-6 bg-gradient-to-r from-slate-400 to-slate-600 rounded-full" />
                  <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                    Runnerups
                  </h2>
                </div>
                {rest.map((p, idx) => {
                  const r = rankBy.get(p.puuid)
                  return (
                    <PlayerListRow
                      key={p.id}
                      index={idx + 4}
                      player={p}
                      rankData={r}
                      stateData={stateBy.get(p.puuid)}
                      winrate={formatWinrate(r?.wins, r?.losses)}
                      topChamps={champsBy.get(p.puuid) ?? []}
                      champMap={champMap}
                      ddVersion={ddVersion}
                    />
                  )
                })}
              </div>
            )}

            {rest.length === 0 && top3.length === 0 && (
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
          </div>
        </div>
      </div>
    </main>
  )
}
