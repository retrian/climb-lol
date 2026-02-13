# PUUID Migration Runbook (Production Key Swap)

This runbook assumes you are switching to a new Riot **production** API key, which will change player PUUIDs. It uses the existing scripts and DB structure to build a migration map, update all tables, and re-sync derived data.

## 0) Preconditions

- You have the new production `RIOT_API_KEY` ready.
- You can run Node scripts locally (uses `.env.local` / `.env`).
- You have Supabase service role access for the production DB.

**Operational note:**

- It is safest to stop the production backend/cron refresh jobs while you run the migration steps to avoid mixed old/new PUUID writes. You can run the scripts locally against production Supabase while the backend is paused, then restart once verification passes.

**Files referenced:**

- [scripts/fixPuuids.ts](scripts/fixPuuids.ts:1) – builds `puuid_migration_map` using Riot IDs.
- [scripts/refresh.ts](scripts/refresh.ts:1) – refreshes ranks/matches and migrates PUUIDs on the fly when possible.

## 1) Preflight (Key + Baseline)

1. Set env vars locally or in your deployment:

   - `RIOT_API_KEY=<new production key>`
   - `SUPABASE_URL=<prod>`
   - `SUPABASE_SERVICE_ROLE_KEY=<prod>`

2. Baseline counts (run in Supabase SQL editor) for post-migration comparison:

   ```sql
   select 'players' as table, count(*) from players
   union all select 'leaderboard_players', count(*) from leaderboard_players
   union all select 'club_members', count(*) from club_members
   union all select 'match_participants', count(*) from match_participants
   union all select 'matches', count(*) from matches
   union all select 'player_lp_events', count(*) from player_lp_events
   union all select 'player_lp_history', count(*) from player_lp_history
   union all select 'player_rank_snapshot', count(*) from player_rank_snapshot
   union all select 'player_riot_state', count(*) from player_riot_state
   union all select 'player_top_champions', count(*) from player_top_champions;
   ```

3. Optional: sanity check the new key via a quick Riot API call (local script or curl).

## 2) Create the Migration Mapping Table

Create the mapping table (one-time). This table is used by [scripts/fixPuuids.ts](scripts/fixPuuids.ts:1).

```sql
create table if not exists puuid_migration_map (
  old_puuid text primary key,
  new_puuid text not null,
  created_at timestamp with time zone default now()
);
```

## 3) Build the Migration Map

Run the script to map old PUUID → new PUUID using stored Riot IDs:

```
node scripts/fixPuuids.ts
```

Expected output shows the number of Riot IDs found and mapping rows created.

**Coverage checks (SQL):**

```sql
-- Total distinct PUUIDs with Riot IDs available
select count(distinct puuid) from (
  select puuid from players
  union all
  select puuid from leaderboard_players
  union all
  select player_puuid as puuid from club_members
) t;

-- Number of mappings
select count(*) from puuid_migration_map;

-- PUUIDs missing mapping
select count(distinct t.puuid) from (
  select puuid from players
  union all
  select puuid from leaderboard_players
  union all
  select player_puuid as puuid from club_members
) t
left join puuid_migration_map m on m.old_puuid = t.puuid
where m.old_puuid is null;
```

If missing mappings are large, inspect rows missing `game_name`/`tag_line` and consider manual fixes.

## 4) Apply PUUID Migration Across Tables

Use the mapping to update all tables. Run in SQL editor (transaction recommended).

```sql
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
```

## 5) Re-sync / Rebuild Derived Data

Run the refresh script with the new key to repopulate rank snapshots, LP history, matches, and top champions:

```
node scripts/refresh.ts
```

Notes:

- [scripts/refresh.ts](scripts/refresh.ts:1) attempts to migrate PUUIDs on-the-fly if it detects mismatches.
- If you need a fresh rebuild of match/participant data, clear `matches`/`match_participants` and rerun refresh (only if acceptable).

## 6) Verification Queries

1. Confirm new PUUIDs exist and old PUUIDs do not:

```sql
select count(*) from players p
join puuid_migration_map m on p.puuid = m.new_puuid;

select count(*) from players p
join puuid_migration_map m on p.puuid = m.old_puuid;
```

2. Detect match participant mismatches (rows with no corresponding players):

```sql
select count(*) from match_participants mp
left join players p on p.puuid = mp.puuid
where p.puuid is null;
```

3. Validate LP events still match participants:

```sql
select count(*) from player_lp_events e
left join match_participants mp
  on mp.match_id = e.match_id and mp.puuid = e.puuid
where e.match_id is not null and mp.match_id is null;
```

4. Sanity check totals vs baseline (expect same counts or modest increases after refresh).

## 7) Manual Fix Escalation

If a player’s Riot ID is missing or changed, you may need to manually update `game_name`/`tag_line` in `players` before re-running [scripts/fixPuuids.ts](scripts/fixPuuids.ts:1).

## 8) Post-migration Cleanup

- Keep `puuid_migration_map` for auditability.
- Optionally archive/mark any rows with missing Riot IDs for follow-up.

