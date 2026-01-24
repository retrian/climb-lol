-- Clubs schema patch for dashboard-managed clubs and Riot ID members.
-- Run this in the Supabase SQL editor.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'visibility') then
    create type visibility as enum ('PUBLIC', 'UNLISTED', 'PRIVATE');
  end if;
end
$$;

alter table if exists public.clubs
  add column if not exists banner_url text;

alter table if exists public.club_members
  add column if not exists game_name text,
  add column if not exists tag_line text;

-- Allow Riot-ID based members without a linked auth user yet.
alter table if exists public.club_members
  alter column user_id drop not null;

-- Prevent duplicate Riot IDs inside a club.
create unique index if not exists club_members_unique_puuid
  on public.club_members (club_id, player_puuid)
  where player_puuid is not null;

-- RLS: allow owners to manage member rows even when user_id is null.
drop policy if exists "club_members_select_public_or_self" on public.club_members;
drop policy if exists "club_members_insert_self" on public.club_members;
drop policy if exists "club_members_delete_self" on public.club_members;

create policy "club_members_select_public_or_owner"
on public.club_members for select
to anon, authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.clubs c
    where c.id = club_members.club_id
      and (c.visibility = 'PUBLIC'::visibility or c.owner_user_id = auth.uid())
  )
);

create policy "club_members_insert_owner_manage"
on public.club_members for insert
to authenticated
with check (
  exists (
    select 1 from public.clubs c
    where c.id = club_members.club_id
      and c.owner_user_id = auth.uid()
  )
);

create policy "club_members_delete_owner_manage"
on public.club_members for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.clubs c
    where c.id = club_members.club_id
      and c.owner_user_id = auth.uid()
  )
);
