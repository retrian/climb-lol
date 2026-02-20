import Link from 'next/link'
import type { ClubShowdownRow, MemberRow } from '../types'
import { formatDate, profileIconUrl } from '../utils'

type Props = {
  clubId: string
  latestMembers: MemberRow[]
  memberCount: number
  leaderboardCount: number
  riotStateByPuuid: Map<string, number | null>
  profilesByUserId: Map<string, string>
  showdowns: ClubShowdownRow[]
  showdownClubsById: Map<string, string>
}

export default function HomeTab({
  clubId,
  latestMembers,
  memberCount,
  leaderboardCount,
  riotStateByPuuid,
  profilesByUserId,
  showdowns,
  showdownClubsById,
}: Props) {
  return (
    <section className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[280px_minmax(0,820px)_280px] lg:gap-10 items-start justify-center">
      <aside className="order-2 lg:order-1 lg:sticky lg:top-6">
        <div className="mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Latest members joined</h3>
          <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="space-y-3">
          {latestMembers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-200">No members yet</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Add Riot IDs to start the roster.</p>
            </div>
          ) : (
            latestMembers.map((member) => {
              const riotId = member.game_name && member.tag_line ? `${member.game_name}#${member.tag_line}` : null
              const profileIconId = member.player_puuid ? riotStateByPuuid.get(member.player_puuid) ?? null : null
              const iconUrl = profileIconUrl(profileIconId)
              const joinedLabel = formatDate(member.joined_at)
              const profileName = member.user_id ? profilesByUserId.get(member.user_id) : null
              const displayName = riotId ?? profileName ?? (member.user_id ? 'Owner' : 'Member')

              return (
                <div key={member.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  {iconUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={iconUrl}
                      alt=""
                      className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-xl border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{displayName}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Joined {joinedLabel ?? 'Unknown'}</p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      <div className="order-1 lg:order-2 space-y-6 max-w-[820px] mx-auto w-full">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Club home</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            This is the public landing page for the club. Share your identity, link your favorite competitions, and keep your roster in sync.
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Members</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{memberCount}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Riot IDs on the roster</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Leaderboards</p>
              <p className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-100">{leaderboardCount}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Attached competitions</p>
            </div>
          </div>
        </div>
      </div>

      <aside className="order-3 lg:sticky lg:top-6">
        <div className="mb-6">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Showdown log</h3>
          <div className="mt-2 h-px w-full bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-slate-500 dark:text-slate-300">Recent</h3>
            <Link href="/showdown" className="text-xs font-semibold text-blue-600 hover:text-blue-500 dark:text-blue-300 dark:hover:text-blue-200">
              View all
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {showdowns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
                No showdowns yet.
              </div>
            ) : (
              showdowns.map((showdown) => {
                const opponentClubId = showdown.requester_club_id === clubId ? showdown.target_club_id : showdown.requester_club_id
                const opponentName = showdownClubsById.get(opponentClubId) ?? 'Opponent club'
                const createdLabel = formatDate(showdown.created_at)

                return (
                  <div
                    key={showdown.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-800 dark:bg-slate-950"
                  >
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-100">{opponentName}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {showdown.status ?? 'PENDING'} • {createdLabel ?? 'Recently'}
                      </p>
                    </div>
                    <Link
                      href={`/showdown/${showdown.id}`}
                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                    >
                      View
                    </Link>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </aside>
    </section>
  )
}
