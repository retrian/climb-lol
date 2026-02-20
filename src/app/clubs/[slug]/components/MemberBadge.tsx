type Props = {
  role?: string | null
}

export default function MemberBadge({ role }: Props) {
  if (!role) return null
  const normalized = role.toUpperCase()
  const isOwner = normalized === 'OWNER'
  const isAdmin = normalized === 'ADMIN'
  const styles = isOwner
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
    : isAdmin
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'

  return (
    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${styles}`}>
      {role}
    </span>
  )
}
