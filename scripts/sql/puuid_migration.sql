begin;

update players p
set puuid = m.new_puuid
from puuid_migration_map m
where p.puuid = m.old_puuid;

update club_members c
set player_puuid = m.new_puuid
from puuid_migration_map m
where c.player_puuid = m.old_puuid;

update leaderboard_players l
set puuid = m.new_puuid
from puuid_migration_map m
where l.puuid = m.old_puuid;

update match_participants mp
set puuid = m.new_puuid
from puuid_migration_map m
where mp.puuid = m.old_puuid;

update player_lp_events e
set puuid = m.new_puuid
from puuid_migration_map m
where e.puuid = m.old_puuid;

update player_lp_history h
set puuid = m.new_puuid
from puuid_migration_map m
where h.puuid = m.old_puuid;

update player_rank_history rh
set puuid = m.new_puuid
from puuid_migration_map m
where rh.puuid = m.old_puuid;

update player_rank_snapshot rs
set puuid = m.new_puuid
from puuid_migration_map m
where rs.puuid = m.old_puuid;

update player_riot_state pr
set puuid = m.new_puuid
from puuid_migration_map m
where pr.puuid = m.old_puuid;

update player_top_champions tc
set puuid = m.new_puuid
from puuid_migration_map m
where tc.puuid = m.old_puuid;

update player_top_champions_snapshot tcs
set puuid = m.new_puuid
from puuid_migration_map m
where tcs.puuid = m.old_puuid;

commit;
