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
        <header className="border-b border-gray-200 bg-white">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <Link href="/" className="text-lg font-bold text-gray-900">
              climb.lol
            </Link>

            <div className="flex items-center gap-6">
              <Link className="text-sm font-medium text-gray-600 hover:text-gray-900 transition" href="/">
                Home
              </Link>
              <Link className="text-sm font-medium text-gray-600 hover:text-gray-900 transition" href="/leaderboards">
                Leaderboards
              </Link>
              {user ? (
                <Link className="text-sm font-medium text-gray-600 hover:text-gray-900 transition" href="/dashboard">
                  Dashboard
                </Link>
              ) : null}
              <AuthButtons signedIn={!!user} />
            </div>
          </nav>
        </header>

        {children}
      </body>
    </html>
  )
}