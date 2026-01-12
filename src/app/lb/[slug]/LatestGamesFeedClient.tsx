'use client'

import { useState } from 'react'
import { championIconUrl } from '@/lib/champions'
import { formatMatchDuration, getKdaColor } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'
import MatchDetailsModal from './MatchDetailsModal'

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

function formatLpNote(lpNote: string | null, isRemake: boolean) {
  if (lpNote === 'PROMOTED') return 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/20'
  if (isRemake) return 'text-slate-500 bg-slate-100 dark:text-slate-200 dark:bg-slate-700/40'
  return 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/20'
}

export default function LatestGamesFeedClient({
  games,
  playersByPuuid,
  champMap,
  ddVersion,
  rankByPuuid,
  participantsByMatch,
}: {
  games: Game[]
  playersByPuuid: Record<string, Player>
  champMap: any
  ddVersion: string
  rankByPuuid: Record<string, any>
  participantsByMatch: Record<string, MatchParticipant[]>
}) {
  const [selectedGame, setSelectedGame] = useState<Game | null>(null)

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
    <>
      <div className="space-y-2.5">
        {games.map((g) => {
          const player = playersByPuuid[g.puuid]
          const opggUrl = player ? getOpggUrl(player) : null
          const name = player ? displayRiotId(player) : 'Unknown'
          const when = g.endTs ? timeAgo(g.endTs) : ''
          const champ = champMap[g.championId]
          const champSrc = champ ? championIconUrl(ddVersion, champ.id) : null
          const kdaValue = g.d > 0 ? (g.k + g.a) / g.d : 99
          const kda = g.d === 0 ? 'Perfect' : kdaValue.toFixed(1)
          const kdaColor = g.d === 0 ? 'text-amber-600 font-black' : getKdaColor(kdaValue)
          const duration = formatMatchDuration(g.durationS)
          const lpChange = typeof g.lpChange === 'number' && !Number.isNaN(g.lpChange) ? g.lpChange : null
          const lpNote = g.lpNote?.toUpperCase() ?? null
          const rankData = rankByPuuid[g.puuid]
          const rankIcon = getRankIconSrc(rankData?.tier)
          const rankLabel = formatTierShort(rankData?.tier, rankData?.rank)
          const isRemake = g.endType === 'REMAKE'
          const lpTitle =
            lpChange !== null ? `LP change: ${lpChange >= 0 ? '+' : ''}${lpChange} LP` : 'LP change unavailable'
          const lpHoverLabel = lpChange !== null ? `${lpChange >= 0 ? '▲ ' : '▼ '}${Math.abs(lpChange)} LP` : 'LP'
          const resultBorderClasses = isRemake
            ? 'border-l-slate-300 border-y border-r border-slate-200 hover:border-slate-300 dark:border-slate-600/60 dark:hover:border-slate-500/80'
            : g.win
              ? 'border-l-emerald-400 border-y border-r border-emerald-100 hover:border-emerald-200 dark:border-emerald-500/40 dark:hover:border-emerald-400/60'
              : 'border-l-rose-400 border-y border-r border-rose-100 hover:border-rose-200 dark:border-rose-500/40 dark:hover:border-rose-400/60'
          const hasMatchDetails = (participantsByMatch[g.matchId] ?? []).length > 0

          return (
            <div
              key={`${g.matchId}-${g.puuid}`}
              className={`rounded-xl border-l-4 bg-white p-3 shadow-sm transition-all duration-200 hover:shadow-md dark:bg-slate-900 ${resultBorderClasses}`}
            >
              <button
                type="button"
                className="group w-full text-left disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => setSelectedGame(g)}
                disabled={!hasMatchDetails}
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
                    <div className="flex items-start justify-between gap-2">
                      {opggUrl ? (
                        <a
                          href={opggUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 hover:text-blue-600 dark:text-slate-100 dark:hover:text-blue-400"
                          title="View on OP.GG"
                        >
                          {name}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                          {name}
                        </span>
                      )}
                      <span className="shrink-0 text-[10px] text-slate-400 font-medium dark:text-slate-500">
                        {when}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[11px] text-slate-600 font-medium dark:text-slate-300">
                        {champ?.name || 'Unknown'}
                      </span>
                      {lpChange !== null ? (
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
                                    <img src={rankIcon} alt="" className="h-3 w-3 object-contain" />
                                  )}
                                  <span>{rankLabel}</span>
                                </span>
                              ) : (
                                lpNote
                              )}
                            </span>
                            <span className="hidden group-hover:inline">{lpHoverLabel}</span>
                          </span>
                        ) : (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide tabular-nums ${
                              lpChange >= 0
                                ? 'text-emerald-700 bg-emerald-50 dark:text-emerald-200 dark:bg-emerald-500/20'
                                : 'text-rose-700 bg-rose-50 dark:text-rose-200 dark:bg-rose-500/20'
                            }`}
                          >
                            <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                              {lpChange >= 0 ? <path d="M10 4l6 8H4l6-8z" /> : <path d="M10 16l-6-8h12l-6 8z" />}
                            </svg>
                            {Math.abs(lpChange)} LP
                          </span>
                        )
                      ) : (
                        <span
                          title={lpTitle}
                          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-700/50 dark:text-slate-300"
                        >
                          - LP
                        </span>
                      )}
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
                  <span className="font-bold text-slate-700 tabular-nums dark:text-slate-200 whitespace-nowrap">
                    {g.k}/{g.d}/{g.a}
                  </span>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span className={`tabular-nums whitespace-nowrap ${kdaColor}`}>{kda} KDA</span>
                  <span className="text-slate-300 dark:text-slate-600">•</span>
                  <span className="font-semibold text-slate-600 tabular-nums whitespace-nowrap dark:text-slate-300">{g.cs} CS</span>
                  
                  {hasMatchDetails && (
                    <div className="relative ml-auto flex items-center justify-center w-5 h-5 shrink-0">
                      {/* Chevron that's always visible */}
                      <svg 
                        className="h-4 w-4 text-slate-400 transition-all duration-200 group-hover:text-blue-600 group-hover:translate-x-1 dark:text-slate-500 dark:group-hover:text-blue-400" 
                        viewBox="0 0 20 20" 
                        fill="currentColor"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      
                      {/* Overlay text that appears on hover */}
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
        })}
      </div>
      <MatchDetailsModal
        open={Boolean(selectedGame)}
        matchId={selectedGame?.matchId ?? null}
        focusedPuuid={selectedGame?.puuid ?? null}
        champMap={champMap}
        ddVersion={ddVersion}
        onClose={() => setSelectedGame(null)}
      />
    </>
  )
}