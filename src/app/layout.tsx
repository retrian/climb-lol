import './globals.css'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { AuthButtons } from '@/app/_components/AuthButtons'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900">
        {/* Sticky / translucent navbar */}
        <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/60">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-bold text-gray-900">
              CWF.LOL
            </Link>

            <div className="flex items-center gap-6">
              <Link className="text-sm font-medium text-gray-600 transition hover:text-gray-900" href="/">
                Home
              </Link>
              <Link className="text-sm font-medium text-gray-600 transition hover:text-gray-900" href="/leaderboards">
                Leaderboards
              </Link>
              {user ? (
                <Link className="text-sm font-medium text-gray-600 transition hover:text-gray-900" href="/dashboard">
                  Dashboard
                </Link>
              ) : null}
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
