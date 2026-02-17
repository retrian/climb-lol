-- Harden leaderboard movers and reduce page-load DB pressure.
-- Safe to run multiple times.

-- 1) Add supporting indexes for queue/time + puuid activity lookups.
create index if not exists idx_matches_queue_end_ts
  on public.matches (queue_id, game_end_ts desc);

create index if not exists idx_match_participants_puuid_match_id
  on public.match_participants (puuid, match_id);

create index if not exists idx_leaderboard_players_lb_puuid
  on public.leaderboard_players (leaderboard_id, puuid);

-- 2) Add mover RPC v2 with optional activity gating and queue parameterization.
--    This wraps existing get_leaderboard_mover_deltas so current mover math remains source-of-truth.
create or replace function public.get_leaderboard_mover_deltas_v2(
  lb_id uuid,
  start_at timestamptz,
  queue_filter integer default 420,
  require_recent_activity boolean default true
)
returns table (
  puuid text,
  lp_delta integer,
  start_tier text,
  start_rank text,
  start_lp integer,
  end_tier text,
  end_rank text,
  end_lp integer
)
language sql
stable
as $$
  with base as (
    select
      d.puuid,
      d.lp_delta
    from public.get_leaderboard_mover_deltas(lb_id, start_at) d
  ),
  bounds as (
    select (extract(epoch from start_at) * 1000)::bigint as start_at_ms
  )
  select
    b.puuid,
    b.lp_delta,
    null::text as start_tier,
    null::text as start_rank,
    null::integer as start_lp,
    null::text as end_tier,
    null::text as end_rank,
    null::integer as end_lp
  from base b
  cross join bounds x
  where
    require_recent_activity = false
    or exists (
      select 1
      from public.leaderboard_players lp
      join public.match_participants mp
        on mp.puuid = lp.puuid
      join public.matches m
        on m.match_id = mp.match_id
      where lp.leaderboard_id = lb_id
        and lp.puuid = b.puuid
        and m.queue_id = queue_filter
        and m.game_end_ts >= x.start_at_ms
    );
$$;
