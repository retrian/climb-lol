-- Fix mismatched PUUIDs after Riot API key rotation.
-- This deletes affected matches so the refresh job can re-ingest with the new-key PUUIDs.

begin;

-- Replace/add matchIds as needed.
-- match_cache stores both match_json and timeline_json in this schema.
delete from match_cache where match_id in (
  'NA1_5484359748'
);

delete from match_participants where match_id in (
  'NA1_5484359748'
);

delete from player_lp_events where match_id in (
  'NA1_5484359748'
);

delete from matches where match_id in (
  'NA1_5484359748'
);

commit;
