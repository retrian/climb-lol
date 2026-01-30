create table if not exists public.club_highlights (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid references public.profiles(user_id) on delete set null,
  url text not null,
  duration_seconds integer,
  created_at timestamp with time zone default now()
);

create index if not exists club_highlights_club_id_idx on public.club_highlights (club_id);
create index if not exists club_highlights_created_at_idx on public.club_highlights (created_at desc);
