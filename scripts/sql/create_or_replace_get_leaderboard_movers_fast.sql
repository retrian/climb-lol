create or replace function get_leaderboard_movers_fast(
  lb_id uuid,
  start_at timestamptz
)
returns table (puuid text, lp_delta int) as $$
  select
    p.puuid,
    (snap.league_points - hist.lp)::int as lp_delta
  from leaderboard_players p
  join player_rank_snapshot snap
    on snap.puuid = p.puuid
    and snap.queue_type = 'RANKED_SOLO_5x5'
  join lateral (
    select lp from player_lp_history
    where puuid = p.puuid
      and queue_type = 'RANKED_SOLO_5x5'
      and fetched_at < start_at
    order by fetched_at desc
    limit 1
  ) hist on true
  where p.leaderboard_id = lb_id
$$ language sql stable;

