'use client'

import { useCallback, useRef } from 'react'

// Global prefetch cache - shared across all instances
const prefetchCache = new Map<string, {
  match?: Promise<any> | any
  timeline?: Promise<any> | any
  accounts?: Promise<Record<string, any>> | Record<string, any>
  timestamp: number
}>()

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Clean up old cache entries periodically
const cleanupCache = () => {
  const now = Date.now()
  for (const [key, value] of prefetchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      prefetchCache.delete(key)
    }
  }
}

// Run cleanup every minute
if (typeof window !== 'undefined') {
  setInterval(cleanupCache, 60 * 1000)
}

export function useMatchPrefetch() {
  const prefetchingRef = useRef<Set<string>>(new Set())

  const prefetchMatch = useCallback((matchId: string) => {
    // Skip if already prefetching or cached
    if (prefetchingRef.current.has(matchId)) return
    if (prefetchCache.has(matchId)) {
      const cached = prefetchCache.get(matchId)!
      if (Date.now() - cached.timestamp < CACHE_TTL) return
    }

    prefetchingRef.current.add(matchId)

    // Create cache entry
    const cacheEntry = {
      timestamp: Date.now(),
    }
    prefetchCache.set(matchId, cacheEntry)

    // Prefetch match data
    // Note: RequestPriority is experimental and may not be available in all browsers
    const getFetchOptions = (): RequestInit => {
      const options: RequestInit = {}
      if ('priority' in Request.prototype) {
        (options as any).priority = 'low'
      }
      return options
    }
    
    const fetchOptions = getFetchOptions()
    const matchPromise = fetch(`/api/riot/match/${matchId}`, fetchOptions)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.match || null)
      .catch(() => null)

    cacheEntry.match = matchPromise

    // Once match is loaded, prefetch timeline and accounts
    matchPromise.then((match) => {
      if (!match) return

      const timelineFetchOptions = getFetchOptions()
      // Prefetch timeline
      const timelinePromise = fetch(`/api/riot/match/${match.metadata.matchId}/timeline`, timelineFetchOptions)
        .then(r => r.ok ? r.json() : null)
        .then(d => d?.timeline || null)
        .catch(() => null)
      
      cacheEntry.timeline = timelinePromise

      // Prefetch all account data in parallel
      const accountFetchOptions = getFetchOptions()
      const accountPromises = match.metadata.participants.map((puuid: string) =>
        fetch(`/api/riot/account/${puuid}`, accountFetchOptions)
          .then(r => r.ok ? r.json() : null)
          .then(d => [puuid, d?.account] as const)
          .catch(() => [puuid, null] as const)
      )

      const accountsPromise = Promise.all(accountPromises).then((entries) => {
        const accs: Record<string, any> = {}
        entries.forEach(([id, a]) => {
          if (a) accs[id] = a
        })
        return accs
      })

      cacheEntry.accounts = accountsPromise
      
      // Store resolved values for instant access
      timelinePromise.then((timeline) => {
        if (timeline) cacheEntry.timeline = timeline
      })
      accountsPromise.then((accounts) => {
        if (accounts) cacheEntry.accounts = accounts
      })
    })
    
    // Store resolved match for instant access
    matchPromise.then((match) => {
      if (match) cacheEntry.match = match
    })

    // Remove from prefetching set after a delay
    setTimeout(() => {
      prefetchingRef.current.delete(matchId)
    }, 1000)
  }, [])

  const getPrefetchedData = useCallback((matchId: string) => {
    return prefetchCache.get(matchId)
  }, [])

  const clearPrefetch = useCallback((matchId: string) => {
    prefetchCache.delete(matchId)
    prefetchingRef.current.delete(matchId)
  }, [])

  return {
    prefetchMatch,
    getPrefetchedData,
    clearPrefetch,
  }
}
