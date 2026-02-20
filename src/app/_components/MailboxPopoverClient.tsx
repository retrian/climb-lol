'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type Invite = {
  id: string
  clubName: string
  inviterName?: string | null
  createdAt?: string | null
}

type ShowdownRequest = {
  id: string
  opponentName: string
  createdAt?: string | null
  requesterClubId?: string
  targetClubId?: string
  status?: string | null
}

type Props = {
  invites?: Invite[]
  inboxShowdowns?: ShowdownRequest[]
  outgoingShowdowns?: ShowdownRequest[]
  onAcceptShowdown?: (formData: FormData) => void
  onCancelShowdown?: (formData: FormData) => void
}

function formatDate(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function MailboxPopoverClient({
  invites = [],
  inboxShowdowns = [],
  outgoingShowdowns = [],
  onAcceptShowdown,
  onCancelShowdown,
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'inbox' | 'outgoing'>('inbox')
  const containerRef = useRef<HTMLDivElement | null>(null)

  const total = invites.length + inboxShowdowns.length
  const hasMail = total > 0

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const sortedInvites = useMemo(() => invites.slice(0, 10), [invites])
  const sortedInboxShowdowns = useMemo(() => inboxShowdowns.slice(0, 10), [inboxShowdowns])
  const sortedOutgoingShowdowns = useMemo(() => outgoingShowdowns.slice(0, 10), [outgoingShowdowns])

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-none text-gray-700 transition hover:bg-slate-100 hover:text-gray-900 dark:text-slate-200 dark:hover:bg-slate-800"
        aria-label="Open mailbox"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 8h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
          <path d="m4 8 8 6 8-6" />
          <path d="M4 8V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v1" />
        </svg>
        {hasMail && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white">
            {total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-3 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
          <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Mailbox</span>
              <div className="flex items-center gap-1 rounded-full bg-slate-100 p-1 text-[11px] font-semibold dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setActiveTab('inbox')}
                  className={`rounded-full px-3 py-1 transition ${
                    activeTab === 'inbox'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Inbox
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('outgoing')}
                  className={`rounded-full px-3 py-1 transition ${
                    activeTab === 'outgoing'
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Outgoing
                </button>
              </div>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto p-4">
            {activeTab === 'inbox' && (
              <>
                {!hasMail && (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    No new invites or requests.
                  </div>
                )}

                {sortedInvites.length > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Club invites</p>
                    <div className="mt-2 space-y-2">
                      {sortedInvites.map((invite) => (
                        <div key={invite.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{invite.clubName}</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatDate(invite.createdAt) ?? 'New'}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Invited by {invite.inviterName ?? 'Club owner'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {sortedInboxShowdowns.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Showdown requests</p>
                    <div className="mt-2 space-y-2">
                      {sortedInboxShowdowns.map((request) => (
                        <div key={request.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{request.opponentName}</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatDate(request.createdAt) ?? 'New'}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {request.status === 'ACCEPTED' ? 'Accepted' : 'Awaiting response'}
                          </p>
                          {onAcceptShowdown && request.targetClubId && (
                            <form action={onAcceptShowdown} className="mt-2">
                              <input type="hidden" name="request_id" value={request.id} />
                              <input type="hidden" name="target_club_id" value={request.targetClubId} />
                              <button
                                type="submit"
                                disabled={request.status === 'ACCEPTED'}
                                className="inline-flex items-center justify-center rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:text-emerald-800 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:border-emerald-400"
                              >
                                Accept
                              </button>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === 'outgoing' && (
              <>
                {sortedOutgoingShowdowns.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                    No outgoing showdown requests yet.
                  </div>
                ) : (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Outgoing showdowns</p>
                    <div className="mt-2 space-y-2">
                      {sortedOutgoingShowdowns.map((request) => (
                        <div key={request.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-800 dark:bg-slate-900">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800 dark:text-slate-100">{request.opponentName}</span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatDate(request.createdAt) ?? 'Sent'}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Pending response</p>
                          {onCancelShowdown && request.requesterClubId && (
                            <form action={onCancelShowdown} className="mt-2">
                              <input type="hidden" name="request_id" value={request.id} />
                              <input type="hidden" name="requester_club_id" value={request.requesterClubId} />
                              <button
                                type="submit"
                                className="inline-flex items-center justify-center rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:border-rose-400"
                              >
                                Cancel
                              </button>
                            </form>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
