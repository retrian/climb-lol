export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_*_KEY')
  }

  return { url, key }
}

export function getSupabaseCookieDomain() {
  return process.env.SUPABASE_COOKIE_DOMAIN ?? process.env.NEXT_PUBLIC_SUPABASE_COOKIE_DOMAIN
}

export function getSupabaseCookieNameBase() {
  return process.env.NEXT_PUBLIC_SUPABASE_COOKIE_NAME
}
