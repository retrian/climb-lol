import './globals.css'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AuthButtons } from '@/app/_components/AuthButtons'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user

  // Set theme ASAP to avoid flash. Uses html.dark (Tailwind darkMode: 'class')
  const themeInitScript = `
    (function () {
      try {
        var saved = localStorage.getItem('theme');
        var theme = (saved === 'light' || saved === 'dark')
          ? saved
          : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

        var root = document.documentElement;
        if (theme === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
      } catch (e) {}
    })();
  `

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>

      <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
        {/* Sticky / translucent navbar */}
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-slate-800 dark:bg-slate-950/70 dark:supports-[backdrop-filter]:bg-slate-950/60">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-extrabold tracking-tight text-gray-900 dark:text-slate-100">
              CWF.LOL
            </Link>

            <div className="flex items-center gap-4 sm:gap-6">
              <Link
                className="text-sm font-semibold text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"
                href="/"
              >
                Home
              </Link>

              <Link
                className="text-sm font-semibold text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"
                href="/leaderboards"
              >
                Leaderboards
              </Link>

              {user ? (
                <Link
                  className="text-sm font-semibold text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100"
                  href="/dashboard"
                >
                  Dashboard
                </Link>
              ) : null}

            </div>
          </nav>
        </header>

        {/* Consistent page width/padding across ALL pages */}
        <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
