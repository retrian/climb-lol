export default function Loading() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto w-full max-w-none px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">
        <div className="mx-auto w-full max-w-[1460px]">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
            <div className="relative flex flex-col lg:flex-row">
              <div className="flex-1 p-8 lg:p-10">
                <div className="mb-4 lg:mb-6 h-10 w-64 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                <div className="h-12 w-3/4 rounded-xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                <div className="mt-4 h-4 w-2/3 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
              </div>
              <div className="border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 dark:border-slate-800">
                <div className="h-5 w-32 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                <div className="mt-4 space-y-3">
                  <div className="h-16 rounded-2xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                  <div className="h-16 rounded-2xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1460px] space-y-10 lg:space-y-12">
          <section className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={`stat-card-${idx}`}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="h-3 w-24 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                <div className="mt-3 h-8 w-28 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                <div className="mt-2 h-3 w-32 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
              </div>
            ))}
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-1 w-8 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600" />
              <div className="h-4 w-40 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="h-6 w-48 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
              <div className="mt-4 space-y-3">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <div key={`row-${idx}`} className="h-10 rounded-xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
