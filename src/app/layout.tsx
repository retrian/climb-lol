import './globals.css'
import Link from 'next/link'
import Script from 'next/script'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AuthButtons } from '@/app/_components/AuthButtons'
import { ThemeToggle } from '@/app/_components/ThemeToggle'
import { MailboxPopoverClient } from '@/app/_components/MailboxPopoverClient'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

type ClubRow = {
  id: string
  name: string
  owner_user_id: string | null
}

type ClubInviteRow = {
  id: string
  club_id: string
  inviter_user_id: string | null
  created_at: string | null
}

type ClubShowdownRow = {
  id: string
  requester_club_id: string
  target_club_id: string
  created_at: string | null
  status: string | null
}

type ClubMemberRow = {
  club_id: string
  user_id: string
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  const user = data.user
  let username: string | null = null
  let mailboxInvites: Array<{ id: string; clubName: string; inviterName?: string | null; createdAt?: string | null }> = []
  let mailboxInboxShowdowns: Array<{
    id: string
    opponentName: string
    createdAt?: string | null
    requesterClubId: string
    targetClubId: string
    status?: string | null
  }> = []
  let mailboxOutgoingShowdowns: Array<{
    id: string
    opponentName: string
    createdAt?: string | null
    targetClubId: string
    status?: string | null
  }> = []
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

    const [invitesRes, clubsRes, membersRes, showdownsRes, profilesRes] = await Promise.all([
      supabase
        .from('club_invites')
        .select('id, club_id, inviter_user_id, created_at')
        .eq('invitee_user_id', user.id)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase.from('clubs').select('id, name'),
      supabase.from('club_members').select('club_id, user_id').eq('user_id', user.id),
      supabase
        .from('club_showdown_requests')
        .select('id, requester_club_id, target_club_id, created_at, status')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('profiles').select('user_id, username'),
    ])

    const clubs = (clubsRes.data ?? []) as ClubRow[]
    const clubNames = new Map(clubs.map((club) => [club.id, club.name]))
    const profileNames = new Map((profilesRes.data ?? []).map((p) => [p.user_id, p.username]))

    mailboxInvites = ((invitesRes.data ?? []) as ClubInviteRow[]).map((invite) => ({
      id: invite.id,
      clubName: clubNames.get(invite.club_id) ?? 'Club invite',
      inviterName: invite.inviter_user_id ? profileNames.get(invite.inviter_user_id) : null,
      createdAt: invite.created_at,
    }))

    const memberClubIds = new Set(((membersRes.data ?? []) as ClubMemberRow[]).map((row) => row.club_id))
    const ownedClubIds = new Set(clubs.filter((club) => club.owner_user_id === user.id).map((club) => club.id))
    const myClubIds = new Set([...memberClubIds, ...ownedClubIds])

    const showdownRows = (showdownsRes.data ?? []) as ClubShowdownRow[]
    mailboxInboxShowdowns = showdownRows
      .filter((request) => myClubIds.has(request.target_club_id))
      .slice(0, 10)
      .map((request) => ({
        id: request.id,
        opponentName: clubNames.get(request.requester_club_id) ?? 'Club challenge',
        requesterClubId: request.requester_club_id,
        targetClubId: request.target_club_id,
        createdAt: request.created_at,
        status: request.status ?? 'PENDING',
      }))

    mailboxOutgoingShowdowns = showdownRows
      .filter((request) => myClubIds.has(request.requester_club_id))
      .slice(0, 10)
      .map((request) => ({
        id: request.id,
        opponentName: clubNames.get(request.target_club_id) ?? 'Club challenge',
        targetClubId: request.target_club_id,
        createdAt: request.created_at,
        status: request.status ?? 'PENDING',
      }))
  }

  async function acceptShowdown(formData: FormData) {
    'use server'

    const requestId = String(formData.get('request_id') ?? '').trim()
    const targetClubId = String(formData.get('target_club_id') ?? '').trim()
    if (!requestId || !targetClubId) redirect('/showdown?err=Missing request')

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')
    const userId = user.id

    const { data: member } = await supabase
      .from('club_members')
      .select('id')
      .eq('club_id', targetClubId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!member?.id) {
      const { data: ownedClub } = await supabase
        .from('clubs')
        .select('id')
        .eq('id', targetClubId)
        .eq('owner_user_id', userId)
        .maybeSingle()
      if (!ownedClub?.id) redirect('/showdown?err=Only target club members can accept')
    }

    const { error } = await supabase
      .from('club_showdown_requests')
      .update({ status: 'ACCEPTED' })
      .eq('id', requestId)
      .eq('target_club_id', targetClubId)
      .eq('status', 'PENDING')

    if (error) redirect(`/showdown?err=${encodeURIComponent(error.message)}`)

    revalidatePath('/showdown')
    revalidatePath(`/showdown/${requestId}`)
    redirect(`/showdown/${requestId}`)
  }

  async function cancelShowdown(formData: FormData) {
    'use server'

    const requestId = String(formData.get('request_id') ?? '').trim()
    const requesterClubId = String(formData.get('requester_club_id') ?? '').trim()
    if (!requestId || !requesterClubId) redirect('/showdown?err=Missing request')

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')
    const userId = user.id

    const { data: member } = await supabase
      .from('club_members')
      .select('id')
      .eq('club_id', requesterClubId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!member?.id) {
      const { data: ownedClub } = await supabase
        .from('clubs')
        .select('id')
        .eq('id', requesterClubId)
        .eq('owner_user_id', userId)
        .maybeSingle()
      if (!ownedClub?.id) redirect('/showdown?err=Only requesting club members can cancel')
    }

    const { error } = await supabase
      .from('club_showdown_requests')
      .delete()
      .eq('id', requestId)
      .eq('requester_club_id', requesterClubId)

    if (error) redirect(`/showdown?err=${encodeURIComponent(error.message)}`)

    revalidatePath('/showdown')
    redirect('/showdown?ok=Request cancelled')
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
              <MailboxPopoverClient
                invites={mailboxInvites}
                inboxShowdowns={mailboxInboxShowdowns}
                outgoingShowdowns={mailboxOutgoingShowdowns}
                onAcceptShowdown={acceptShowdown}
                onCancelShowdown={cancelShowdown}
              />
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
        <main className="mx-auto w-full max-w-none flex-1 px-0">
          {children}
        </main>
        <footer className="border-t border-gray-200 py-6 text-sm text-gray-600 dark:border-slate-800 dark:text-slate-300">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} CWF.LOL</span>
            <div className="flex flex-wrap gap-4">
              <Link className="transition hover:text-gray-900 dark:hover:text-white" href="/faq">
                FAQ
              </Link>
              <Link className="transition hover:text-gray-900 dark:hover:text-white" href="/changelog">
                Changelog
              </Link>
              <Link className="transition hover:text-gray-900 dark:hover:text-white" href="/terms">
                Terms
              </Link>
              <Link className="transition hover:text-gray-900 dark:hover:text-white" href="/privacy">
                Privacy
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
