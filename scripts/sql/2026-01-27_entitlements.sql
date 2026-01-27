-- Add entitlements for paid leaderboard slots and subscriptions

create table if not exists public.user_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  extra_leaderboard_slots integer not null default 0,
  subscription_slots integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists user_entitlements_user_id_idx on public.user_entitlements (user_id);

-- Optional: trigger to update updated_at on changes
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_entitlements_set_updated_at on public.user_entitlements;
create trigger user_entitlements_set_updated_at
before update on public.user_entitlements
for each row execute procedure public.set_updated_at();
