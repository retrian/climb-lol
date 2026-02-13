export default function Loading() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 text-slate-900 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900 dark:text-slate-100">
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

        <div className="mx-auto w-full max-w-[1460px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
            <div className="h-6 w-48 rounded-full bg-slate-200/70 animate-pulse dark:bg-slate-800" />
            <div className="mt-6 h-[520px] rounded-2xl bg-slate-200/70 animate-pulse dark:bg-slate-800" />
          </div>
        </div>
      </div>
    </main>
  )
}
