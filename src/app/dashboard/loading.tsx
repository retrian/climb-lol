export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto flex max-w-5xl items-center justify-center px-4 py-24">
        <div className="flex items-center gap-3 rounded-none border border-slate-200/80 bg-white px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-800/80 dark:bg-slate-900 dark:text-slate-200">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900 dark:border-slate-700 dark:border-t-white"
            aria-hidden="true"
          />
          <span>Loading dashboard…</span>
        </div>
      </div>
    </div>
  )
}
