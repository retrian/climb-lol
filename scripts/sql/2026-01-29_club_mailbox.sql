create table if not exists public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  inviter_user_id uuid references public.profiles(user_id) on delete set null,
  invitee_user_id uuid references public.profiles(user_id) on delete cascade,
  status text not null default 'PENDING',
  created_at timestamp with time zone default now()
);

create table if not exists public.club_showdown_requests (
  id uuid primary key default gen_random_uuid(),
  requester_club_id uuid not null references public.clubs(id) on delete cascade,
  target_club_id uuid not null references public.clubs(id) on delete cascade,
  requester_user_id uuid references public.profiles(user_id) on delete set null,
  status text not null default 'PENDING',
  created_at timestamp with time zone default now()
);

create index if not exists club_invites_invitee_idx on public.club_invites (invitee_user_id, status, created_at desc);
create index if not exists club_showdown_target_idx on public.club_showdown_requests (target_club_id, status, created_at desc);
