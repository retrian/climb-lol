import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'FAQ | CWF.LOL',
}

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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-12 text-sm leading-6 text-slate-200">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold text-white">CWF.LOL — FAQ</h1>
        <p className="text-slate-300">Answers to common questions about CWF.LOL</p>
      </header>

      {faqs.map((item, idx) => (
        <section key={item.question} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-white">
            {idx + 1}) {item.question}
          </h2>
          <p>{item.answer}</p>
        </section>
      ))}
    </main>
  )
}
