-- SQL function to get latest 10 games across a leaderboard
-- Run this in Supabase SQL Editor

create or replace function public.get_leaderboard_latest_games(
  lb_id uuid,
  lim int default 10
)
returns table (
  match_id text,
  game_end_ts bigint,
  queue_id int,
  game_duration_s int,
  puuid text,
  champion_id int,
  kills int,
  deaths int,
  assists int,
  cs int,
  win boolean
)
language sql
stable
as $$
  select
    m.match_id,
    m.game_end_ts,
    m.queue_id,
    m.game_duration_s,
    mp.puuid,
    mp.champion_id,
    mp.kills,
    mp.deaths,
    mp.assists,
    mp.cs,
    mp.win
  from leaderboard_players lp
  join match_participants mp on mp.puuid = lp.puuid
  join matches m on m.match_id = mp.match_id
  where lp.leaderboard_id = lb_id
  order by m.game_end_ts desc
  limit lim;
$$;
