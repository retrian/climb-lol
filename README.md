This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Authentication (Supabase + OAuth)

This app uses Supabase Auth with an OAuth callback handled by [`GET()`](src/app/auth/callback/route.ts:6).

### Enabled providers

- Google (default)
- Riot (feature-flagged)

Riot button visibility is controlled by [`isRiotAuthEnabled()`](src/lib/supabase/config.ts:30) via `NEXT_PUBLIC_ENABLE_RIOT_AUTH`.

### Required OAuth callback URI

Your OAuth providers must redirect back to:

- `https://cwf.lol/auth/callback`

Do **not** use `/dashboard` as the OAuth callback. Post-auth navigation to dashboard is handled after code exchange in [`GET()`](src/app/auth/callback/route.ts:20).

If Riot does not allow localhost callbacks, use a public HTTPS staging domain (for example `https://dev.cwf.lol/auth/callback`).

### Riot provider mapping

Provider mapping is centralized in [`getSupabaseOAuthProvider()`](src/lib/auth/providers.ts:44).

- Default Riot provider key: `riot`
- Optional override env: `NEXT_PUBLIC_RIOT_SUPABASE_PROVIDER`

### Environment variables

Existing:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- `SUPABASE_COOKIE_DOMAIN` (optional)

Riot rollout:

- `NEXT_PUBLIC_ENABLE_RIOT_AUTH=true`
- `NEXT_PUBLIC_RIOT_SUPABASE_PROVIDER=riot` (optional override)

## Riot SSO verification checklist

1. In Supabase Auth providers, Riot is configured and enabled.
2. Riot app redirect URI includes `https://cwf.lol/auth/callback`.
3. Sign-in page shows both provider buttons at [`SignInPage()`](src/app/sign-in/page.tsx:9).
4. Riot sign-in redirects to provider and returns to callback route.
5. Callback successfully exchanges code via [`exchangeCodeForSession()`](src/app/auth/callback/route.ts:62).
6. Session cookies are present and user resolves through [`supabase.auth.getUser()`](src/app/layout.tsx:41).
7. Post-login redirect lands on `/dashboard` (or safe `next` path).
8. Sign-out still works from [`AuthButtons()`](src/app/_components/AuthButtons.tsx:36).
9. Google sign-in still works as fallback.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Background Refresh Job (recommended for fresh first-visit leaderboard cards)

To keep LP Movers and Latest Activity fresh **before** users open the leaderboard page, run the refresh worker on a schedule using [`cron:refresh`](package.json:8), which executes [`main()`](scripts/refresh.ts:1195).

Use **one scheduler only** (for example Render Cron) to avoid duplicate runs.

### Required scheduler environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RIOT_API_KEY`
- `RANKED_SEASON_START` (if your environment uses season boundary logic)

### Cadence guidance

- **Fastest freshness (recommended):** every 1 minute.
- If 1-minute cadence is not available, every 5 minutes is a good fallback.

### Throughput tuning knobs

The refresh script supports rate/volume tuning via env vars (see constants around [`PLAYER_CHECKS_PER_SECOND`](scripts/refresh.ts:498), [`PLAYER_REFRESH_CYCLE_SECONDS`](scripts/refresh.ts:499), and [`REFRESH_RUN_WINDOW_MS`](scripts/refresh.ts:501)).

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
