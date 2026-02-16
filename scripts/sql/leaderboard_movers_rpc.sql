-- Compute LP deltas for leaderboard players within a time window.
-- Run this in Supabase SQL editor.

create or replace function public.get_leaderboard_mover_deltas(
  lb_id uuid,
  start_at timestamptz
)
returns table (
  puuid text,
  lp_delta integer
)
language sql
stable
as $$
with ranked as (
  select
    h.puuid,
    h.fetched_at,
    h.tier,
    h.rank,
    coalesce(h.lp, 0) as lp,
    row_number() over (partition by h.puuid order by h.fetched_at asc) as rn_first,
    row_number() over (partition by h.puuid order by h.fetched_at desc) as rn_last
  from player_lp_history h
  join leaderboard_players lp on lp.puuid = h.puuid
  where lp.leaderboard_id = lb_id
    and h.queue_type = 'RANKED_SOLO_5x5'
    and h.fetched_at >= start_at
),
first_last as (
  select
    f.puuid,
    f.tier as first_tier,
    f.rank as first_rank,
    f.lp as first_lp,
    l.tier as last_tier,
    l.rank as last_rank,
    l.lp as last_lp
  from ranked f
  join ranked l on l.puuid = f.puuid
  where f.rn_first = 1 and l.rn_last = 1
),
scored as (
  select
    puuid,
    (
      case upper(coalesce(last_tier, ''))
        when 'IRON' then 0
        when 'BRONZE' then 400
        when 'SILVER' then 800
        when 'GOLD' then 1200
        when 'PLATINUM' then 1600
        when 'EMERALD' then 2000
        when 'DIAMOND' then 2400
        when 'MASTER' then 2800
        when 'GRANDMASTER' then 2800
        when 'CHALLENGER' then 2800
        else null
      end
      + case
          when upper(coalesce(last_tier, '')) in ('MASTER', 'GRANDMASTER', 'CHALLENGER') then 0
          else case upper(coalesce(last_rank, ''))
            -- Match app ladder math in [ladderLpValue()](src/app/lb/[slug]/page.tsx:282)
            when 'IV' then 0
            when 'III' then 100
            when 'II' then 200
            when 'I' then 300
            else 0
          end
        end
      + greatest(last_lp, 0)
    )
    -
    (
      case upper(coalesce(first_tier, ''))
        when 'IRON' then 0
        when 'BRONZE' then 400
        when 'SILVER' then 800
        when 'GOLD' then 1200
        when 'PLATINUM' then 1600
        when 'EMERALD' then 2000
        when 'DIAMOND' then 2400
        when 'MASTER' then 2800
        when 'GRANDMASTER' then 2800
        when 'CHALLENGER' then 2800
        else null
      end
      + case
          when upper(coalesce(first_tier, '')) in ('MASTER', 'GRANDMASTER', 'CHALLENGER') then 0
          else case upper(coalesce(first_rank, ''))
            when 'IV' then 0
            when 'III' then 100
            when 'II' then 200
            when 'I' then 300
            else 0
          end
        end
      + greatest(first_lp, 0)
    ) as lp_delta
  from first_last
)
select puuid, lp_delta::integer
from scored
where lp_delta is not null;
$$;

create index if not exists player_lp_history_queue_fetched_puuid_idx
  on player_lp_history (queue_type, fetched_at, puuid);

create index if not exists leaderboard_players_leaderboard_puuid_idx
  on leaderboard_players (leaderboard_id, puuid);

