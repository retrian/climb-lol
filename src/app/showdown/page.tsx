import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import ShowdownRequestClient from './ShowdownRequestClient'

type ClubRow = {
  id: string
  name: string
  slug: string
  owner_user_id: string | null
  banner_url?: string | null
}

type ShowdownRow = {
  id: string
  requester_club_id: string
  target_club_id: string
  status: string | null
  created_at: string | null
}

function formatDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ShowdownPage({
  searchParams,
}: {
  searchParams?: Promise<{ ok?: string; err?: string }> | { ok?: string; err?: string }
}) {
  const sp = await Promise.resolve(searchParams ?? {})
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user

  const [clubsRes, membersRes, showdownsRes] = await Promise.all([
    supabase.from('clubs').select('id, name, slug, owner_user_id, banner_url').order('name', { ascending: true }),
    user
      ? supabase.from('club_members').select('club_id, user_id').eq('user_id', user.id)
      : Promise.resolve({ data: [] as Array<{ club_id: string; user_id: string }>, error: null }),
    supabase
      .from('club_showdown_requests')
      .select('id, requester_club_id, target_club_id, status, created_at')
      .eq('status', 'ACCEPTED')
      .order('created_at', { ascending: false })
      .limit(6),
  ])

  const clubs = (clubsRes.data ?? []) as ClubRow[]
  const clubMap = new Map(clubs.map((club) => [club.id, club]))

  const membershipClubIds = new Set((membersRes.data ?? []).map((row) => row.club_id))
  const ownedClub = clubs.find((club) => club.owner_user_id === user?.id) ?? null
  const defaultClubId = ownedClub?.id ?? (membershipClubIds.values().next().value as string | undefined) ?? null

  const canRequest = !!user && (Boolean(ownedClub) || membershipClubIds.size > 0)

  const showdowns = (showdownsRes.data ?? []) as ShowdownRow[]

  async function requestShowdown(formData: FormData) {
    'use server'

    const requesterClubId = String(formData.get('requester_club_id') ?? '').trim()
    const targetClubId = String(formData.get('target_club_id') ?? '').trim()

    if (!requesterClubId || !targetClubId) {
      redirect('/showdown?err=Select both clubs')
    }

    if (requesterClubId === targetClubId) {
      redirect('/showdown?err=Select a different opponent')
    }

    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    const user = auth.user
    if (!user) redirect('/sign-in')

    const { data: member } = await supabase
      .from('club_members')
      .select('id')
      .eq('club_id', requesterClubId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!member?.id) {
      const { data: ownedClub } = await supabase
        .from('clubs')
        .select('id')
        .eq('id', requesterClubId)
        .eq('owner_user_id', user.id)
        .maybeSingle()
      if (!ownedClub?.id) redirect('/showdown?err=Only club members can request showdowns')
    }

    const { data: existing } = await supabase
      .from('club_showdown_requests')
      .select('id')
      .eq('requester_club_id', requesterClubId)
      .eq('target_club_id', targetClubId)
      .eq('status', 'PENDING')
      .maybeSingle()

    if (existing?.id) redirect('/showdown?err=Showdown already requested')

    const { error } = await supabase.from('club_showdown_requests').insert({
      requester_club_id: requesterClubId,
      target_club_id: targetClubId,
      requester_user_id: user.id,
    })

    if (error) redirect(`/showdown?err=${encodeURIComponent(error.message)}`)

    revalidatePath('/showdown')
    redirect('/showdown?ok=Request sent')
  }

  const okMessage = sp.ok ?? null
  const errMessage = sp.err ?? null

  return (
    <div className="py-10 lg:py-14">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Club battles</p>
              <h1 className="mt-3 text-3xl font-black text-slate-900 dark:text-slate-100">Showdown</h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Challenge another club to a head-to-head showdown and settle the debate.
              </p>
            </div>
            <Link
              href="/clubs"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
            >
              Browse clubs
            </Link>
          </div>
        </div>

        {(okMessage || errMessage) && (
          <div className="space-y-3">
            {okMessage && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                {okMessage}
              </div>
            )}
            {errMessage && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {errMessage}
              </div>
            )}
          </div>
        )}

        <section className="space-y-6">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Request a showdown</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Pick your club and your opponent to start the challenge.</p>
            <div className="mt-6">
              <ShowdownRequestClient
                action={requestShowdown}
                clubs={clubs.map((club) => ({ id: club.id, name: club.name }))}
                canRequest={canRequest}
                defaultClubId={defaultClubId}
              />
            </div>
          </div>

        </section>

        <section className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Active showdowns</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Accepted matchups ready for a detailed breakdown.</p>
          <div className="mt-5 space-y-3">
            {showdowns.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-12 text-center dark:border-slate-700 dark:bg-slate-900">
                <p className="text-sm font-semibold text-slate-600 dark:text-slate-200">No active showdowns yet</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Accept a request to start one.</p>
              </div>
            ) : (
              showdowns.map((request) => {
                const requester = clubMap.get(request.requester_club_id)
                const target = clubMap.get(request.target_club_id)
                const createdLabel = formatDate(request.created_at)

                return (
                  <div
                    key={request.id}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="relative flex h-32 w-full">
                      {requester?.banner_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={requester.banner_url}
                          alt=""
                          className="h-full w-1/2 object-cover scale-125"
                        />
                      ) : (
                        <div className="h-full w-1/2 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700" />
                      )}
                      {target?.banner_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={target.banner_url}
                          alt=""
                          className="absolute right-0 top-0 h-full w-1/2 object-cover scale-125"
                          style={{ clipPath: 'polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%)' }}
                        />
                      ) : (
                        <div
                          className="absolute right-0 top-0 h-full w-1/2 bg-gradient-to-br from-slate-800 via-slate-700 to-slate-600"
                          style={{ clipPath: 'polygon(20% 0%, 100% 0%, 100% 100%, 0% 100%)' }}
                        />
                      )}
                    </div>
                    <div className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">
                          {requester?.name ?? 'Club'} vs {target?.name ?? 'Club'}
                        </p>
                        <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200">
                          Accepted
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>Accepted {createdLabel ?? 'Recently'}</span>
                        <Link
                          href={`/showdown/${request.id}`}
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                        >
                          View detail
                        </Link>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
