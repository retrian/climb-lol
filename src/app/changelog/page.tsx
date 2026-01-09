export default function ChangelogPage() {
  return (
    <section className="py-10">
      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
          Jan 9, 2026
        </p>
        <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">
          Early Season Updates (Beta)
        </h1>
        <p className="max-w-2xl text-base text-gray-600 dark:text-slate-300">
          CWF.LOL isn’t fully polished yet, but I’m actively keeping it updated during early season
          and plan to maintain it long-term.
        </p>
      </div>

      <div className="mt-10 grid gap-8">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">In progress</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-gray-600 dark:text-slate-300">
            <li>LP graph (still a work in progress)</li>
            <li>“Most Gained” / “Most Lost” cards (still being refined)</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recently added</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-gray-600 dark:text-slate-300">
            <li>Latest Activity now includes remakes</li>
            <li>Hover details for promotion LP</li>
            <li>Clear “no LP change” visuals for cases like Valor or finishing placements</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/40">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Performance</h2>
          <div className="mt-3 space-y-3 text-gray-600 dark:text-slate-300">
            <p>
              Working on making the site more responsive + lightweight so it uses fewer resources
              (more improvements coming).
            </p>
            <p>More features and fixes coming throughout the weekend.</p>
          </div>
        </section>
      </div>
    </section>
  )
}
