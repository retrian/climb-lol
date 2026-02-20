import Link from 'next/link'
import type { AttachedLeaderboard, LeaderboardRow } from '../types'
import { formatDate } from '../utils'

type Props = {
  slug: string
  canManage: boolean
  attachableLeaderboards: LeaderboardRow[]
  attachedLeaderboards: AttachedLeaderboard[]
  attachLeaderboardAction: (formData: FormData) => Promise<void>
  detachLeaderboardAction: (formData: FormData) => Promise<void>
}

export default function LeaderboardsTab({
  slug,
  canManage,
  attachableLeaderboards,
  attachedLeaderboards,
  attachLeaderboardAction,
  detachLeaderboardAction,
}: Props) {
  return (
    <section className="mt-8 space-y-6">
      <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Attached leaderboards</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Attach competitions from the owner account to represent the club.</p>
          </div>
          {canManage && (
            <form action={attachLeaderboardAction} className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
              <input type="hidden" name="slug" value={slug} />
              <select
                name="leaderboard_id"
                className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400/10 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                defaultValue=""
              >
                <option value="" disabled>
                  {attachableLeaderboards.length > 0 ? 'Select one of your leaderboards…' : 'No available leaderboards'}
                </option>
                {attachableLeaderboards.map((lb) => (
                  <option key={lb.id} value={lb.id}>
                    {lb.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={attachableLeaderboards.length === 0}
              >
                Attach
              </button>
            </form>
          )}
        </div>
        {!canManage && (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            The club owner decides which leaderboards are attached here.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {attachedLeaderboards.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
            <p className="text-base font-bold text-slate-600 dark:text-slate-200">No leaderboards attached</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Attach one to showcase the club’s progress.</p>
          </div>
        ) : (
          attachedLeaderboards.map((item) => {
            const lb = item.leaderboard
            const updatedAt = formatDate(lb?.updated_at)
            const addedAt = formatDate(item.addedAt)

            return (
              <div
                key={item.linkId}
                className="group overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm transition hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                {lb?.banner_url && (
                  <div className="h-28 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={lb.banner_url} alt="" className="h-full w-full object-cover" />
                  </div>
                )}
                <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">{lb?.name ?? 'Unknown leaderboard'}</h3>
                      {lb?.visibility && (
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                          {lb.visibility}
                        </span>
                      )}
                    </div>
                    {lb?.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{lb.description}</p>}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      {updatedAt && <span>Updated {updatedAt}</span>}
                      {addedAt && <span>Attached {addedAt}</span>}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {lb?.slug && (
                      <Link
                        href={`/leaderboards/${lb.leaderboard_code}`}
                        className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                      >
                        Open leaderboard
                      </Link>
                    )}
                    {canManage && (
                      <form action={detachLeaderboardAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="link_id" value={item.linkId} />
                        <button
                          type="submit"
                          className="inline-flex w-full items-center justify-center rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:border-rose-400"
                        >
                          Remove
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
