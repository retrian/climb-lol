// Reusable skeleton primitive — swap animation here once, affects all skeletons
function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-slate-200/70 animate-pulse dark:bg-slate-800 ${className}`}
    />
  );
}

// Pre-defined arrays outside the component so they're never re-created on render
const LATEST_ITEMS = Array.from({ length: 4 });
const CARD_ITEMS = Array.from({ length: 3 });
const MOVER_ITEMS = Array.from({ length: 3 });

export default function Loading() {
  return (
    <main
      aria-label="Loading content"
      aria-busy="true"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900"
    >
      <div className="mx-auto px-6 py-8 lg:px-10 lg:py-12 space-y-10 lg:space-y-12">

        {/* Hero / header skeleton */}
        <div className="mx-auto w-full max-w-[1460px]">
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
            <div className="relative flex flex-col lg:flex-row">

              {/* Left: title + subtitle */}
              <div className="flex-1 p-8 lg:p-10">
                <Skeleton className="mb-4 lg:mb-6 h-10 w-64 rounded-full" />
                <Skeleton className="h-12 w-3/4 rounded-xl" />
                <Skeleton className="mt-4 h-4 w-2/3 rounded-full" />
              </div>

              {/* Right: stats panel */}
              <div className="border-t lg:border-t-0 lg:border-l border-slate-200 p-6 lg:p-8 lg:w-80 dark:border-slate-800">
                <Skeleton className="h-5 w-32 rounded-full" />
                <div className="mt-4 space-y-3">
                  <Skeleton className="h-16 rounded-2xl" />
                  <Skeleton className="h-16 rounded-2xl" />
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* Three-column body skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,820px)_280px] gap-8 lg:gap-10 items-start justify-center">

          {/* Left sidebar */}
          <aside className="order-2 lg:order-1">
            <Skeleton className="h-5 w-32 rounded-full" />
            <div className="mt-4 space-y-3">
              {LATEST_ITEMS.map((_, idx) => (
                <Skeleton key={`latest-${idx}`} className="h-20 rounded-2xl" />
              ))}
            </div>
          </aside>

          {/* Main feed */}
          <div className="order-1 lg:order-2 space-y-6">
            {CARD_ITEMS.map((_, idx) => (
              <div
                key={`card-${idx}`}
                className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <Skeleton className="h-4 w-40 rounded-full" />
                <Skeleton className="mt-4 h-24 rounded-xl" />
              </div>
            ))}
          </div>

          {/* Right sidebar */}
          <aside className="order-3 hidden lg:block">
            <Skeleton className="h-5 w-32 rounded-full" />
            <div className="mt-4 space-y-3">
              {MOVER_ITEMS.map((_, idx) => (
                <Skeleton key={`mover-${idx}`} className="h-20 rounded-2xl" />
              ))}
            </div>
          </aside>

        </div>
      </div>
    </main>
  );
}