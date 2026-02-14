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
  const envDomain = process.env.SUPABASE_COOKIE_DOMAIN ?? process.env.NEXT_PUBLIC_SUPABASE_COOKIE_DOMAIN
  
  // Ensure leading dot for subdomain support
  if (envDomain && !envDomain.startsWith('.')) {
    return `.${envDomain}`
  }
  
  return envDomain
}

export function getSupabaseCookieNameBase() {
  // Return undefined to let Supabase use default cookie names
  // Custom names can cause issues with cookie handling
  return undefined
}

export function isRiotAuthEnabled() {
  const raw = process.env.NEXT_PUBLIC_ENABLE_RIOT_AUTH
  if (!raw) return false
  return raw === '1' || raw.toLowerCase() === 'true'
}
