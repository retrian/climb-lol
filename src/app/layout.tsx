import './globals.css'
import Link from 'next/link'
import Script from 'next/script'
import { createClient } from '@/lib/supabase/server'
import { AuthButtons } from '@/app/_components/AuthButtons'
import { ThemeToggle } from '@/app/_components/ThemeToggle'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="theme-preference" strategy="beforeInteractive">
          {`(() => {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const getStored = () => window.localStorage.getItem('theme-preference');
  const getTheme = () => {
    const stored = getStored();
    return stored === 'dark' || stored === 'light'
      ? stored
      : (media.matches ? 'dark' : 'light');
  };
  const apply = (theme) => {
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    root.dataset.theme = theme;
  };
  apply(getTheme());
  const handleChange = () => {
    if (!getStored()) {
      apply(media.matches ? 'dark' : 'light');
    }
  };
  if (media.addEventListener) {
    media.addEventListener('change', handleChange);
  } else {
    media.addListener(handleChange);
  }
})();`}
        </Script>
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 dark:bg-slate-950 dark:text-slate-100">
        {/* Sticky / translucent navbar */}
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-slate-800 dark:bg-slate-950/70 supports-[backdrop-filter]:dark:bg-slate-950/60">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-bold text-gray-900 dark:text-slate-100">
              CWF.LOL
            </Link>

            <div className="flex items-center gap-6">
              <Link
                className="text-sm font-medium text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-white"
                href="/"
              >
                Home
              </Link>
              <Link
                className="text-sm font-medium text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-white"
                href="/leaderboards"
              >
                Leaderboards
              </Link>
              {user ? (
                <Link
                  className="text-sm font-medium text-gray-600 transition hover:text-gray-900 dark:text-slate-300 dark:hover:text-white"
                  href="/dashboard"
                >
                  Dashboard
                </Link>
              ) : null}
              <ThemeToggle />
              <AuthButtons signedIn={!!user} />
            </div>
          </nav>
        </header>

        {/* Consistent page width/padding across ALL pages */}
        <main className="mx-auto w-full max-w-6xl px-4">
          {children}
        </main>
      </body>
    </html>
  )
}
