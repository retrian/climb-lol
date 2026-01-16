import Link from 'next/link'

const tabs = [
  { id: 'overview', label: 'Overview', icon: '🏠' },
  { id: 'graph', label: 'Graph', icon: '📈' },
  { id: 'stats', label: 'Stats', icon: '📊' },
] as const

type TabId = (typeof tabs)[number]['id']

type LeaderboardTabsProps = {
  slug: string
  activeTab: TabId
  visibility: string
}

export default function LeaderboardTabs({ slug, activeTab, visibility }: LeaderboardTabsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2.5" style={{ viewTransitionName: 'leaderboard-tabs' }}>
        <span className="inline-flex items-center rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300/50 uppercase tracking-wider shadow-sm dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:ring-slate-700/70">
          {visibility}
        </span>
        <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white/90 p-1 text-sm font-semibold text-slate-600 shadow-sm backdrop-blur transition-all duration-200 dark:border-slate-700 dark:bg-slate-900/85 dark:text-slate-200">
          {tabs.map((tab) => {
            const href = tab.id === 'overview' ? `/lb/${slug}` : `/lb/${slug}/${tab.id}`
            const content = (
              <>
                <span className="text-base leading-none" aria-hidden="true">
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </>
            )

            if (tab.id === activeTab) {
              return (
                <span
                  key={tab.id}
                  aria-current="page"
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3.5 py-1.5 text-white shadow-sm transition-all duration-200 cursor-default dark:bg-white dark:text-slate-900"
                >
                  {content}
                </span>
              )
            }

            return (
              <Link
                key={tab.id}
                href={href}
                scroll={false}
                className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 transition-all duration-200 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                {content}
              </Link>
            )
          })}
        </div>
    </div>
  )
}
