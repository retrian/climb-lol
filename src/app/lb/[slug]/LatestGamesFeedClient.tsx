'use client'

import { useState, useMemo, memo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { championIconUrl } from '@/lib/champions'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'
import { useMatchPrefetch } from './useMatchPrefetch'

const MatchDetailsModal = dynamic(() => import('./MatchDetailsModal'), {
  ssr: false,
})

const LIVE_TIME_INTERVAL_MS = 60_000
const FEED_REFRESH_INTERVAL_MS = 60_000
const liveTimeListeners = new Set<(now: number) => void>()
let liveTimeIntervalId: number | null = null

function startLiveTimeTicker() {
  if (liveTimeIntervalId !== null) return
  if (typeof window === 'undefined') return
  liveTimeIntervalId = window.setInterval(() => {
    const now = Date.now()
    for (const listener of liveTimeListeners) listener(now)
  }, LIVE_TIME_INTERVAL_MS)
}

function stopLiveTimeTicker() {
  if (liveTimeIntervalId === null) return
  window.clearInterval(liveTimeIntervalId)
  liveTimeIntervalId = null
}

function subscribeLiveTime(listener: (now: number) => void) {
  liveTimeListeners.add(listener)
  if (liveTimeListeners.size === 1) startLiveTimeTicker()
  return () => {
    liveTimeListeners.delete(listener)
    if (liveTimeListeners.size === 0) stopLiveTimeTicker()
  }
}

function useLiveTime() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    return subscribeLiveTime(setNow)
  }, [])

  return now
}

interface Player {
  id: string
  puuid: string
  game_name: string | null
  tag_line: string | null
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

interface Champion {
  id: string
  name: string
}

interface RankData {
  tier: string | null
  rank: string | null
  league_points: number | null
  wins: number | null
  losses: number | null
  fetched_at: string | null
}

interface PreloadedMatchData {
  match: unknown
  timeline: unknown
  accounts: Record<string, unknown>
}

function normalizeEndTs(value?: number | string | null): number | null {
  if (value === null || value === undefined) return null
  const num = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(num)) return null
  return num < 1_000_000_000_000 ? num * 1000 : num
}

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

function displayRiotId(p: Player) {
  const gn = (p.game_name ?? '').trim()
  return gn || 'Unknown Player'
}

function formatLpNote(lpNote: string | null, isRemake: boolean) {
  if (lpNote === 'PROMOTED') return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/20'
  if (isRemake) return 'text-slate-500 bg-slate-100 dark:text-slate-200 dark:bg-slate-700/40'
  return 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/20'
}

// Memoized Game Item Component
const GameItem = memo(({ 
  game, 
  player, 
  champSrc, 
  rankData, 
  profileIconSrc,
  hasMatchDetails,
  onSelect,
  onHover
}: {
  game: Game
  player: Player | null
  champSrc: string | null
  rankData: RankData | null
  profileIconSrc: string | null
  hasMatchDetails: boolean
  onSelect: (game: Game) => void
  onHover: (matchId: string) => void
}) => {
  const now = useLiveTime()

  const handleClick = useCallback(() => onSelect(game), [onSelect, game])
  const handleHover = useCallback(() => onHover(game.matchId), [onHover, game.matchId])

  const normalizedEndTs = normalizeEndTs(game.endTs ?? null)
  const when = normalizedEndTs ? timeAgo(normalizedEndTs, now) : '—'
  const name = player ? displayRiotId(player) : 'Unknown'
  
  const isRemake = game.endType === 'REMAKE'
  
  const kdaValue = game.d > 0 ? (game.k + game.a) / game.d : 99
  const kda = game.d === 0 ? 'Perfect' : kdaValue.toFixed(1)
  
  const kdaColor = (() => {
    if (isRemake) return 'text-slate-400'
    if (game.d === 0) return 'text-yellow-600 font-black dark:text-yellow-400'
    return getKdaColor(kdaValue)
  })()
  
  const duration = formatMatchDuration(game.durationS)
  const lpChange = (() => {
    const val = typeof game.lpChange === 'number' && !Number.isNaN(game.lpChange) ? game.lpChange : null
    return val
  })()
  const lpNote = game.lpNote?.toUpperCase() ?? null
  
  const rankIcon = getRankIconSrc(rankData?.tier)
  const rankLabel = formatTierShort(rankData?.tier, rankData?.rank)
  
  const lpTitle = (() => {
    return lpChange !== null 
      ? (lpChange === 0 ? 'LP change: — 0 LP' : `LP change: ${lpChange >= 0 ? '+' : ''}${lpChange} LP`)
      : `Rank at match time unavailable. Displaying current rank: ${rankLabel}`
  })()
  
  const lpHoverLabel = (() => {
    return lpChange !== null 
      ? (lpChange === 0 ? '— 0 LP' : `${lpChange >= 0 ? '▲ ' : '▼ '}${Math.abs(lpChange)} LP`)
      : null
  })()
  
  const resultBorderClasses = (() => {
    if (isRemake) {
      return 'border-l-slate-300 border-y border-r border-slate-200 hover:border-slate-300 dark:border-slate-600/60 dark:hover:border-slate-500/80'
    }
    return game.win
      ? 'border-l-emerald-400 border-y border-r border-emerald-100 hover:border-emerald-200 dark:border-emerald-500/40 dark:hover:border-emerald-400/60'
      : 'border-l-rose-400 border-y border-r border-rose-100 hover:border-rose-200 dark:border-rose-500/40 dark:hover:border-rose-400/60'
  })()

  const lpBadge = lpChange !== null ? (
    lpNote ? (
      <span
        title={lpTitle}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${formatLpNote(
          lpNote,
          isRemake,
        )}`}
      >
        <span className="group-hover:hidden">
          {lpNote === 'PROMOTED' || lpNote === 'DEMOTED' ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-[11px] leading-none">{lpNote === 'PROMOTED' ? '▲' : '▼'}</span>
              {rankIcon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={rankIcon} alt="" width={12} height={12} className="h-3 w-3 object-contain" loading="lazy" />
              )}
              <span>{rankLabel}</span>
            </span>
          ) : (
            lpNote
          )}
        </span>
        {lpHoverLabel && <span className="hidden group-hover:inline">{lpHoverLabel}</span>}
      </span>
    ) : (
      <span
        title={lpTitle}
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums ${
          lpChange === 0
            ? 'text-slate-500 bg-slate-100 dark:text-slate-300 dark:bg-slate-700/50'
            : lpChange > 0
              ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/20'
              : 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/20'
        }`}
      >
        {lpChange === 0 ? (
          '— 0 LP'
        ) : (
          <>
            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              {lpChange > 0 ? <path d="M10 4l6 8H4l6-8z" /> : <path d="M10 16l-6-8h12l-6 8z" />}
            </svg>
            {Math.abs(lpChange)} LP
          </>
        )}
      </span>
    )
  ) : (
    <span
      title={lpTitle}
      className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700/50 dark:text-slate-300"
    >
      {rankIcon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={rankIcon} alt="" width={12} height={12} className="h-3 w-3 object-contain" loading="lazy" />
      )}
      {rankLabel} <span className="text-[9px] opacity-70">(N/A)</span>
    </span>
  )
  
  return (
    <div
      className={`rounded-xl border-l-4 bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-lg hover:scale-[1.01] dark:bg-slate-900 ${resultBorderClasses}`}
    >
      <button
        type="button"
        className="group w-full text-left disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:ring-offset-2 rounded-lg dark:focus:ring-offset-slate-900"
        onClick={handleClick}
        onMouseEnter={hasMatchDetails ? handleHover : undefined}
        disabled={!hasMatchDetails}
      >
        <div className="flex items-center gap-3">
          <div className="relative h-11 w-11 shrink-0">
            {champSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={champSrc}
                alt=""
                width={44}
                height={44}
                loading="lazy"
                className="h-full w-full rounded-lg bg-slate-100 object-cover border-2 border-slate-200 shadow-sm transition-transform duration-200 group-hover:scale-110 dark:border-slate-700 dark:bg-slate-800"
              />
            )}
            {profileIconSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profileIconSrc}
                alt=""
                width={22}
                height={22}
                className="absolute -bottom-1 -right-1 h-5.5 w-5.5 rounded-full border-2 border-white bg-slate-100 object-cover shadow-sm dark:border-slate-900 dark:bg-slate-800"
                loading="lazy"
              />
            ) : null}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400" title="View match history">
                <span className="truncate">{name}</span>
              </span>
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className="text-[10px] text-slate-400 font-medium dark:text-slate-500">{when}</span>
                {lpBadge}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] border-t border-slate-100 pt-2 mt-2 -mb-1 dark:border-slate-800">
          {duration && (
            <>
              <span className="font-semibold text-slate-600 tabular-nums dark:text-slate-300">{duration}</span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
            </>
          )}
          
          {isRemake ? (
            <span className="font-bold text-slate-400 dark:text-slate-500">REMAKE</span>
          ) : (
            <>
              <span className="font-bold text-slate-700 tabular-nums dark:text-slate-200 whitespace-nowrap">
                {game.k}/{game.d}/{game.a}
              </span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className={`tabular-nums whitespace-nowrap ${kdaColor}`}>
                {kda === 'Perfect' ? 'Perfect' : `${kda} KDA`}
              </span>
              <span className="text-slate-300 dark:text-slate-600">•</span>
              <span className="font-semibold text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">{game.cs} CS</span>
            </>
          )}
          
          {hasMatchDetails && (
            <div className="relative ml-auto flex items-center justify-center w-5 h-5 shrink-0">
              <svg 
                className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:text-blue-600 group-hover:translate-x-1 dark:text-slate-500 dark:group-hover:text-blue-400" 
                viewBox="0 0 20 20" 
                fill="currentColor"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              
              <div className="absolute right-full mr-2 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200">
                <span className="font-medium text-[10px] text-slate-600 whitespace-nowrap bg-white px-2 py-1 rounded shadow-sm border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                  View details
                </span>
              </div>
            </div>
          )}
        </div>
      </button>
    </div>
  )
}, (prev, next) => {
  // Custom comparison function for better memoization
  return (
    prev.game.matchId === next.game.matchId &&
    prev.game.puuid === next.game.puuid &&
    prev.game.endTs === next.game.endTs &&
    prev.game.lpChange === next.game.lpChange &&
    prev.game.lpNote === next.game.lpNote &&
    prev.hasMatchDetails === next.hasMatchDetails &&
    prev.onSelect === next.onSelect &&
    prev.onHover === next.onHover &&
    prev.player?.id === next.player?.id &&
    prev.rankData?.tier === next.rankData?.tier &&
    prev.rankData?.rank === next.rankData?.rank
  )
})

GameItem.displayName = 'GameItem'

export default function LatestGamesFeedClient({
  games,
  playersByPuuid,
  champMap,
  ddVersion,
  rankByPuuid,
  playerIconsByPuuid,
  participantsByMatch,
  preloadedMatchData = {},
}: {
  games: Game[]
  playersByPuuid: Record<string, Player>
  champMap: Record<number, Champion>
  ddVersion: string
  rankByPuuid: Record<string, RankData | null>
  playerIconsByPuuid: Record<string, number | null>
  participantsByMatch: Record<string, MatchParticipant[]>
  preloadedMatchData?: Record<string, PreloadedMatchData>
}) {
  const router = useRouter()
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)
  const [isInitializing, setIsInitializing] = useState(games.length === 0)
  const { prefetchMatch, getPrefetchedData } = useMatchPrefetch()
  const prefetchedMatches = useRef<Set<string>>(new Set())
  const participantsByMatchRef = useRef(participantsByMatch)
  const initRefreshTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    participantsByMatchRef.current = participantsByMatch
  }, [participantsByMatch])

  useEffect(() => {
    if (games.length > 0) {
      setIsInitializing(false)
      if (initRefreshTimeoutRef.current !== null) {
        window.clearTimeout(initRefreshTimeoutRef.current)
        initRefreshTimeoutRef.current = null
      }
    }
  }, [games.length])

  // Keep feed fresh in production without manual refresh
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        router.refresh()
      }
    }

    refreshIfVisible()
    if (games.length === 0) {
      initRefreshTimeoutRef.current = window.setTimeout(() => {
        setIsInitializing(false)
        initRefreshTimeoutRef.current = null
      }, 2000)
    }

    const interval = window.setInterval(refreshIfVisible, FEED_REFRESH_INTERVAL_MS)

    window.addEventListener('focus', refreshIfVisible)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshIfVisible)
      if (initRefreshTimeoutRef.current !== null) {
        window.clearTimeout(initRefreshTimeoutRef.current)
        initRefreshTimeoutRef.current = null
      }
    }
  }, [router, games.length])

  // Prefetch on hover only; avoid eager network work on initial page load

  const handleGameHover = useCallback((matchId: string) => {
    if (!matchId || participantsByMatchRef.current[matchId]?.length === 0) return
    if (prefetchedMatches.current.has(matchId)) return
    void import('./MatchDetailsModal').then((mod) => mod.preloadStaticData(ddVersion))
    prefetchMatch(matchId)
    prefetchedMatches.current.add(matchId)
  }, [prefetchMatch, ddVersion])

  const gameIds = useMemo(
    () => games.map((g) => `${g.matchId}${g.puuid}`).join(','),
    [games]
  )

  const gameItemsData = useMemo(() => {
    return games.map((g) => {
      const player = playersByPuuid?.[g.puuid] ?? null
      const champ = champMap[g.championId]
      const champSrc = champ ? championIconUrl(ddVersion, champ.id) : null
      const rankData = rankByPuuid?.[g.puuid] ?? null
      const profileIconId = playerIconsByPuuid?.[g.puuid] ?? null
      const profileIconSrc = profileIconId
        ? `https://ddragon.leagueoflegends.com/cdn/${ddVersion}/img/profileicon/${profileIconId}.png`
        : null
      const hasMatchDetails = (participantsByMatch[g.matchId] ?? []).length > 0

      return {
        game: g,
        player,
        champSrc,
        rankData,
        profileIconSrc,
        hasMatchDetails,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameIds, ddVersion])

  const handleSelectGame = useCallback((game: Game) => {
    setSelectedGame(game)
  }, [])

  const handleCloseModal = useCallback(() => {
    setSelectedGame(null)
  }, [])

  const selectedParticipants = useMemo(() => {
    return selectedGame ? participantsByMatch[selectedGame.matchId] ?? [] : []
  }, [selectedGame, participantsByMatch])

  if (games.length === 0 && isInitializing) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="space-y-2 animate-pulse">
          <div className="h-3 w-20 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-9 rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
    )
  }

  if (games.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-gradient-to-br from-slate-50 to-white p-10 text-center dark:border-slate-700 dark:from-slate-900 dark:to-slate-950">
        <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <svg className="h-8 w-8 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-600 dark:text-slate-300 mb-1">No recent matches</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">Check back soon for the latest activity</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-2.5">
        {gameItemsData.map((item) => (
          <GameItem
            key={`${item.game.matchId}-${item.game.puuid}`}
            game={item.game}
            player={item.player}
            champSrc={item.champSrc}
            rankData={item.rankData}
            profileIconSrc={item.profileIconSrc}
            hasMatchDetails={item.hasMatchDetails}
            onSelect={handleSelectGame}
            onHover={handleGameHover}
          />
        ))}
      </div>
      
      <MatchDetailsModal
        open={Boolean(selectedGame)}
        matchId={selectedGame?.matchId ?? null}
        focusedPuuid={selectedGame?.puuid ?? null}
        champMap={champMap}
        ddVersion={ddVersion}
        participants={selectedParticipants}
        onClose={handleCloseModal}
        preloadedData={selectedGame && preloadedMatchData[selectedGame.matchId] 
          ? preloadedMatchData[selectedGame.matchId]
          : selectedGame ? getPrefetchedData(selectedGame.matchId) : undefined}
      />
    </>
  )
}
