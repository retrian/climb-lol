-- Adds a random-looking 7-digit identifier to leaderboards.
-- Safe to run multiple times.

alter table public.leaderboards
add column if not exists leaderboard_code integer;

create sequence if not exists public.leaderboard_code_seq
  minvalue 0
  maxvalue 8999999
  start with 0
  increment by 1
  cycle;

create or replace function public.next_leaderboard_code()
returns integer
language plpgsql
volatile
as $$
declare
  v_code integer;
begin
  -- 7-digit range: 1,000,000..9,999,999
  -- Multiplicative permutation over 9,000,000 values for random-looking, collision-free output until wrap.
  v_code := (((nextval('public.leaderboard_code_seq')::bigint * 7919) % 9000000)::integer + 1000000);
  return v_code;
end;
$$;

alter table public.leaderboards
alter column leaderboard_code set default public.next_leaderboard_code();

update public.leaderboards
set leaderboard_code = public.next_leaderboard_code()
where leaderboard_code is null;

alter table public.leaderboards
alter column leaderboard_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leaderboards_leaderboard_code_7_digit_check'
  ) then
    alter table public.leaderboards
      add constraint leaderboards_leaderboard_code_7_digit_check
      check (leaderboard_code between 1000000 and 9999999);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'leaderboards_leaderboard_code_key'
  ) then
    alter table public.leaderboards
      add constraint leaderboards_leaderboard_code_key unique (leaderboard_code);
  end if;
end
$$;
