import Link from 'next/link'

type FeatureIconName = 'users' | 'share' | 'bolt'

function FeatureIcon({ name }: { name: FeatureIconName }) {
  switch (name) {
    case 'users':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 20h5v-1a4 4 0 00-4-4h-1M9 20H2v-1a6 6 0 0112 0v1m3-12a4 4 0 10-8 0 4 4 0 008 0z"
          />
        </svg>
      )
    case 'share':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 8a3 3 0 10-2.83-4H12a3 3 0 003 4zM6 14a3 3 0 10-2.83-4H3a3 3 0 003 4zm15 0a3 3 0 10-2.83-4H18a3 3 0 003 4zM8.6 12l6.8-3M8.6 12l6.8 3"
          />
        </svg>
      )
    case 'bolt':
      return (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      )
  }
}

export default function HomePage() {
  const features: Array<{ title: string; desc: string; icon: FeatureIconName }> = [
    {
      title: 'Track Players',
      desc: 'Monitor up to 30 players with ranked-only stats and progress snapshots.',
      icon: 'users',
    },
    {
      title: 'Share Easily',
      desc: 'Public, unlisted, or private visibility options for every board.',
      icon: 'share',
    },
    {
      title: 'Real-time Updates',
      desc: 'Latest games + rank snapshots refreshed on a schedule.',
      icon: 'bolt',
    },
  ]

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-10 lg:py-16">
        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400">
              Track NA Ranked Climbs
            </h1>
          </div>
          <p className="text-base text-slate-600 font-medium dark:text-slate-300">
            Create a leaderboard, start climbing with friends
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border-2 border-slate-200 bg-white p-5 lg:p-6 shadow-sm transition-all duration-200 hover:border-slate-300 hover:shadow-lg hover:-translate-y-0.5 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  <FeatureIcon name={f.icon} />
                </div>

                <div className="min-w-0">
                  <h3 className="text-base lg:text-lg font-bold text-slate-900 group-hover:text-slate-700 transition-colors dark:text-slate-100 dark:group-hover:text-white">
                    {f.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">{f.desc}</p>
                </div>

                <div className="ml-auto flex-shrink-0 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-1 transition-all duration-200 dark:text-slate-600 dark:group-hover:text-slate-400">
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
