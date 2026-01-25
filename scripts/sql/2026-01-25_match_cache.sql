create table if not exists match_cache (
  match_id text primary key,
  match_json jsonb null,
  match_fetched_at timestamptz null,
  timeline_json jsonb null,
  timeline_fetched_at timestamptz null,
  updated_at timestamptz not null default now()
);

create index if not exists match_cache_match_fetched_at_idx on match_cache (match_fetched_at desc);
create index if not exists match_cache_timeline_fetched_at_idx on match_cache (timeline_fetched_at desc);
