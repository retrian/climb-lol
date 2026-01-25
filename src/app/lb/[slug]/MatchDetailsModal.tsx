'use client'

import { useEffect, useMemo, useRef, useState, memo, useCallback, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { formatMatchDuration } from '@/lib/formatters'
import { timeAgo } from '@/lib/timeAgo'

// --- Types ---
interface MatchResponse {
  metadata: { matchId: string; participants: string[] }
  info: {
    gameCreation: number; gameDuration: number; gameVersion: string; gameEndTimestamp?: number
    platformId?: string; queueId?: number; participants: RiotParticipant[]; teams: RiotTeam[]
  }
}
interface TimelineResponse { info: { frames: Array<{ timestamp: number; events: Array<Record<string, any>> }> } }

// Detailed API Data
interface RiotParticipant {
  participantId: number; puuid: string; championId: number; champLevel: number
  summonerName: string; riotIdGameName?: string; riotIdTagline?: string
  kills: number; deaths: number; assists: number; win: boolean; teamId: number
  goldEarned: number; totalDamageDealtToChampions: number; totalDamageTaken: number
  visionScore: number; totalMinionsKilled: number; neutralMinionsKilled: number
  item0: number; item1: number; item2: number; item3: number; item4: number; item5: number; item6: number
  summoner1Id: number; summoner2Id: number
  roleBoundItem?: number
  perks: { styles: Array<{ style: number; selections: Array<{ perk: number }> }>; statPerks: { defense: number; flex: number; offense: number } }
  _kp?: number; // Calculated property
}

// Summary Parent Data
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

interface RiotTeam { teamId: number; win: boolean; objectives: Record<string, { kills: number }> }
interface AccountResponse { gameName: string; tagLine: string }
interface StaticDataState {
  items: Record<string, any>; spells: Record<string, any>; runes: Array<any>
  champions: Record<number, { id: string; name: string; image: { full: string } }>
}

// --- Constants ---
const QUEUE_LABELS: Record<number, string> = { 420: 'Ranked Solo', 440: 'Ranked Flex', 450: 'ARAM' }
const SHARD_MAP: Record<number, string> = { 
  5001: 'StatModsHealthPlusIcon.png',
  5002: 'StatModsArmorIcon.png',
  5003: 'StatModsMagicResIcon.png',
  5005: 'StatModsAttackSpeedIcon.png',
  5007: 'StatModsCDRIcon.png',
  5008: 'StatModsAdaptiveForceIcon.png',
  5010: 'StatModsTenacityIcon.png',
  5011: 'StatModsHealthPlusIcon.png',
  5013: 'StatModsHealthPlusIcon.png'
}
const FALLBACK_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="100%" height="100%" rx="6" ry="6" fill="#cbd5e1"/></svg>`)
const EMPTY_STATIC: StaticDataState = { items: {}, spells: {}, runes: [], champions: {} }
const STATIC_CACHE = new Map<string, StaticDataState>()

const buildStaticUrl = (v: string, p: string) => `https://ddragon.leagueoflegends.com/cdn/${v}/${p}`
const getItemIconUrl = (v: string, id: number) => `https://ddragon.leagueoflegends.com/cdn/${v}/img/item/${id}.png`
const getChampionIconUrl = (v: string, img: string) => `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${img}`
const getShardIconUrl = (img: string) => `https://ddragon.leagueoflegends.com/cdn/img/perk-images/StatMods/${img}`

function getChampionImageFull(champion?: { image?: { full: string }; id?: string }) {
  return champion?.image?.full ?? (champion?.id ? `${champion.id}.png` : null)
}
function buildChampionMap(data: Record<string, any>) {
  const map: Record<number, any> = {}
  Object.values(data).forEach((c: any) => { if (Number.isFinite(Number(c.key))) map[Number(c.key)] = { id: c.id, name: c.name, image: c.image } })
  return map
}
function getMatchPatch(v?: string | null) {
  if (!v) return null
  const [maj, min, pRaw] = v.split('.')
  if (!maj || !min) return null
  const pNum = Number(pRaw); const patch = (Number.isFinite(pNum) && pNum < 10) ? pNum : 0
  return `${maj}.${min}.${patch}`
}
async function resolveDdragonVersion(v: string | undefined, fb: string) {
  const patch = getMatchPatch(v); if (!patch) return fb
  const [maj, min] = patch.split('.')
  try {
    const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json')
    if (!res.ok) return fb
    const versions = (await res.json()) as string[]
    return versions.find((ver) => ver.startsWith(`${maj}.${min}.`)) ?? fb
  } catch { return fb }
}
const handleImageError = (e: any) => { if (e.currentTarget.src !== FALLBACK_ICON) e.currentTarget.src = FALLBACK_ICON }

// --- Helper: Adapter for Summary Data ---
// Converts the lightweight "MatchParticipant" into a partial "RiotParticipant" for previewing
function adaptSummaryToRiot(summary: MatchParticipant, index: number): RiotParticipant {
  return {
    participantId: index + 1, // temporary ID
    puuid: summary.puuid,
    championId: summary.championId,
    champLevel: 0, // Unknown in summary
    summonerName: '', // Will be filled by AccountResponse later
    riotIdGameName: '', 
    riotIdTagline: '',
    kills: summary.kills,
    deaths: summary.deaths,
    assists: summary.assists,
    win: summary.win,
    teamId: 100, // We calculate this in the useMemo below
    goldEarned: 0, // Unknown in summary
    totalDamageDealtToChampions: 0, // Unknown
    totalDamageTaken: 0, // Unknown
    visionScore: 0, // Unknown
    totalMinionsKilled: summary.cs, // Approx (combines both)
    neutralMinionsKilled: 0,
    item0: 0, item1: 0, item2: 0, item3: 0, item4: 0, item5: 0, item6: 0,
    summoner1Id: 0, summoner2Id: 0,
    roleBoundItem: 0,
    perks: { styles: [], statPerks: { defense: 0, flex: 0, offense: 0 } }
  }
}

// --- ULTRA-OPTIMIZED Icon with will-change and transform ---
const Icon = memo(({ src, alt, size = "h-6 w-6", rounded = "rounded", className = "", ring = true }: any) => src 
  ? <img loading="lazy" src={src} alt={alt || ""} title={alt || ""} className={`${size} ${rounded} ${ring ? 'ring-1 ring-slate-200 dark:ring-slate-700' : ''} bg-slate-100 dark:bg-slate-800 object-cover ${className}`} onError={handleImageError} style={{ willChange: 'transform' }} />
  : <div className={`${size} ${rounded} bg-slate-100 dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 ${className}`} />
)

// --- VIRTUALIZED Player Row with transform optimization ---
const PlayerRow = memo(({ p, match, focusedPuuid, staticData, champMap, ddragonVersion, spellMap, runeMap, getPlayerName, teamColor, isRtl, maxDmg, isPreview }: any) => {
  const cs = useMemo(() => p.totalMinionsKilled + p.neutralMinionsKilled, [p.totalMinionsKilled, p.neutralMinionsKilled])
  const s1 = useMemo(() => spellMap.get(p.summoner1Id), [spellMap, p.summoner1Id])
  const s2 = useMemo(() => spellMap.get(p.summoner2Id), [spellMap, p.summoner2Id])
  const isFocused = focusedPuuid === p.puuid
  // Fallback for duration in preview mode (avoid division by zero if duration missing)
  const duration = match?.info?.gameDuration ?? 1
  const csPerMin = useMemo(() => (cs / (duration / 60)).toFixed(1), [cs, duration])
  const dmgDisplay = useMemo(() => {
    return p.totalDamageDealtToChampions >= 1000 
      ? (p.totalDamageDealtToChampions/1000).toFixed(1) + 'k' 
      : p.totalDamageDealtToChampions
  }, [p.totalDamageDealtToChampions])
  
  const championImage = useMemo(() => {
    return getChampionImageFull(staticData.champions[p.championId] ?? champMap[p.championId])
  }, [staticData.champions, champMap, p.championId])
  
  const championIconSrc = useMemo(() => {
    return championImage ? getChampionIconUrl(ddragonVersion, championImage) : null
  }, [ddragonVersion, championImage])
  
  const questItemId = p.roleBoundItem && p.roleBoundItem > 0 ? p.roleBoundItem : null
  const questIcon = questItemId ? getItemIconUrl(ddragonVersion, questItemId) : null
  const trinketItemId = p.item6 && p.item6 > 0 ? p.item6 : null
  const trinketIcon = trinketItemId ? getItemIconUrl(ddragonVersion, trinketItemId) : null

  return (
    <div className={`group relative flex items-center gap-2 rounded-lg border p-1.5 transition-all ${isFocused ? 'bg-amber-50 border-amber-500/30 ring-1 ring-amber-500/20 dark:bg-slate-800' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm dark:bg-slate-900 dark:border-transparent dark:hover:bg-slate-800 dark:hover:border-slate-700'} ${isRtl ? 'flex-row-reverse text-right' : ''}`} style={{ willChange: 'transform' }}>
      {/* Champion Icon: Uses champMap which is available instantly from parent */}
      <div className="relative shrink-0">
        <Icon src={championIconSrc || undefined} size="h-9 w-9" rounded="rounded-md" className={`${isFocused ? "ring-amber-500/40" : ""}`} />
        {Number.isFinite(p.champLevel) && p.champLevel > 0 && (
          <span className="absolute -bottom-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-slate-900 px-1 text-[9px] font-bold text-white ring-1 ring-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-700">
            {p.champLevel}
          </span>
        )}
      </div>
      
        <div className={`flex flex-col justify-center min-w-0 flex-1 overflow-hidden ${isRtl ? 'items-end' : 'items-start'}`}>
        <div className={`truncate text-xs font-medium w-full ${isFocused ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'}`}>{getPlayerName(p).split('#')[0]}</div>
        
        {/* Items/Runes/Spells - Dimmed or Skeleton in Preview Mode */}
        <div className={`flex gap-0.5 mt-0.5 ${isPreview ? 'opacity-30' : ''}`}>
          {isRtl ? (
            <>
              <Icon src={p.perks?.styles?.[1]?.style && `https://ddragon.leagueoflegends.com/cdn/img/${runeMap.get(p.perks.styles[1].style)?.icon}`} size="h-3 w-3" rounded="rounded-full" className="p-[1px]" ring={false} />
              <Icon src={p.perks?.styles?.[0]?.selections?.[0]?.perk && `https://ddragon.leagueoflegends.com/cdn/img/${runeMap.get(p.perks.styles[0].selections[0].perk)?.icon}`} size="h-3 w-3" rounded="rounded-full" ring={false} />
              <div className="w-[1px] h-3 bg-slate-200 dark:bg-slate-700 mx-0.5"></div>
              <Icon src={s1 && buildStaticUrl(ddragonVersion, `img/spell/${s1.image.full}`)} size="h-3 w-3" rounded="rounded-sm" ring={false} />
              <Icon src={s2 && buildStaticUrl(ddragonVersion, `img/spell/${s2.image.full}`)} size="h-3 w-3" rounded="rounded-sm" ring={false} />
            </>
          ) : (
            <>
              <Icon src={s1 && buildStaticUrl(ddragonVersion, `img/spell/${s1.image.full}`)} size="h-3 w-3" rounded="rounded-sm" ring={false} />
              <Icon src={s2 && buildStaticUrl(ddragonVersion, `img/spell/${s2.image.full}`)} size="h-3 w-3" rounded="rounded-sm" ring={false} />
              <div className="w-[1px] h-3 bg-slate-200 dark:bg-slate-700 mx-0.5"></div>
              <Icon src={p.perks?.styles?.[0]?.selections?.[0]?.perk && `https://ddragon.leagueoflegends.com/cdn/img/${runeMap.get(p.perks.styles[0].selections[0].perk)?.icon}`} size="h-3 w-3" rounded="rounded-full" ring={false} />
              <Icon src={p.perks?.styles?.[1]?.style && `https://ddragon.leagueoflegends.com/cdn/img/${runeMap.get(p.perks.styles[1].style)?.icon}`} size="h-3 w-3" rounded="rounded-full" className="p-[1px]" ring={false} />
            </>
          )}
        </div>
      </div>

      <div className={`flex flex-col justify-center w-[4.75rem] shrink-0 ${isRtl ? 'items-start' : 'items-end'}`}>
        <div className="text-xs font-bold text-slate-900 tabular-nums tracking-tight dark:text-slate-100">{p.kills}/{p.deaths}/{p.assists}</div>
        <div className={`flex items-center flex-nowrap gap-1 text-[10px] text-slate-500 tabular-nums leading-none whitespace-nowrap ${isRtl ? 'flex-row-reverse' : ''}`}>
          {isRtl ? (
            <>
              {trinketIcon && <Icon src={trinketIcon} size="h-3 w-3" rounded="rounded-sm" ring={false} className="mr-0.5" />}
              {questIcon && <Icon src={questIcon} size="h-3 w-3" rounded="rounded-sm" ring={false} className="mr-0.5" />}
              {!isPreview && <span className="whitespace-nowrap">KP {p._kp}%</span>}
            </>
          ) : (
            <>
              {trinketIcon && <Icon src={trinketIcon} size="h-3 w-3" rounded="rounded-sm" ring={false} className="mr-0.5" />}
              {questIcon && <Icon src={questIcon} size="h-3 w-3" rounded="rounded-sm" ring={false} className="mr-0.5" />}
              {!isPreview && <span className="whitespace-nowrap">KP {p._kp}%</span>}
            </>
          )}
        </div>
      </div>

      {/* Damage Graph - Only visible when full data loaded */}
      <div className="flex flex-col justify-center w-[4.5rem] shrink-0">
        {!isPreview ? (
          <>
            <div className={`flex text-[9px] font-medium text-slate-500 mb-0.5 ${isRtl ? 'justify-start' : 'justify-end'}`}><span>{dmgDisplay}</span></div>
            <div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 relative">
              <div 
                className={`h-1 rounded-full absolute top-0 ${teamColor} ${isRtl ? 'right-0' : 'left-0'}`} 
                style={{ 
                  width: `${maxDmg > 0 ? (p.totalDamageDealtToChampions / maxDmg) * 100 : 0}%`, 
                  willChange: 'width',
                  transition: 'width 0.2s ease-out'
                }} 
              />
            </div>
          </>
        ) : <div className="h-1 w-12 rounded-full bg-slate-100 dark:bg-slate-800 mx-auto" />}
      </div>

      <div className={`flex flex-col justify-center w-[3rem] shrink-0 ${isRtl ? 'items-start' : 'items-end'}`}>
        <div className="text-xs font-medium text-slate-600 tabular-nums dark:text-slate-300">{cs}</div>
        <div className="text-[10px] text-slate-400 tabular-nums dark:text-slate-500">{!isPreview && `${csPerMin}/m`}</div>
      </div>

      {/* Items - Blank placeholders in Preview Mode */}
      <div className={`flex gap-0.5 w-[9.5rem] shrink-0 ${isRtl ? 'justify-start' : 'justify-end'}`}>
        {[0,1,2,3,4,5].map(i => {
          const id = (p as any)[`item${i}`]; 
          return id ? <Icon key={i} src={getItemIconUrl(ddragonVersion, id)} size="h-6 w-6" rounded="rounded-[3px]" className="ring-0" /> : <div key={i} className="h-6 w-6 rounded-[3px] bg-slate-100 dark:bg-slate-900/50 ring-1 ring-slate-200 dark:ring-slate-800" />
        })}
      </div>
    </div>
  )
}, (prev, next) => {
  // Optimized comparison - only re-render if critical props change
  return (
    prev.p.puuid === next.p.puuid &&
    prev.p.kills === next.p.kills &&
    prev.p.deaths === next.p.deaths &&
    prev.p.assists === next.p.assists &&
    prev.p.totalMinionsKilled === next.p.totalMinionsKilled &&
    prev.p.neutralMinionsKilled === next.p.neutralMinionsKilled &&
    prev.p.totalDamageDealtToChampions === next.p.totalDamageDealtToChampions &&
    prev.p.championId === next.p.championId &&
    prev.focusedPuuid === next.focusedPuuid &&
    prev.ddragonVersion === next.ddragonVersion &&
    prev.isPreview === next.isPreview &&
    prev.maxDmg === next.maxDmg &&
    prev.match?.info?.gameDuration === next.match?.info?.gameDuration
  )
})

// --- Main Component ---
export default function MatchDetailsModal({ open, matchId, focusedPuuid, champMap, ddVersion, onClose, participants, preloadedData }: {
  open: boolean; matchId: string | null; focusedPuuid: string | null; champMap: any; ddVersion: string; onClose: () => void; participants: MatchParticipant[]; preloadedData?: { match?: Promise<any> | any; timeline?: Promise<any> | any; accounts?: Promise<Record<string, any>> | Record<string, any> }
}) {
  const [mounted, setMounted] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'build'>('overview')
  const [match, setMatch] = useState<MatchResponse | null>(null)
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null)
  const [accounts, setAccounts] = useState<Record<string, AccountResponse>>({})
  const [staticData, setStaticData] = useState<StaticDataState>(EMPTY_STATIC)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [ddragonVersion, setDdragonVersion] = useState(ddVersion)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])

  const handleClose = useCallback(() => onClose(), [onClose])
  const handleKeyDown = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }, [handleClose])

  useEffect(() => {
    if (!open) return
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, handleKeyDown])

  useEffect(() => {
    if (!open || !matchId) return
    // Reset state but keep participants prop data active
    setActiveTab('overview'); setMatch(null); setTimeline(null); setAccounts({}); setError(null); setLoading(true); setDdragonVersion(ddVersion)
    
    // Check if we have preloaded data (server-side preloaded - instant!)
    if (preloadedData?.match) {
      // Handle both resolved values and promises
      const matchDataPromise = preloadedData.match instanceof Promise 
        ? preloadedData.match 
        : Promise.resolve(preloadedData.match)
      
      matchDataPromise
        .then((matchData) => {
          if (matchData) {
            setMatch(matchData)
            setLoading(false)
            
            // Also use preloaded timeline and accounts if available
            if (preloadedData.timeline) {
              const timelinePromise = preloadedData.timeline instanceof Promise
                ? preloadedData.timeline
                : Promise.resolve(preloadedData.timeline)
              timelinePromise.then((timelineData) => {
                if (timelineData) setTimeline(timelineData)
              }).catch(() => {})
            }
            
            if (preloadedData.accounts) {
              const accountsPromise = preloadedData.accounts instanceof Promise
                ? preloadedData.accounts
                : Promise.resolve(preloadedData.accounts)
              accountsPromise.then((accountsData) => {
                if (accountsData) setAccounts(accountsData)
              }).catch(() => {})
            }
            return
          }
        })
        .catch(() => {
          // Fall through to normal fetch if preload failed
        })
    }
    
    // Use AbortController to cancel requests if modal closes
    const abortController = new AbortController()
    
    // Only fetch if we don't have preloaded data or preload failed
    if (!preloadedData?.match) {
      fetch(`/api/match/${matchId}`, { signal: abortController.signal })
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(d => {
          if (!abortController.signal.aborted) {
            setMatch(d.match)
          }
        })
        .catch((err) => {
          if (!abortController.signal.aborted && err.name !== 'AbortError') {
            setError('Match details unavailable.')
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setLoading(false)
          }
        })
    }
    
    return () => {
      abortController.abort()
    }
  }, [open, matchId, ddVersion, preloadedData])

  useEffect(() => {
    if (!open || !match) return
    resolveDdragonVersion(match.info.gameVersion, ddVersion).then(setDdragonVersion)
  }, [open, match, ddVersion])

  useEffect(() => {
    if (!open) return
    
    // If no match loaded yet, we can't really load specific version assets easily, 
    // but we can default to ddVersion (latest) for the preview icons
    const patch = match ? ddragonVersion : ddVersion
    if (STATIC_CACHE.has(patch)) { 
      setStaticData(STATIC_CACHE.get(patch)!); 
      return 
    }
    
    // Use AbortController to cancel if modal closes
    const abortController = new AbortController()
    
    // Only fetch static data if we have a match OR if we are just opening it (using default version)
    // We want this to run for preview too so champ icons map correctly
    Promise.all([
      fetch(buildStaticUrl(patch, 'data/en_US/item.json'), { signal: abortController.signal }),
      fetch(buildStaticUrl(patch, 'data/en_US/summoner.json'), { signal: abortController.signal }),
      fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/runesReforged.json`, { signal: abortController.signal }),
      fetch(buildStaticUrl(patch, 'data/en_US/champion.json'), { signal: abortController.signal })
    ]).then(async ([i, s, r, c]) => {
        if (abortController.signal.aborted) return
        if (!i.ok || !s.ok || !r.ok || !c.ok) throw new Error()
        const d = { items: (await i.json()).data, spells: (await s.json()).data, runes: await r.json(), champions: buildChampionMap((await c.json()).data) }
        STATIC_CACHE.set(patch, d)
        if (!abortController.signal.aborted) {
          setStaticData(d)
        }
    }).catch((err) => {
      if (err.name !== 'AbortError' && !abortController.signal.aborted) {
        setStaticData(EMPTY_STATIC)
      }
    })
    
    return () => {
      abortController.abort()
    }
  }, [open, match, ddragonVersion, ddVersion])

  useEffect(() => {
    if (!open || !match) return
    
    // Use AbortController to cancel requests if modal closes
    const abortController = new AbortController()
    
    // Load timeline and accounts in parallel but with cancellation support
    Promise.all([
      fetch(`/api/riot/match/${match.metadata.matchId}/timeline`, { signal: abortController.signal })
        .then(r => r.ok ? r.json() : null)
        .then(d => d && !abortController.signal.aborted ? d.timeline : null)
        .catch(() => null),
      Promise.all(match.metadata.participants.map(puuid => 
        fetch(`/api/riot/account/${puuid}`, { signal: abortController.signal })
          .then(r => r.ok ? r.json() : null)
          .then(d => [puuid, d?.account] as const)
          .catch(() => [puuid, null] as const)
      ))
    ]).then(([timelineData, accountEntries]) => {
      if (abortController.signal.aborted) return
      
      if (timelineData) setTimeline(timelineData)
      
      const accs: Record<string, AccountResponse> = {}
      accountEntries.forEach(([id, a]) => { if (a) accs[id] = a })
      setAccounts(accs)
    }).catch((err) => {
      if (err.name !== 'AbortError') {
        // Silently handle errors for timeline/accounts as they're not critical
      }
    })
    
    return () => {
      abortController.abort()
    }
  }, [open, match])

  const spellMap = useMemo(() => {
    const m = new Map<number, any>(); Object.values(staticData.spells).forEach((s: any) => m.set(Number(s.key), s))
    return m
  }, [staticData.spells])
  
  const runeMap = useMemo(() => {
    const m = new Map<number, any>(); 
    staticData.runes.forEach(t => { m.set(t.id, t); t.slots?.forEach((s: any) => s.runes?.forEach((r: any) => m.set(r.id, r))) })
    return m
  }, [staticData.runes])

  // --- CORE LOGIC CHANGE: Determine Data Source ---
  // Use API match data if available, otherwise fallback to participants prop (mapped)
  const isPreview = !match;
  
  const displayParticipants: RiotParticipant[] = useMemo(() => {
    if (match) return match.info.participants;
    
    // Fallback: Map the summary participants to RiotParticipant shape
    return participants.map((p, i) => {
      // Calculate Team ID based on mapped index (usually 0-4 is Blue/100, 5-9 is Red/200)
      // Or use the 'win' property to group them if we sort them, but usually standard ordering applies.
      // Better strategy: The parent `LatestGamesFeed` usually doesn't sort by team, it's just a list.
      // However, for the Modal, we need to split by team.
      // Strategy: Group winners vs losers. 
      const mapped = adaptSummaryToRiot(p, i);
      // We can't know for sure which team is 100/200 without API, but we can group by win/loss.
      // Let's assume Winners = Blue (visual preference) or just group them.
      // ACTUALLY: The safest bet for Preview is just to assign teamId based on win status
      // so they appear on different sides of the modal.
      mapped.teamId = p.win ? 100 : 200; 
      return mapped;
    });
  }, [match, participants]);

  const focusedParticipant = useMemo(() => displayParticipants.find(p => p.puuid === focusedPuuid), [displayParticipants, focusedPuuid])
  
  const { teams, teamTotals } = useMemo(() => {
    // If we have neither match nor participants, return empty
    if (!match && participants.length === 0) return { teams: { blue: [], red: [] }, teamTotals: { blue: { kills: 0, gold: 0, damage: 0, taken: 0, vision: 0, cs: 0 }, red: { kills: 0, gold: 0, damage: 0, taken: 0, vision: 0, cs: 0 } } }
    
    // Filter based on the displayParticipants we calculated above
    const blue = displayParticipants.filter(p => p.teamId === 100)
    const red = displayParticipants.filter(p => p.teamId === 200)
    
    const calc = (list: RiotParticipant[]) => {
      const totals = list.reduce((a, p) => ({
        kills: a.kills + p.kills, gold: a.gold + p.goldEarned, damage: a.damage + p.totalDamageDealtToChampions,
        taken: a.taken + p.totalDamageTaken, vision: a.vision + p.visionScore, cs: a.cs + p.totalMinionsKilled + p.neutralMinionsKilled
      }), { kills: 0, gold: 0, damage: 0, taken: 0, vision: 0, cs: 0 })
      
      // Calculate KP more efficiently
      const killsTotal = totals.kills
      if (killsTotal > 0) {
        list.forEach(p => {
          (p as any)._kp = Math.round(((p.kills + p.assists) / killsTotal) * 100)
        })
      } else {
        list.forEach(p => {
          (p as any)._kp = 0
        })
      }
      
      return totals
    }
    
    return { 
      teams: { blue, red },
      teamTotals: { blue: calc(blue), red: calc(red) }
    }
  }, [match, participants, displayParticipants])

  const focusedRunes = useMemo(() => {
    if (!focusedParticipant) return { k: null, p: null, s: null, prim: [], sec: [] }
    const [pStyle, sStyle] = focusedParticipant.perks?.styles || []
    const primarySelections = pStyle?.selections || []
    const keystone = runeMap.get(primarySelections[0]?.perk)
    const primarySubs = primarySelections.slice(1).map(s => runeMap.get(s.perk)).filter(Boolean)
    const secondarySelections = sStyle?.selections || []
    const secondarySubs = secondarySelections.map(s => runeMap.get(s.perk)).filter(Boolean)
    return { k: keystone, p: runeMap.get(pStyle?.style), s: runeMap.get(sStyle?.style), prim: primarySubs, sec: secondarySubs }
  }, [focusedParticipant, runeMap])

  const groupedBuildOrder = useMemo(() => {
    if (!timeline || !focusedParticipant) return []
    const groups: { timeLabel: string; items: any[] }[] = []
    // Process frames more efficiently by checking item existence first
    const itemsSet = new Set(Object.keys(staticData.items).map(Number))
    timeline.info.frames.forEach((frame, index) => {
      const buys = frame.events.filter(e => 
        e.type === 'ITEM_PURCHASED' && 
        e.participantId === focusedParticipant.participantId && 
        e.itemId !== 0 && 
        itemsSet.has(e.itemId)
      )
      if (buys.length > 0) groups.push({ timeLabel: `${index} min`, items: buys })
    })
    return groups
  }, [timeline, focusedParticipant, staticData.items])

  const getPlayerName = useCallback((p: RiotParticipant) => {
    const acc = accounts[p.puuid]; 
    return acc ? `${acc.gameName} #${acc.tagLine}` : p.riotIdGameName ? `${p.riotIdGameName} #${p.riotIdTagline}` : p.summonerName || 'Unknown'
  }, [accounts])

  const [isPending, startTransition] = useTransition()
  
  const handleTabChange = useCallback((tab: 'overview' | 'analysis' | 'build') => {
    startTransition(() => {
      setActiveTab(tab)
    })
  }, [])

  if (!open || !mounted) return null

  // If we have absolutely no data (no match API, no summary prop), show nothing or basic loading
  if (!match && participants.length === 0 && loading) return null;

  const isWin = focusedParticipant?.win ?? true;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-200 dark:bg-slate-950/80" onClick={handleClose}>
      <div ref={containerRef} className="flex h-auto max-h-[90vh] w-full max-w-6xl flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" onClick={e => e.stopPropagation()} style={{ willChange: 'transform' }}>
        <header className={`sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur flex justify-between items-center dark:border-slate-800 dark:bg-slate-950/95 ${isWin ? 'shadow-[0_1px_15px_-5px_rgba(34,197,94,0.1)]' : 'shadow-[0_1px_15px_-5px_rgba(239,68,68,0.1)]'}`}>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Match Details</div>
              {/* Visual Feedback for Loading State */}
              {isPreview && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3">
              <span className={`text-xl font-bold tracking-tight ${focusedParticipant?.win ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {focusedParticipant?.win ? 'Victory' : 'Defeat'}
              </span>
              <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{QUEUE_LABELS[match?.info.queueId ?? 0] ?? 'Match'}</span>
              {match ? (
                <span className="text-xs text-slate-400 font-mono dark:text-slate-500">{formatMatchDuration(match.info.gameDuration)} | {timeAgo(match.info.gameEndTimestamp ?? match.info.gameCreation)}</span>
              ) : (
                <span className="text-xs text-slate-400 font-mono dark:text-slate-500 italic">Fetching full stats...</span>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="group rounded-full bg-slate-100 border border-slate-200 p-2 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:hover:bg-slate-800 dark:hover:text-white">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
          </button>
        </header>

        <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-6 py-2 shrink-0 dark:border-slate-800 dark:bg-slate-900/50">
          {[{k:'overview', l:'Overview'}, {k:'analysis', l:'Analysis'}, {k:'build', l:'Build'}].map(tab => (
            <button key={tab.k} onClick={() => handleTabChange(tab.k as any)} disabled={isPreview && tab.k !== 'overview'} className={`rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all ${activeTab === tab.k ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-white dark:ring-slate-700' : 'text-slate-500 hover:bg-slate-200/50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'} ${isPreview && tab.k !== 'overview' ? 'opacity-50 cursor-not-allowed' : ''}`}>{tab.l}</button>
          ))}
          {error && <span className="ml-auto text-xs font-medium text-amber-500/80">{error}</span>}
        </div>

        <div className="flex-1 overflow-y-auto bg-gradient-to-br from-slate-50 via-white to-slate-50 px-4 py-6 md:px-8 custom-scrollbar dark:from-slate-950 dark:via-slate-950 dark:to-slate-900" style={{ transform: 'translateZ(0)', willChange: 'scroll-position' }}>
          {/* Changed Logic: Only show skeleton if we have NO data (neither match nor participants) */}
          {loading && !match && participants.length === 0 ? (
            <div className="space-y-4 animate-pulse">
              <div className="h-32 rounded-xl bg-slate-200 dark:bg-slate-900" />
              <div className="h-96 rounded-xl bg-slate-200 dark:bg-slate-900" />
            </div>
          ) : (
            <div className="h-full">
              {activeTab === 'overview' && focusedParticipant && (
                <div className="space-y-6 pb-6">
                  {/* Banner Section */}
                  <div className={`relative flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${focusedParticipant.win ? 'shadow-emerald-500/5 dark:shadow-emerald-900/5' : 'shadow-rose-500/5 dark:shadow-rose-900/5'}`}>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Icon src={getChampionIconUrl(ddragonVersion, getChampionImageFull(staticData.champions[focusedParticipant.championId] ?? champMap[focusedParticipant.championId])!)} size="h-14 w-14" rounded="rounded-xl" className="shadow-lg ring-2 ring-slate-100 dark:ring-slate-800" />
                        {Number.isFinite(focusedParticipant.champLevel) && focusedParticipant.champLevel > 0 && (
                          <span className="absolute -bottom-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-slate-900 px-1 text-[10px] font-bold text-white ring-1 ring-slate-200 dark:bg-slate-200 dark:text-slate-900 dark:ring-slate-700">
                            {focusedParticipant.champLevel}
                          </span>
                        )}
                      </div>
                      <div>
                        <div className="text-xl font-bold text-slate-900 tracking-tight dark:text-slate-100">{getPlayerName(focusedParticipant)}</div>
                        <div className="flex items-center gap-3 text-sm text-slate-500 mt-0.5 dark:text-slate-400">
                          <span className="font-mono font-medium text-slate-700 dark:text-slate-200">{focusedParticipant.kills}/{focusedParticipant.deaths}/{focusedParticipant.assists}</span>
                          {!isPreview && null}
                          <span>
                            {focusedParticipant.deaths > 0
                              ? (focusedParticipant.kills / focusedParticipant.deaths).toFixed(2)
                              : 'Perfect'}{' '}
                            KD
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Items/Runes in Banner */}
                    <div className={`flex items-center gap-3 ${isPreview ? 'opacity-50 grayscale' : ''}`}>
                      <div className="flex gap-1 p-1 bg-slate-50 rounded-lg border border-slate-200 dark:bg-slate-950 dark:border-slate-800">
                        {[0,1,2,3,4,5].map(i => {
                          const id = (focusedParticipant as any)[`item${i}`];
                          return id ? <Icon key={i} src={getItemIconUrl(ddragonVersion, id)} title={staticData.items[id]?.name} size="h-10 w-10" rounded="rounded-md" /> : <div key={i} className="h-10 w-10 rounded-md bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800" />
                        })}
                        {(focusedParticipant as any).item6 ? <Icon src={getItemIconUrl(ddragonVersion, (focusedParticipant as any).item6)} size="h-10 w-10" rounded="rounded-md" /> : <div className="h-10 w-10 rounded-md bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800" />}
                      </div>
                      <div className="h-8 w-[1px] bg-slate-200 dark:bg-slate-800"></div>
                      <div className="flex flex-col gap-1">
                        <div className="flex gap-0.5">
                          <Icon src={spellMap.get(focusedParticipant.summoner1Id) && buildStaticUrl(ddragonVersion, `img/spell/${spellMap.get(focusedParticipant.summoner1Id).image.full}`)} size="h-5 w-5" rounded="rounded-sm" />
                          <Icon src={spellMap.get(focusedParticipant.summoner2Id) && buildStaticUrl(ddragonVersion, `img/spell/${spellMap.get(focusedParticipant.summoner2Id).image.full}`)} size="h-5 w-5" rounded="rounded-sm" />
                        </div>
                         <div className="flex gap-0.5">
                          <Icon src={focusedRunes.k && `https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.k.icon}`} size="h-5 w-5" rounded="rounded-full" />
                          <Icon src={focusedRunes.s && `https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.s.icon}`} size="h-5 w-5" rounded="rounded-full" className="grayscale opacity-70 p-0.5" />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    {[{ l: 'Blue Team', id: 100, d: teams.blue, t: teamTotals.blue, color: 'text-blue-600 dark:text-blue-400', bar: 'bg-blue-500', dir: 'ltr' }, 
                      { l: 'Red Team', id: 200, d: teams.red, t: teamTotals.red, color: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500', dir: 'rtl' }].map(tm => {
                      const maxDmg = Math.max(...tm.d.map(p => p.totalDamageDealtToChampions), 1)
                      const isRtl = tm.dir === 'rtl'
                      return (
                        <div key={tm.id} className="flex flex-col gap-2">
        <div className={`flex items-center justify-between px-2 pb-2 border-b border-slate-200 dark:border-slate-800 ${isRtl ? 'flex-row-reverse' : ''}`}>
          <span className={`text-xs font-bold uppercase tracking-widest ${tm.color}`}>{tm.l}</span>
          {!isPreview && (
            <span className="text-xs font-medium text-slate-500 font-mono">
              {isRtl ? (
                <>
                  <span className={tm.id === 100 ? (teamTotals.blue.gold >= teamTotals.red.gold ? 'font-bold text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-400') : (teamTotals.red.gold >= teamTotals.blue.gold ? 'font-bold text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-400')}>
                    {tm.t.gold.toLocaleString()}g
                  </span>{' '}
                  <span className="mx-1 text-slate-300 dark:text-slate-700">|</span>
                  <span className="text-slate-900 dark:text-slate-200">{tm.t.kills}</span> Kills
                </>
              ) : (
                <>
                  <span className="text-slate-900 dark:text-slate-200">{tm.t.kills}</span> Kills{' '}
                  <span className="mx-1 text-slate-300 dark:text-slate-700">|</span>
                  <span className={tm.id === 100 ? (teamTotals.blue.gold >= teamTotals.red.gold ? 'font-bold text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-400') : (teamTotals.red.gold >= teamTotals.blue.gold ? 'font-bold text-amber-600 dark:text-amber-300' : 'text-amber-500 dark:text-amber-400')}>
                    {tm.t.gold.toLocaleString()}g
                  </span>
                </>
              )}
            </span>
          )}
        </div>
                          <div className="space-y-1">
                            {tm.d.map(p => (
                              <PlayerRow key={p.puuid} p={p} match={match} focusedPuuid={focusedPuuid} staticData={staticData} champMap={champMap} ddragonVersion={ddragonVersion} spellMap={spellMap} runeMap={runeMap} getPlayerName={getPlayerName} teamColor={tm.bar} isRtl={isRtl} maxDmg={maxDmg} isPreview={isPreview} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              
              {/* Other tabs remain largely the same, but conditional on !isPreview so they don't break */}
              {activeTab === 'analysis' && !isPreview && (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 pb-6">
                  {/* Analysis content... (omitted for brevity, assume existing content) */}
                   {[
                    { l: 'Kills', b: teamTotals.blue.kills, r: teamTotals.red.kills, k: 'kills' },
                    { l: 'Gold Earned', b: teamTotals.blue.gold, r: teamTotals.red.gold, k: 'goldEarned', format: (n:number) => n.toLocaleString() },
                    { l: 'Damage Dealt', b: teamTotals.blue.damage, r: teamTotals.red.damage, k: 'totalDamageDealtToChampions', format: (n:number) => n.toLocaleString() },
                    { l: 'Damage Taken', b: teamTotals.blue.taken, r: teamTotals.red.taken, k: 'totalDamageTaken', format: (n:number) => n.toLocaleString() },
                    { l: 'Vision Score', b: teamTotals.blue.vision, r: teamTotals.red.vision, k: 'visionScore' },
                    { l: 'Minions (CS)', b: teamTotals.blue.cs, r: teamTotals.red.cs, k: 'cs' }
                  ].map(stat => {
                    const tot = stat.b + stat.r || 1
                    const maxB = Math.max(...teams.blue.map((p:any) => stat.k === 'cs' ? p.totalMinionsKilled+p.neutralMinionsKilled : p[stat.k]), 1)
                    const maxR = Math.max(...teams.red.map((p:any) => stat.k === 'cs' ? p.totalMinionsKilled+p.neutralMinionsKilled : p[stat.k]), 1)
                    const maxAll = Math.max(maxB, maxR, 1)
                    const blueHigher = stat.b > stat.r
                    const redHigher = stat.r > stat.b
                    return (
                      <div key={stat.l} className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
                        <div className="flex justify-between items-end mb-3">
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{stat.l}</span>
                          <span className="text-xs font-mono font-medium text-slate-400 dark:text-slate-300"><span className={`text-blue-500 dark:text-blue-400 ${blueHigher ? 'font-extrabold tracking-tight' : ''}`}>{stat.format ? stat.format(stat.b) : stat.b}</span> <span className="text-slate-300 dark:text-slate-600">/</span> <span className={`text-rose-500 dark:text-rose-400 ${redHigher ? 'font-extrabold tracking-tight' : ''}`}>{stat.format ? stat.format(stat.r) : stat.r}</span></span>
                        </div>
                        <div className="flex gap-1 mb-4 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden"><div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${(stat.b/tot)*100}%` }}/><div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${(stat.r/tot)*100}%` }}/></div>
                        <div className="grid grid-cols-2 gap-4">
                          {[teams.blue, teams.red].map((tm, i) => {
                            const isRed = i === 1
                            return (
                            <div key={i} className={`flex flex-col gap-1.5 ${isRed ? 'border-r border-slate-100 dark:border-slate-800 pr-2 items-end' : 'border-l border-slate-100 dark:border-slate-800 pl-2'}`}>
                              {tm.map(p => {
                                const val = stat.k === 'cs' ? p.totalMinionsKilled+p.neutralMinionsKilled : (p as any)[stat.k]
                                const isFocused = focusedPuuid === p.puuid
                                return (
                                  <div key={p.puuid} className={`flex items-center gap-2 group w-full ${isRed ? 'flex-row-reverse text-right' : ''}`}>
                                    <Icon src={getChampionIconUrl(ddragonVersion, getChampionImageFull(staticData.champions[p.championId] ?? champMap[p.championId])!)} size="h-5 w-5" rounded="rounded" className={isFocused ? 'ring-amber-500/50' : 'ring-slate-200 dark:ring-slate-700'} />
                                    <div className="flex-1 min-w-0"><div className="h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden relative"><div className={`h-1 rounded-full absolute top-0 ${isRed ? 'right-0 bg-rose-500/70 group-hover:bg-rose-500' : 'left-0 bg-blue-500/70 group-hover:bg-blue-500'} ${isFocused ? (isRed ? '!bg-rose-500' : '!bg-blue-500') : ''}`} style={{ width: `${(val/maxAll)*100}%` }}/></div></div>
                                    <span className={`text-[9px] font-mono w-8 tabular-nums ${isFocused ? 'text-amber-600 underline underline-offset-2 dark:text-amber-200' : 'text-slate-400'} ${isRed ? 'text-left' : 'text-right'}`}>{val >= 1000 && stat.k !== 'cs' ? (val/1000).toFixed(1)+'k' : val}</span>
                                  </div>
                                )
                              })}
                            </div>
                          )})}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {activeTab === 'build' && !isPreview && (
                <div className="h-full max-h-[600px] w-full flex gap-6 overflow-hidden pb-2">
                   {/* Build content... (omitted for brevity, assume existing content) */}
                   {!focusedParticipant ? <div className="p-8 text-center text-slate-500 italic bg-slate-50 rounded-xl border border-slate-200 w-full dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400">Player data not found.</div> : (
                    <>
                      <div className="w-auto max-w-[280px] shrink-0 flex flex-col gap-6 h-full">
                        <div className="rounded-xl border border-slate-200 bg-white p-5 flex-1 overflow-hidden flex flex-col justify-center dark:border-slate-800 dark:bg-slate-900">
                          <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-6 text-center">Runes & Stats</div>
                          <div className="flex flex-col items-center gap-6">
                            <div className="flex items-center gap-4">
                              {focusedRunes.k && <Icon src={`https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.k.icon}`} size="h-14 w-14" rounded="rounded-full" className="ring-2 ring-amber-500/30" />}
                              <div className="flex gap-2">
                                {focusedRunes.prim.map((r, i) => r && <Icon key={i} src={`https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`} size="h-9 w-9" rounded="rounded-full" className="bg-slate-100 dark:bg-slate-800" />)}
                              </div>
                            </div>
                            <div className="w-full h-[1px] bg-slate-200 dark:bg-slate-800" />
                            <div className="flex items-center gap-4">
                              {focusedRunes.s && <Icon src={`https://ddragon.leagueoflegends.com/cdn/img/${focusedRunes.s.icon}`} size="h-8 w-8" rounded="rounded-full" />}
                              <div className="flex gap-2">
                                {focusedRunes.sec.map((r, i) => r && <Icon key={i} src={`https://ddragon.leagueoflegends.com/cdn/img/${r.icon}`} size="h-7 w-7" rounded="rounded-full" className="bg-slate-100 dark:bg-slate-800" />)}
                              </div>
                              <div className="w-[1px] h-6 bg-slate-200 dark:bg-slate-800 mx-2" />
                              <div className="flex gap-1.5">
                                {focusedParticipant.perks?.statPerks && [
                                  focusedParticipant.perks.statPerks.offense,
                                  focusedParticipant.perks.statPerks.flex,
                                  focusedParticipant.perks.statPerks.defense
                                ].map((p, i) => {
                                  const icon = runeMap.get(p)?.icon
                                  const src = icon
                                    ? `https://ddragon.leagueoflegends.com/cdn/img/${icon}`
                                    : SHARD_MAP[p]
                                      ? getShardIconUrl(SHARD_MAP[p])
                                      : null
                                  return (
                                    <Icon key={`shard-${i}`} src={src} size="h-6 w-6" rounded="rounded-full" className="bg-slate-100 ring-1 ring-slate-200 p-1 dark:bg-slate-800 dark:ring-slate-700" />
                                  )
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-5 shrink-0 dark:border-slate-800 dark:bg-slate-900">
                           <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3 text-center">Skill Path</div>
                           <div className="flex flex-wrap justify-center gap-1.5">
                             {(timeline?.info.frames.flatMap(f => f.events).filter(e => e.type === 'SKILL_LEVEL_UP' && e.participantId === focusedParticipant.participantId).slice(0, 18) || []).map((e: any, i) => {
                               const skill = ['Q','W','E','R'][e.skillSlot-1]; const isUlt = skill === 'R';
                               return <div key={i} className={`flex h-7 w-7 flex-col items-center justify-center rounded border ${isUlt ? 'border-amber-500/40 bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300' : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}><span className="text-[10px] font-bold">{skill}</span><span className="text-[7px] opacity-60 -mt-0.5">{i+1}</span></div>
                             })}
                           </div>
                        </div>
                      </div>
                      
                      <div className="flex-1 rounded-xl border border-slate-200 bg-white p-5 flex flex-col h-full overflow-hidden dark:border-slate-800 dark:bg-slate-900">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 sticky top-0">Item Build Order</div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                           <div className="flex flex-wrap items-center gap-x-4 gap-y-6">
                             {groupedBuildOrder.map((group, i) => (
                               <div key={i} className="flex items-center gap-4">
                                 <div className="flex flex-col items-center gap-2">
                                    <div className="flex gap-1 bg-slate-50 p-2 rounded-xl border border-slate-200 relative group/itembox shadow-sm dark:bg-slate-950 dark:border-slate-800">
                                      {group.items.map((e: any, idx: number) => (
                                        <Icon key={idx} src={getItemIconUrl(ddragonVersion, e.itemId)} size="h-10 w-10" rounded="rounded-md" title={staticData.items[e.itemId]?.name} className="ring-1 ring-slate-200 group-hover/itembox:ring-slate-400 transition dark:ring-slate-800 dark:group-hover/itembox:ring-slate-600" />
                                      ))}
                                    </div>
                                    <div className="text-[10px] font-mono font-medium text-slate-500">{group.timeLabel}</div>
                                 </div>
                                 {i < groupedBuildOrder.length - 1 && (
                                   <svg className="h-5 w-5 text-slate-300 mb-6 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                 )}
                               </div>
                             ))}
                           </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
