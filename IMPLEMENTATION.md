# Climb.lol Leaderboard Improvements

## Summary of Production-Ready Changes

### 1. ✅ Relative Time Formatting
**File**: `src/lib/timeAgo.ts`
- Uses `Intl.RelativeTimeFormat` for better localization
- Proper unit switching: seconds → minutes → hours → days
- No more "4236m ago" - now shows "3d ago"
- Applied to: Latest Games timestamps

### 2. ✅ Champion Data & Icons
**File**: `src/lib/champions.ts`
- Fetches champion data from Data Dragon with caching (24h)
- Maps champion ID → name & icon URL
- Implements fallback handling for unknown champions
- Displays champion icons in:
  - Player top 5 champions row (icons only)
  - Latest games (icon + name)

### 3. ✅ Rank Formatting for Apex Tiers
**File**: `src/lib/rankFormat.ts`
- Correctly handles Master/Grandmaster/Challenger (no divisions)
- Format: "Diamond II • 75 LP" or "Master • 100 LP"
- Clean, readable output

### 4. ✅ Mobile-First Card Design
**File**: `src/app/lb/[slug]/page.tsx`

Updated player card layout:
- Cleaner header with rank badge inline
- Social links hidden on mobile (`hidden sm:flex`)
- Better spacing and typography hierarchy
- Winrate bar with proper visualization
- Top champions as small icon row
- Error banners for failed syncs

### 5. ✅ Latest Games Improvements
- Uses new `timeAgo()` with millisecond timestamps
- Proper queue labels (Solo/Duo, Flex)
- Champion display with icons
- W/L badges with proper coloring
- Cleaner metric display: kills/deaths/assists, CS

## Environment Variables Required

Add to `.env.local`:
```
NEXT_PUBLIC_DDRAGON_VERSION=15.1.1
```

(Defaults to 15.1.1 if not set)

## Database Schema Assumed

Existing tables used:
- `leaderboards` - Leaderboard metadata
- `leaderboard_players` - Players in leaderboard
- `player_riot_state` - Sync status
- `player_rank_snapshot` - Current rank data
- `player_top_champions` - Top 5 champs per player
- `matches` - Match metadata (game_end_ts, game_duration_s, queue_id)
- `match_participants` - Per-player match data

## Key Functions

### `timeAgo(fromMs: number, nowMs?: number): string`
Formats millisecond timestamp to relative time.

### `getChampionMap(ddVersion: string): Promise<ChampMap>`
Fetches and caches champion data from Data Dragon.

### `championIconUrl(ddVersion: string, champKey: string): string`
Generates Data Dragon icon URL for champion.

### `formatRank(tier?: string, division?: string, lp?: number): string`
Formats rank display, handling apex tiers correctly.

## Performance Notes

- Champion data cached for 24 hours in server runtime
- Data Dragon has Next.js ISR (incremental static regeneration) hint
- Champion icons use `loading="lazy"`
- Minimal layout shifts with proper aspect ratios
