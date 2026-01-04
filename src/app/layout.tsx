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
      <body>
        <header>
          <nav>
            <Link href="/">climb.lol</Link>

            <div>
              <Link href="/">Home</Link>
              <Link href="/leaderboards">Leaderboards</Link>
              {user ? <Link href="/dashboard">Dashboard</Link> : null}
              <AuthButtons signedIn={!!user} />
            </div>
          </nav>
        </header>

        {children}
      </body>
    </html>
  )
}
