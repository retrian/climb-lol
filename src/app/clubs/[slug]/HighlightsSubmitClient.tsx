'use client'

import { useCallback, useState, useTransition } from 'react'

type Props = {
  action: (formData: FormData) => void
  canPost: boolean
}

export default function HighlightsSubmitClient({ action, canPost }: Props) {
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
      className="grid gap-3"
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input
          name="video_url"
          placeholder="Paste a direct video URL"
          required
          disabled={!canPost || isPending || isResolving}
          className="rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          onChange={(event) => {
            setError(null)
            setDuration(null)
            setResolvedUrl(null)
            const value = event.target.value.trim()
            if (!value) return

            if (value.includes('app.tryascent.gg/watch')) {
              void resolveShortLink(value)
              return
            }

            loadDuration(value)
          }}
        />
        <input type="hidden" name="resolved_url" value={resolvedUrl ?? ''} />
        <button
          type="submit"
          disabled={!canPost || isPending || isResolving}
          className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          {isResolving ? 'Resolving…' : isPending ? 'Posting…' : 'Post highlight'}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>{duration ? `Length: ${duration}s` : 'Length: —'}</span>
        {resolvedUrl && <span>Resolved link ready.</span>}
        {!canPost && <span>Only club members can post highlights.</span>}
        {error && <span className="font-semibold text-rose-600 dark:text-rose-300">{error}</span>}
      </div>
    </form>
  )
}
