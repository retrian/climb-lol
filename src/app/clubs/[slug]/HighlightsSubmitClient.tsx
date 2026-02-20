'use client'

import { useCallback, useState, useTransition } from 'react'

type Props = {
  action: (formData: FormData) => void
  canPost: boolean
  slug: string
}

export default function HighlightsSubmitClient({ action, canPost, slug }: Props) {
  const [duration, setDuration] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [isPending, startTransition] = useTransition()

  const loadDuration = useCallback((url: string) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    video.onloadedmetadata = () => {
      const nextDuration = Number.isFinite(video.duration) ? Math.round(video.duration) : null
      setDuration(nextDuration)
      if (nextDuration !== null && nextDuration > 30) {
        setError('Video must be 30 seconds or less.')
      }
    }
    video.onerror = () => {
      setDuration(null)
      setError('Unable to read video length. Use a direct video link.')
    }
  }, [])

  const resolveShortLink = useCallback(async (url: string) => {
    setIsResolving(true)
    try {
      const response = await fetch('/api/ascent/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      if (!response.ok) {
        const message = await response.text()
        throw new Error(message || 'Unable to resolve video link.')
      }
      const data = (await response.json()) as { url?: string }
      if (!data.url) throw new Error('Unable to resolve video link.')
      setResolvedUrl(data.url)
      loadDuration(data.url)
    } catch (err) {
      setResolvedUrl(null)
      setDuration(null)
      setError(err instanceof Error ? err.message : 'Unable to resolve video link.')
    } finally {
      setIsResolving(false)
    }
  }, [loadDuration])

  return (
    <form
      action={(formData) => {
        if (!canPost) return
        setError(null)
        if (!duration || duration <= 0) {
          setError('Video length not available. Use a direct or resolved video link.')
          return
        }
        if (duration > 30) {
          setError('Video must be 30 seconds or less.')
          return
        }
        formData.set('duration_seconds', String(Math.round(duration)))
        if (resolvedUrl) {
          formData.set('resolved_url', resolvedUrl)
        }
        startTransition(() => action(formData))
      }}
      className="border-y border-slate-200/80 px-3 py-3 dark:border-slate-800/90 sm:px-4"
    >
      <input type="hidden" name="slug" value={slug} />
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          CL
        </div>
        <div className="min-w-0 flex-1">
          <input
            name="video_url"
            placeholder="What’s happening?"
            required
            disabled={!canPost || isPending || isResolving}
            className="w-full bg-transparent py-1 text-xl text-slate-900 placeholder:text-slate-500 outline-none disabled:cursor-not-allowed disabled:opacity-70 dark:text-slate-100 dark:placeholder:text-slate-500"
            onChange={(event) => {
              setError(null)
              setDuration(null)
              setResolvedUrl(null)
              const value = event.target.value.trim()
              if (!value) return

              if (value.includes('app.tryascent.gg/watch') || value.includes('app.tryascent.gg/clips/')) {
                void resolveShortLink(value)
                return
              }

              loadDuration(value)
            }}
          />
        </div>
      </div>

      <input type="hidden" name="resolved_url" value={resolvedUrl ?? ''} />

      <div className="mt-2 flex items-center justify-between gap-3 pl-[52px]">
        <div className="min-w-0 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span>Max 30s</span>
          <span>{duration ? `Length: ${duration}s` : 'Length: —'}</span>
          {resolvedUrl && <span>Resolved link ready.</span>}
          {!canPost && <span>Only club members can post highlights.</span>}
          {error && <span className="font-semibold text-rose-600 dark:text-rose-300">{error}</span>}
        </div>
        <button
          type="submit"
          disabled={!canPost || isPending || isResolving}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
        >
          {isResolving ? 'Resolving…' : isPending ? 'Posting…' : 'Post'}
        </button>
      </div>
    </form>
  )
}
