-- Add verification fields for player_lp_events

alter table public.player_lp_events
add column if not exists match_verified boolean,
add column if not exists match_verify_error text;
