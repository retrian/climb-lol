-- Materialized view to precompute LP history per leaderboard for faster graph loading.
-- Run this in Supabase SQL editor.

create materialized view if not exists leaderboard_lp_history as
select
  lp.leaderboard_id,
  h.puuid,
  h.tier,
  h.rank,
  h.lp,
  h.wins,
  h.losses,
  h.fetched_at
from leaderboard_players lp
join player_lp_history h on h.puuid = lp.puuid
where h.queue_type = 'RANKED_SOLO_5x5';

create index if not exists leaderboard_lp_history_leaderboard_id_idx
  on leaderboard_lp_history (leaderboard_id);

create index if not exists leaderboard_lp_history_fetched_at_idx
  on leaderboard_lp_history (fetched_at);

create unique index if not exists leaderboard_lp_history_unique_idx
  on leaderboard_lp_history (leaderboard_id, puuid, fetched_at);

-- Refresh command (use concurrently for minimal locking):
refresh materialized view concurrently leaderboard_lp_history;
