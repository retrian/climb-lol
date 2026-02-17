'use client'

import { useCallback, useEffect, useRef } from 'react'

// Global prefetch cache - shared across all instances
type MatchLike = {
  metadata?: {
    matchId?: string
  }
}

type PrefetchCacheEntry = {
  match?: Promise<MatchLike | null> | MatchLike
  timeline?: Promise<unknown | null> | unknown
  accounts?: Promise<Record<string, unknown>> | Record<string, unknown>
  timestamp: number
}

const prefetchCache = new Map<string, PrefetchCacheEntry>()

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
let cleanupIntervalId: number | null = null
let cleanupSubscriberCount = 0

// Clean up old cache entries periodically
const cleanupCache = () => {
  const now = Date.now()
  for (const [key, value] of prefetchCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      prefetchCache.delete(key)
    }
  }
}

export function useMatchPrefetch() {
  const prefetchingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    cleanupSubscriberCount += 1

    if (cleanupSubscriberCount === 1 && typeof window !== 'undefined') {
      cleanupIntervalId = window.setInterval(cleanupCache, 60 * 1000)
    }

    return () => {
      cleanupSubscriberCount = Math.max(0, cleanupSubscriberCount - 1)
      if (cleanupSubscriberCount === 0 && cleanupIntervalId !== null) {
        window.clearInterval(cleanupIntervalId)
        cleanupIntervalId = null
      }
    }
  }, [])

  const prefetchMatch = useCallback((matchId: string) => {
    // Skip if already prefetching or cached
    if (prefetchingRef.current.has(matchId)) return
    if (prefetchCache.has(matchId)) {
      const cached = prefetchCache.get(matchId)!
      if (Date.now() - cached.timestamp < CACHE_TTL) return
    }

    prefetchingRef.current.add(matchId)

    // Create cache entry
    const cacheEntry: PrefetchCacheEntry = {
      timestamp: Date.now(),
    }
    prefetchCache.set(matchId, cacheEntry)

    // Prefetch match data
    // Note: RequestPriority is experimental and may not be available in all browsers
    const getFetchOptions = (): RequestInit => {
      const options: RequestInit & { priority?: 'high' | 'low' | 'auto' } = {}
      if ('priority' in Request.prototype) {
        options.priority = 'low'
      }
      return options
    }
    
    const fetchOptions = getFetchOptions()
    const matchPromise = fetch(`/api/match/${matchId}`, fetchOptions)
      .then(r => r.ok ? r.json() : null)
      .then((d: { match?: MatchLike } | null) => d?.match || null)
      .catch(() => null)

    cacheEntry.match = matchPromise

    // Once match is loaded, prefetch timeline only (accounts are deferred until modal opens)
    matchPromise.then((match) => {
      const timelineMatchId = match?.metadata?.matchId
      if (!timelineMatchId) return

      const timelineFetchOptions = getFetchOptions()
      // Prefetch timeline
      const timelinePromise = fetch(`/api/riot/match/${timelineMatchId}/timeline`, timelineFetchOptions)
        .then(r => r.ok ? r.json() : null)
        .then((d: { timeline?: unknown } | null) => d?.timeline || null)
        .catch(() => null)
      
      cacheEntry.timeline = timelinePromise

      // Store resolved values for instant access
      timelinePromise.then((timeline) => {
        if (timeline) cacheEntry.timeline = timeline
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
