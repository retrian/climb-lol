-- One-off PUUID migration via mapping table.
-- 1) Create mapping table and load old->new PUUIDs.
-- 2) Run updates across all tables.
-- 3) Drop mapping table.

begin;

create table if not exists public.puuid_migration_map (
  old_puuid text primary key,
  new_puuid text not null
);

alter table public.puuid_migration_map disable row level security;
grant insert, update, select, delete on public.puuid_migration_map to service_role;

-- Load mapping rows into public.puuid_migration_map before running updates.
-- Example insert:
-- insert into public.puuid_migration_map (old_puuid, new_puuid) values
-- ('OLD1', 'NEW1'),
-- ('OLD2', 'NEW2');

-- Update core identity tables
update public.players p
set puuid = m.new_puuid
from public.puuid_migration_map m
where p.puuid = m.old_puuid;

update public.leaderboard_players p
set puuid = m.new_puuid
from public.puuid_migration_map m
where p.puuid = m.old_puuid;

update public.club_members c
set player_puuid = m.new_puuid
from public.puuid_migration_map m
where c.player_puuid = m.old_puuid;

-- Update match and history tables
update public.match_participants mp
set puuid = m.new_puuid
from public.puuid_migration_map m
where mp.puuid = m.old_puuid;

update public.player_lp_events e
set puuid = m.new_puuid
from public.puuid_migration_map m
where e.puuid = m.old_puuid;

update public.player_lp_history h
set puuid = m.new_puuid
from public.puuid_migration_map m
where h.puuid = m.old_puuid;

update public.player_rank_history rh
set puuid = m.new_puuid
from public.puuid_migration_map m
where rh.puuid = m.old_puuid;

update public.player_rank_snapshot rs
set puuid = m.new_puuid
from public.puuid_migration_map m
where rs.puuid = m.old_puuid;

update public.player_riot_state s
set puuid = m.new_puuid
from public.puuid_migration_map m
where s.puuid = m.old_puuid;

update public.player_top_champions tc
set puuid = m.new_puuid
from public.puuid_migration_map m
where tc.puuid = m.old_puuid;

update public.player_top_champions_snapshot tcs
set puuid = m.new_puuid
from public.puuid_migration_map m
where tcs.puuid = m.old_puuid;

commit;

-- Optional cleanup once verified:
-- drop table public.puuid_migration_map;
