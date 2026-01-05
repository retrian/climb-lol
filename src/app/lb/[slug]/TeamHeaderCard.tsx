import Link from 'next/link'

export default function TeamHeaderCard({
  name,
  description,
  visibility,
  lastUpdated,
  cutoffs,
  bannerUrl,
  actionHref,
  actionLabel,
}: {
  name: string
  description?: string | null
  visibility: string
  lastUpdated: string | null
  cutoffs: Array<{ label: string; lp: number; icon: string }>
  bannerUrl: string | null
  actionHref: string
  actionLabel: string
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white border border-slate-200 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      {/* Background pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900" />
      <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.5))] pointer-events-none dark:bg-grid-slate-800 dark:[mask-image:linear-gradient(0deg,rgba(15,23,42,0.9),rgba(15,23,42,0.4))]" />

      {/* Banner Image Area */}
      {bannerUrl && (
        <div className="relative h-48 w-full border-b border-slate-100 bg-slate-100 dark:border-slate-800 dark:bg-slate-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bannerUrl}
            alt="Leaderboard Banner"
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Content Area */}
      <div className="relative flex flex-col lg:flex-row">
        {/* Left: Info */}
        <div className="flex-1 p-8 lg:p-10">
          <div className="flex flex-wrap items-center gap-2.5 mb-6">
            <span className="inline-flex items-center rounded-full bg-gradient-to-r from-slate-100 to-slate-50 px-3.5 py-1.5 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300/50 uppercase tracking-wider shadow-sm dark:from-slate-800 dark:to-slate-900 dark:text-slate-200 dark:ring-slate-700/70">
              {visibility}
            </span>
            {actionHref && actionLabel && (
              <Link
                href={actionHref}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 7-7" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18" />
                </svg>
                {actionLabel}
              </Link>
            )}
          </div>

          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 mb-4 pb-2 dark:from-white dark:via-slate-200 dark:to-slate-400">
            {name}
          </h1>
          {description && (
            <p className="text-base lg:text-lg text-slate-600 leading-relaxed max-w-2xl font-medium dark:text-slate-300">
              {description}
            </p>
          )}
        </div>

        {/* Right: Cutoffs Widget */}
        {cutoffs.length > 0 && (
          <div className="bg-gradient-to-br from-slate-50 to-white border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 flex flex-col justify-center gap-5 dark:from-slate-950 dark:to-slate-900 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full" />
              <div className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Rank Cutoffs
              </div>
            </div>
            {cutoffs.map((c) => (
              <div
                key={c.label}
                className="group flex items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.icon} alt={c.label} className="w-12 h-12 object-contain drop-shadow-sm" />
                <div className="flex-1">
                  <div className="text-xs font-bold text-slate-500 uppercase tracking-wide dark:text-slate-400">
                    {c.label}
                  </div>
                  <div className="text-lg font-black text-slate-900 dark:text-slate-100">{c.lp} LP</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
