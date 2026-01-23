import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig, getSupabaseCookieDomain } from './config'

export async function createClient() {
  const cookieStore = await cookies()
  const { url, key } = getSupabaseConfig()
  const cookieDomain = getSupabaseCookieDomain()

  // Use non-null assertion since these are required at build time
  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          // Server Components can't write cookies; swallow.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, {
                ...options,
                domain: cookieDomain ?? options?.domain,
              })
            })
          } catch {}
        },
      },
    }
  )
}
