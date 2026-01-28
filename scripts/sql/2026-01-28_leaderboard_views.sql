create table if not exists public.leaderboard_views (
  slug text primary key,
  views bigint not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function public.increment_leaderboard_view(slug_input text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.leaderboard_views (slug, views)
  values (slug_input, 1)
  on conflict (slug)
  do update set views = public.leaderboard_views.views + 1, updated_at = now();
$$;

grant execute on function public.increment_leaderboard_view(text) to anon, authenticated;
