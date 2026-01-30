import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type ShowdownRow = {
  id: string
  requester_club_id: string
  target_club_id: string
  status: string | null
  created_at: string | null
}

type ClubRow = {
  id: string
  name: string
  slug: string
}

function formatDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ShowdownDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: showdown } = await supabase
    .from('club_showdown_requests')
    .select('id, requester_club_id, target_club_id, status, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!showdown) notFound()

  const clubIds = [showdown.requester_club_id, showdown.target_club_id]
  const { data: clubs } = await supabase.from('clubs').select('id, name, slug').in('id', clubIds)
  const clubById = new Map((clubs ?? []).map((club: ClubRow) => [club.id, club]))

  const requester = clubById.get(showdown.requester_club_id)
  const target = clubById.get(showdown.target_club_id)
  const createdLabel = formatDate(showdown.created_at)

  return (
    <div className="py-10 lg:py-14">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-slate-500 dark:text-slate-400">Showdown</p>
              <h1 className="mt-3 text-3xl font-black text-slate-900 dark:text-slate-100">
                {requester?.name ?? 'Club'} vs {target?.name ?? 'Club'}
              </h1>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Status: <span className="font-semibold text-slate-900 dark:text-slate-100">{showdown.status ?? 'PENDING'}</span>
              </p>
              {createdLabel && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Requested {createdLabel}</p>
              )}
            </div>
            <Link
              href="/showdown"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
            >
              Back to showdown
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <p className="font-semibold text-slate-800 dark:text-slate-100">Showdown details</p>
          <p className="mt-2">Match format, scoring, and results will appear here.</p>
        </div>
      </div>
    </div>
  )
}
