export default function ChangelogPage() {
  return (
    <section className="py-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <article className="rounded-2xl border border-slate-200/50 bg-white/90 px-6 py-8 shadow-[0_30px_120px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/70">
          <div className="flex flex-col gap-3 border-b border-slate-200/60 pb-6 dark:border-slate-800/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              January 25, 2026
            </p>
            <h1 className="text-3xl font-semibold uppercase tracking-[0.08em] text-slate-950 dark:text-white">
              CWF.LOL Update
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Continuing to improve the website and pushing for a full release soon.
            </p>
          </div>

          <div className="mt-6 space-y-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ LEADERBOARDS ]
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>Leaderboards are complete with new modes (Dashboard → Leaderboard Settings).</li>
                <li>Live tracker mode.</li>
                <li>Race mode.</li>
                <li>LP goal mode.</li>
                <li>Rank goal mode.</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ TRACKING ]
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>
                  We accurately track data now. If any issues pop up, please report ASAP to @retri.
                </li>
                <li>LP graph is now functional and displays properly.</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ FEATURES ]
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>Added match history by clicking players on the leaderboard.</li>
                <li>Added match details for recent activity by clicking game cards.</li>
                <li>Added stats page.</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ FIXES ]
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>Fixed a bug where users could not log in via Google.</li>
                <li>Many performance issues fixed.</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ UP NEXT ]
              </p>
              <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">
                Working on the clubs feature.
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-slate-200/50 bg-white/90 px-6 py-8 shadow-[0_30px_120px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/70">
          <div className="flex flex-col gap-3 border-b border-slate-200/60 pb-6 dark:border-slate-800/70">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
              January 9, 2026
            </p>
            <h2 className="text-3xl font-semibold uppercase tracking-[0.08em] text-slate-950 dark:text-white">CWF.LOL Update</h2>
            <p className="max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              Early season notes and polish updates for the beta release.
            </p>
          </div>

          <div className="mt-6 space-y-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ GAMEPLAY ]
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>LP graph is still in progress and being tuned for accuracy.</li>
                <li>Most gained / most lost cards are being refined for edge cases.</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ QUALITY OF LIFE ]
              </p>
              <ul className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>Latest Activity now includes remakes for accurate streaks.</li>
                <li>Hover details now show promotion LP deltas.</li>
                <li>Improved “no LP change” visuals for Valor and placements.</li>
              </ul>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                [ PERFORMANCE ]
              </p>
              <div className="mt-3 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <p>
                  Working on making the site more responsive and lightweight to reduce resource
                  usage.
                </p>
                <p>More features and fixes coming throughout the weekend.</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  )
}
