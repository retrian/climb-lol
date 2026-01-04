-- Create rank_cutoffs table to store GM/Challenger LP thresholds
create table if not exists public.rank_cutoffs (
  id bigserial primary key,
  queue_type text not null, -- RANKED_SOLO_5x5, RANKED_FLEX_SR
  tier text not null, -- GRANDMASTER, CHALLENGER
  cutoff_lp int not null,
  fetched_at timestamptz not null default now(),
  unique(queue_type, tier)
);

create index if not exists idx_rank_cutoffs_queue_tier
  on public.rank_cutoffs (queue_type, tier);
