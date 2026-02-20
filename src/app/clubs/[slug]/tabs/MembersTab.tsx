import MemberBadge from '../components/MemberBadge'
import type { MemberRow } from '../types'
import { formatDate, profileIconUrl } from '../utils'

type Props = {
  slug: string
  canManage: boolean
  members: MemberRow[]
  riotStateByPuuid: Map<string, number | null>
  profilesByUserId: Map<string, string>
  addMemberAction: (formData: FormData) => Promise<void>
  removeMemberAction: (formData: FormData) => Promise<void>
}

export default function MembersTab({
  slug,
  canManage,
  members,
  riotStateByPuuid,
  profilesByUserId,
  addMemberAction,
  removeMemberAction,
}: Props) {
  return (
    <section className="mt-8 space-y-4">
      {canManage && (
        <form action={addMemberAction} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <input type="hidden" name="slug" value={slug} />
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Add a Riot ID</h2>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Owner-managed roster</span>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <input
              name="riot_id"
              placeholder="gameName#tagLine"
              required
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/10 transition-all duration-200 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              Add member
            </button>
          </div>
        </form>
      )}

      {members.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <p className="text-base font-bold text-slate-600 dark:text-slate-200">No members yet</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Add Riot IDs to build the roster.</p>
        </div>
      ) : (
        members.map((member, idx) => {
          const riotId = member.game_name && member.tag_line ? `${member.game_name}#${member.tag_line}` : null
          const profileIconId = member.player_puuid ? riotStateByPuuid.get(member.player_puuid) ?? null : null
          const iconUrl = profileIconUrl(profileIconId)
          const joinedLabel = formatDate(member.joined_at)
          const profileName = member.user_id ? profilesByUserId.get(member.user_id) : null
          const displayName = riotId ?? profileName ?? (member.user_id ? 'Owner' : 'Member')
          const isOwnerMember = member.role?.toUpperCase() === 'OWNER'

          return (
            <div
              key={member.id}
              className="flex flex-col gap-3 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm transition dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex items-center gap-3">
                {iconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={iconUrl} alt="" className="h-10 w-10 rounded-xl border border-slate-200 bg-slate-100 object-cover dark:border-slate-700 dark:bg-slate-800" />
                ) : (
                  <div className="h-10 w-10 rounded-xl border border-dashed border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">#{idx + 1}</span>
                    <h3 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">{displayName}</h3>
                    <MemberBadge role={member.role} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {riotId && <span>Riot ID</span>}
                    {joinedLabel && <span>Joined {joinedLabel}</span>}
                  </div>
                </div>
              </div>

              {canManage && !isOwnerMember && (
                <form action={removeMemberAction}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="member_id" value={member.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:border-rose-300 hover:text-rose-700 dark:border-rose-500/40 dark:text-rose-300 dark:hover:border-rose-400"
                  >
                    Remove
                  </button>
                </form>
              )}
            </div>
          )
        })
      )}
    </section>
  )
}
