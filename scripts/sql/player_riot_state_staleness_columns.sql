ALTER TABLE player_riot_state ADD COLUMN IF NOT EXISTS last_account_sync_at timestamptz;
ALTER TABLE player_riot_state ADD COLUMN IF NOT EXISTS last_top_champs_at timestamptz;
