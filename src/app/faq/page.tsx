const faqs = [
  {
    question: 'What is CWF.LOL?',
    answer:
      'CWF.LOL is a website that lets you create custom League of Legends leaderboards to track yourself and friends.',
  },
  {
    question: 'What if I have an issue adding a player?',
    answer:
      'Make sure there are no extra spaces in the Riot ID. We recommend copying the Riot ID directly from the League client. If the issue persists, please contact @retri_ on Discord.',
  },
  {
    question: 'How often is player data updated?',
    answer: 'Player data updates every 30 minutes. A manual refresh button will be added soon.',
  },
  {
    question: 'Why are there no stats for my players?',
    answer:
      'If the season has just started, players must complete at least 5 games. After that, stats may take up to 30 minutes to appear. If the issue continues, please wait for the next update cycle.',
  },
  {
    question: 'Will more customization options be added later?',
    answer: 'Yes.',
  },
  {
    question: 'How can I report a bug or suggest a feature?',
    answer: 'Please message @retri_ on Discord.',
  },
]

export default function FaqPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-50 dark:from-slate-950 dark:via-slate-950 dark:to-slate-900">
      <div className="mx-auto max-w-4xl px-4 py-10 lg:py-16">
        <div className="mb-10">
          <h1 className="text-4xl lg:text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-600 dark:from-white dark:via-slate-200 dark:to-slate-400">
            FAQ
          </h1>
          <p className="mt-3 text-base text-slate-600 font-medium dark:text-slate-300">
            Answers to common questions about CWF.LOL.
          </p>
        </div>

        <div className="space-y-3">
          {faqs.map((item) => (
            <div
              key={item.question}
              className="rounded-2xl border-2 border-slate-200 bg-white p-5 lg:p-6 shadow-sm transition-all duration-200 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <h2 className="text-base lg:text-lg font-bold text-slate-900 dark:text-slate-100">
                {item.question}
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
