import Link from 'next/link'
import type { ClubRow, ClubTab } from '../types'
import { TABS } from '../types'
import { clubUrl } from '../utils'

type Props = {
  club: ClubRow
  activeTab: ClubTab
  canManage: boolean
}

export default function ClubHeader({ club, activeTab, canManage }: Props) {
  return (
    <div className="mx-auto w-full max-w-[1460px]">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
        {club.banner_url ? (
          <div className="absolute inset-0 h-full w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={club.banner_url} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-br from-white/70 via-white/45 to-white/25 dark:from-slate-950/80 dark:via-slate-950/55 dark:to-slate-900/35" />
            <div className="absolute inset-0 bg-gradient-to-t from-white/75 via-white/25 to-transparent dark:from-slate-950/80 dark:via-slate-950/40 dark:to-transparent" />
          </div>
        ) : (
          <>
            <div className="absolute inset-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900" />
            <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] pointer-events-none dark:bg-grid-slate-800 dark:[mask-image:linear-gradient(0deg,rgba(15,23,42,0.9),rgba(15,23,42,0.4))]" />
          </>
        )}

        <div className="relative p-8 lg:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="mb-6 inline-flex items-center gap-2.5">
                <span className="inline-flex items-center rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300/50 uppercase tracking-wider shadow-sm dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:ring-slate-700/70">
                  {club.visibility ?? 'PUBLIC'}
                </span>
                <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 p-1 text-sm font-semibold text-slate-600 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-200">
                  {TABS.map((tab) => {
                    const isActive = tab === activeTab
                    const isTemporarilyDisabled =
                      (activeTab === 'home' || activeTab === 'highlights') && (tab === 'members' || tab === 'leaderboards')
                    return (
                      isTemporarilyDisabled ? (
                        <span
                          key={tab}
                          aria-disabled="true"
                          className="inline-flex cursor-not-allowed items-center rounded-full px-3.5 py-1.5 text-sm font-semibold capitalize text-slate-400 dark:text-slate-500"
                        >
                          {tab}
                        </span>
                      ) : (
                        <Link
                          key={tab}
                          href={clubUrl(club.slug, { tab })}
                          className={`inline-flex items-center rounded-full px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors duration-200 ${
                            isActive
                              ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white'
                          }`}
                        >
                          {tab}
                        </Link>
                      )
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400">
                  {club.name}
                </h1>
              </div>
              {club.description && (
                <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">{club.description}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {canManage ? (
                <Link
                  href="/dashboard/club"
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                >
                  Manage in dashboard
                </Link>
              ) : (
                <span className="inline-flex items-center justify-center rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  Club owner manages settings
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
