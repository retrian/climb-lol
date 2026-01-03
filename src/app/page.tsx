import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-20">
      <div className="max-w-3xl">
        <h1 className="text-5xl font-bold tracking-tight text-gray-900">
          Track NA ranked climbs.
        </h1>
        <p className="mt-4 text-lg text-gray-600">
          Create a leaderboard for up to 15 players. Share it publicly, unlisted, or keep it private.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link 
            href="/leaderboards" 
            className="rounded-lg bg-gray-900 px-6 py-3 font-medium text-white transition hover:bg-gray-800"
          >
            View leaderboards
          </Link>
          <Link 
            href="/sign-in" 
            className="rounded-lg border border-gray-300 bg-white px-6 py-3 font-medium text-gray-700 transition hover:bg-gray-50"
          >
            Sign in
          </Link>
        </div>
      </div>

      {/* Optional: Feature highlights */}
      <div className="mt-20 grid gap-8 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <svg className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900">Track Players</h3>
          <p className="mt-2 text-sm text-gray-600">Monitor up to 15 players in real-time ranked progress</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <svg className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900">Share Easily</h3>
          <p className="mt-2 text-sm text-gray-600">Public, unlisted, or private visibility options</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
            <svg className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h3 className="font-semibold text-gray-900">Real-time Updates</h3>
          <p className="mt-2 text-sm text-gray-600">See live rank changes and game statistics</p>
        </div>
      </div>
    </main>
  )
}
