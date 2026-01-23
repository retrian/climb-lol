-- DB improvements for performance + vision score tracking

-- 1) Track vision score in match participants
alter table if exists public.match_participants
  add column if not exists vision_score integer;

-- 2) Indexes for common access paths
create index if not exists idx_leaderboard_players_lb_sort
  on public.leaderboard_players (leaderboard_id, sort_order);

create index if not exists idx_player_riot_state_puuid
  on public.player_riot_state (puuid);

create index if not exists idx_player_rank_snapshot_puuid_queue
  on public.player_rank_snapshot (puuid, queue_type);

create index if not exists idx_match_participants_puuid_match
  on public.match_participants (puuid, match_id);

create index if not exists idx_match_participants_match
  on public.match_participants (match_id);

create index if not exists idx_matches_game_end_ts
  on public.matches (game_end_ts);

create index if not exists idx_matches_match_id
  on public.matches (match_id);

create index if not exists idx_player_lp_events_match_puuid
  on public.player_lp_events (match_id, puuid);
