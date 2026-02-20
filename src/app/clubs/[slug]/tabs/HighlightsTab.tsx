import Link from 'next/link'
import HighlightsSubmitClient from '../HighlightsSubmitClient'
import type { HighlightRow, MemberRow } from '../types'
import { formatDate, profileIconUrl } from '../utils'

type Props = {
  slug: string
  userId: string | null
  canPostHighlight: boolean
  highlights: HighlightRow[]
  members: MemberRow[]
  profilesByUserId: Map<string, string>
  riotStateByPuuid: Map<string, number | null>
  addHighlightAction: (formData: FormData) => Promise<void>
  deleteHighlightAction: (formData: FormData) => Promise<void>
}

export default function HighlightsTab({
  slug,
  userId,
  canPostHighlight,
  highlights,
  members,
  profilesByUserId,
  riotStateByPuuid,
  addHighlightAction,
  deleteHighlightAction,
}: Props) {
  return (
    <section className="mx-auto mt-8 w-full max-w-[600px]">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6">
          {!userId && (
            <Link
              href="/sign-in"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
            >
              Sign in to post
            </Link>
          )}
        </div>
        {userId && (
          <div>
            <HighlightsSubmitClient action={addHighlightAction} canPost={canPostHighlight} slug={slug} />
          </div>
        )}
        <div className="border-t border-slate-200 dark:border-slate-800" />

        {highlights.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="text-base font-bold text-slate-600 dark:text-slate-200">No highlights yet</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Be the first to post a clip.</p>
          </div>
        ) : (
          highlights.map((highlight) => {
            const createdLabel = formatDate(highlight.created_at)
            const username = highlight.user_id ? profilesByUserId.get(highlight.user_id) : null
            const authorMember = highlight.user_id ? members.find((member) => member.user_id === highlight.user_id) : null
            const authorIconId = authorMember?.player_puuid ? riotStateByPuuid.get(authorMember.player_puuid) ?? null : null
            const authorIconUrl = profileIconUrl(authorIconId)
            const handle = username ? `@${username.toLowerCase().replace(/\s+/g, '')}` : '@member'

            return (
              <article key={highlight.id} className="border-b border-slate-200 p-4 last:border-b-0 dark:border-slate-800">
                <div className="flex items-start gap-3">
                  <div className="h-[42px] w-[42px] shrink-0">
                    {authorIconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={authorIconUrl} alt="" className="h-[42px] w-[42px] rounded-full border border-slate-200/70 object-cover dark:border-slate-700/70" />
                    ) : (
                      <div className="h-[42px] w-[42px] rounded-full border border-slate-200/70 bg-slate-100 dark:border-slate-700/70 dark:bg-slate-800" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2 pb-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1 text-[15px] leading-[17px]">
                        <span className="max-w-[70%] truncate font-semibold text-slate-900 dark:text-slate-100">{username ?? 'Member'}</span>
                        <span className="truncate text-slate-500 dark:text-slate-400">{handle}</span>
                        {createdLabel && <span className="whitespace-nowrap text-slate-500 dark:text-slate-400">· {createdLabel}</span>}
                      </div>
                      <details className="relative ml-2 shrink-0">
                        <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                          <span className="text-base leading-none">⋯</span>
                        </summary>
                        <div className="absolute right-0 z-10 mt-1 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                          <a
                            href={highlight.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                          >
                            View
                          </a>
                          {userId && highlight.user_id === userId && (
                            <form action={deleteHighlightAction}>
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="highlight_id" value={highlight.id} />
                              <button
                                type="submit"
                                className="block w-full px-3 py-2 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10"
                              >
                                Delete
                              </button>
                            </form>
                          )}
                        </div>
                      </details>
                    </div>

                    <p className="mb-2 text-[15px] leading-5 text-slate-900 dark:text-slate-100">
                      Club highlight clip
                      {highlight.duration_seconds ? ` · ${highlight.duration_seconds}s` : ''}
                    </p>

                    <div className="overflow-hidden rounded-[12px] border border-slate-200 dark:border-slate-700">
                      <video controls preload="metadata" className="w-full bg-black">
                        <source src={highlight.url} />
                      </video>
                    </div>
                  </div>
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}
