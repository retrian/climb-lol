import './globals.css'
import Link from 'next/link'
import Script from 'next/script'
import { createClient } from '@/lib/supabase/server'
import { AuthButtons } from '@/app/_components/AuthButtons'
import { ThemeToggle } from '@/app/_components/ThemeToggle'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  let username: string | null = null
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('user_id', user.id)
      .maybeSingle()
    username =
      profile?.username ??
      (user.user_metadata?.full_name as string | undefined) ??
      user.email?.split('@')[0] ??
      null
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-preference" strategy="beforeInteractive">
          {`(() => {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const storageKey = 'theme-preference';
  const saved = localStorage.getItem(storageKey) || 'system';
  const apply = (pref) => {
    const isDark = pref === 'dark' || (pref === 'system' && media.matches);
    root.classList.toggle('dark', isDark);
    root.dataset.theme = isDark ? 'dark' : 'light';
    root.style.colorScheme = isDark ? 'dark' : 'light';
  };
  apply(saved);
  const onChange = () => apply(localStorage.getItem(storageKey) || 'system');
  if (media.addEventListener) {
    media.addEventListener('change', onChange);
  } else {
    media.addListener(onChange);
  }
})();`}
        </Script>
      </head>
      <body className="flex min-h-screen flex-col bg-background text-foreground">
        {/* Modern navbar with better spacing and hierarchy */}
        <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/80 backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:border-slate-800/80 dark:bg-slate-950/80 supports-[backdrop-filter]:dark:bg-slate-950/70">
          <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
            {/* Logo */}
            <Link 
              href="/" 
              className="text-xl font-black tracking-tighter text-gray-900 transition-colors hover:text-gray-700 dark:text-slate-100 dark:hover:text-slate-300"
            >
              CWF.LOL
            </Link>

            {/* Desktop Navigation Links */}
            <div className="hidden items-center gap-1 md:flex">
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/"
              >
                Home
              </Link>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/showdown"
              >
                Showdown
              </Link>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/tournaments"
              >
                Tournaments
              </Link>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/challenges"
              >
                Challenges
              </Link>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/clubs"
              >
                Clubs
              </Link>
              <Link
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/leaderboards"
              >
                Leaderboards
              </Link>
            </div>

            {/* Right side actions */}
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <AuthButtons signedIn={!!user} username={username} />
            </div>
          </nav>

          {/* Mobile Navigation (shown on small screens) */}
          <div className="border-t border-gray-200/80 px-4 py-2 dark:border-slate-800/80 md:hidden">
            <div className="flex flex-wrap items-center justify-center gap-1">
              <Link
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/"
              >
                Home
              </Link>
              <Link
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/showdown"
              >
                Showdown
              </Link>
              <Link
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/tournaments"
              >
                Tournaments
              </Link>
              <Link
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/challenges"
              >
                Challenges
              </Link>
              <Link
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/clubs"
              >
                Clubs
              </Link>
              <Link
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-100 hover:text-gray-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                href="/leaderboards"
              >
                Leaderboards
              </Link>
            </div>
          </div>
        </header>

        {/* Consistent page width/padding across ALL pages */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4">
          {children}
        </main>
        <footer className="border-t border-gray-200 py-6 text-sm text-gray-600 dark:border-slate-800 dark:text-slate-300">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} CWF.LOL</span>
            <div className="flex gap-4">
              <Link className="transition hover:text-gray-900 dark:hover:text-white" href="/faq">
                FAQ
              </Link>
              <Link className="transition hover:text-gray-900 dark:hover:text-white" href="/changelog">
                Changelog
              </Link>
            </div>
          </div>
        </footer>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}