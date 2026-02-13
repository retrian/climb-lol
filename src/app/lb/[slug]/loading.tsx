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

        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,820px)_280px] gap-8 lg:gap-10 items-start justify-center">
          <aside className="order-2 lg:order-1">
            <div className="h-5 w-32 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={`latest-${idx}`} className="h-20 rounded-2xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
              ))}
            </div>
          </aside>

          <div className="order-1 lg:order-2 space-y-6">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={`card-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="h-4 w-40 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
                <div className="mt-4 h-24 rounded-xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
              </div>
            ))}
          </div>

          <aside className="order-3 hidden lg:block">
            <div className="h-5 w-32 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={`mover-${idx}`} className="h-20 rounded-2xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
