'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type PodiumEntry = {
  puuid: string
  name: string
  iconUrl: string | null
  value: number | string
  valueLabel?: string
}

export type ListEntry = {
  puuid: string
  name: string
  iconUrl: string | null
  value: number | string
  valueLabel?: string
  valueClassName?: string
}

export type PodiumBlock = {
  id: string
  title: string
  accent: string
  entries: PodiumEntry[]
}

export type ListBlock = {
  id: string
  title: string
  accent: string
  entries: ListEntry[]
}

export default function StatsHighlightsClient({
  singleGameTopRow,
  singleGameBottomRow,
  playerBlocks,
  timeBlocks,
}: {
  singleGameTopRow: PodiumBlock[]
  singleGameBottomRow: PodiumBlock[]
  playerBlocks: ListBlock[]
  timeBlocks: PodiumBlock[]
}) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)

  const allBlocks = useMemo(() => {
    return [...singleGameTopRow, ...singleGameBottomRow, ...playerBlocks, ...timeBlocks]
  }, [singleGameTopRow, singleGameBottomRow, playerBlocks, timeBlocks])

  const activeBlock = useMemo(() => allBlocks.find((block) => block.id === activeBlockId) ?? null, [allBlocks, activeBlockId])

  return (
    <>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <SectionDividerTitle title="Single Game High Scores" accent="from-rose-400 to-rose-600" />

          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {singleGameTopRow.map((block) => (
                <PodiumCard
                  key={block.id}
                  block={block}
                  onOpen={setActiveBlockId}
                />
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
              {singleGameBottomRow.map((block, idx) => (
                <PodiumCard
                  key={block.id}
                  block={block}
                  onOpen={setActiveBlockId}
                  className={`lg:col-span-2 ${idx === 0 ? 'lg:col-start-2' : 'lg:col-start-4'}`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2">
          <SectionDividerTitle title="Player Accumulative Rankings" accent="from-amber-400 to-amber-600" />

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {playerBlocks.map((block) => {
              const topPlayer = block.entries[0]
              return (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => setActiveBlockId(block.id)}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60"
                >
                  <div className="p-5">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                      {block.title}
                    </div>
                    {!topPlayer ? (
                      <div className="mt-3 text-xs text-slate-400">No data yet.</div>
                    ) : (
                      <>
                        <div className="mt-4 flex items-center gap-3">
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                            {topPlayer.iconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={topPlayer.iconUrl} alt="" width={48} height={48} className="h-full w-full object-cover" />
                            ) : (
                              <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[12px] font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap leading-tight tracking-tight">
                              {topPlayer.name}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400">Top performer</div>
                          </div>
                          <div
                            className={`text-3xl font-black tabular-nums ${topPlayer.valueClassName ?? 'text-slate-900 dark:text-slate-100'}`}
                          >
                            {topPlayer.valueLabel ?? topPlayer.value}
                          </div>
                        </div>

                        <ol className="mt-4 space-y-2 text-sm">
                          {block.entries.slice(1, 5).map((entry, idx) => (
                            <li key={entry.puuid} className="flex items-center justify-between">
                              <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200 min-w-0">
                                <span className="text-slate-400">{idx + 2}.</span>
                                {entry.iconUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={entry.iconUrl}
                                    alt=""
                                    width={28}
                                    height={28}
                                    className="h-7 w-7 rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                                  />
                                ) : (
                                  <div className="h-7 w-7 rounded-full border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                                )}
                                <span className="text-[12px] whitespace-nowrap leading-tight tracking-tight">{entry.name}</span>
                              </span>
                              <span
                                className={`font-semibold tabular-nums ${entry.valueClassName ?? 'text-slate-900 dark:text-slate-100'}`}
                              >
                                {entry.valueLabel ?? entry.value}
                              </span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="lg:col-span-2">
          <SectionDividerTitle title="Time &amp; Length Highlights" accent="from-violet-400 to-violet-600" />

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {timeBlocks.map((block, idx) => (
              <PodiumCard
                key={block.id}
                block={block}
                onOpen={setActiveBlockId}
                className={`lg:col-span-2 ${idx % 2 === 0 ? 'lg:col-start-2' : 'lg:col-start-4'}`}
              />
            ))}
          </div>
        </div>
      </section>

      {activeBlock ? (
        <Modal onClose={() => setActiveBlockId(null)}>
          <div className="-mx-6 -mt-6 mb-4 flex items-center justify-between gap-4 rounded-t-2xl border-b border-slate-200/80 bg-slate-100/80 px-6 py-4 dark:border-slate-800/80 dark:bg-slate-950/70">
            <div>
              <div className={`h-1 w-12 rounded-full bg-gradient-to-r ${activeBlock.accent}`} />
              <h4 className="mt-3 text-lg font-black text-slate-900 dark:text-slate-100">{activeBlock.title}</h4>
              <p className="text-sm text-slate-500 dark:text-slate-400">Full placements (unique players)</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setActiveBlockId(null)}
              className="rounded-full border border-slate-200 bg-white p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:hover:bg-slate-900 dark:hover:text-slate-100"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>

          <div className="leaderboard-scroll max-h-[52vh] overflow-y-auto pr-2">
            {activeBlock.entries.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">No data available.</div>
            ) : (
              <ol className="space-y-3">
                {activeBlock.entries.map((entry, idx) => (
                  <li key={`${activeBlock.id}-${entry.puuid}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
                    <span className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-bold text-slate-400 w-6 text-right">{idx + 1}</span>
                      <span className="h-9 w-9 rounded-full overflow-hidden border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                        {entry.iconUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={entry.iconUrl} alt="" width={36} height={36} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                        )}
                      </span>
                      <span className="truncate font-semibold text-slate-700 dark:text-slate-100">{entry.name}</span>
                    </span>
                    <span className="text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">
                      {entry.valueLabel ?? entry.value}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [])

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialogElement = dialogRef.current
    dialogElement?.focus()

    const getFocusableElements = (): HTMLElement[] => {
      if (!dialogElement) return []
      return Array.from(
        dialogElement.querySelectorAll<HTMLElement>(
          'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true')
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const focusableElements = getFocusableElements()
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialogElement?.focus()
        return
      }

      const firstFocusable = focusableElements[0]
      const lastFocusable = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const isInsideDialog = activeElement ? dialogElement?.contains(activeElement) : false

      if (event.shiftKey) {
        if (!isInsideDialog || activeElement === firstFocusable) {
          event.preventDefault()
          lastFocusable.focus()
        }
        return
      }

      if (!isInsideDialog || activeElement === lastFocusable) {
        event.preventDefault()
        firstFocusable.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="relative w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

function PodiumCard({
  block,
  onOpen,
  className,
}: {
  block: PodiumBlock
  onOpen: (blockId: string) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(block.id)}
      className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-900/10 hover:ring-1 hover:ring-slate-300/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-black/30 dark:hover:ring-slate-700/60 ${className ?? ''}`}
    >
      <div className="p-4">
        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{block.title}</div>
        {block.entries.length === 0 ? <div className="mt-3 text-xs text-slate-400">No data yet.</div> : <PodiumEntries entries={block.entries} />}
      </div>
    </button>
  )
}

function PodiumEntries({ entries }: { entries: PodiumEntry[] }) {
  return (
    <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      {entries.slice(0, 3).map((entry, entryIdx) => {
        const orderClass = entryIdx === 0 ? 'sm:order-2' : entryIdx === 1 ? 'sm:order-1' : 'sm:order-3'
        const sizeClass = entryIdx === 0 ? 'sm:scale-105' : entryIdx === 2 ? 'sm:scale-95' : 'sm:scale-100'
        return (
          <div key={entry.puuid} className={orderClass}>
            <div className={`relative px-4 py-3 ${sizeClass}`}>
              <div className="flex flex-col items-center text-center gap-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">#{entryIdx + 1}</div>
                <div className="relative h-20 w-20 rounded-full border-2 shadow-sm overflow-visible bg-slate-100 dark:bg-slate-800 border-amber-400">
                  <div className="h-full w-full overflow-hidden rounded-full">
                    {entry.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={entry.iconUrl} alt="" width={80} height={80} className="h-full w-full rounded-full object-cover" />
                    ) : (
                      <div className="h-full w-full rounded-full bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-700 dark:to-slate-800" />
                    )}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-semibold uppercase tracking-widest text-slate-700 dark:text-slate-100">{entry.name}</div>
                </div>
                <div className="text-2xl font-black tabular-nums text-slate-900 dark:text-slate-100">{entry.valueLabel ?? entry.value}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SectionDividerTitle({ title, accent }: { title: string; accent: string }) {
  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-slate-200/80 dark:bg-slate-800/90" />
      <h3 className="relative mx-auto w-fit bg-slate-50 px-4 text-xs font-black uppercase tracking-widest text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <span className={`inline-block h-1 w-7 rounded-full bg-gradient-to-r ${accent} align-middle`} />
        <span className="mx-2 align-middle">{title}</span>
        <span className={`inline-block h-1 w-7 rounded-full bg-gradient-to-r ${accent} align-middle`} />
      </h3>
    </div>
  )
}
