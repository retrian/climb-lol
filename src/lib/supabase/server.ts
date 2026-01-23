import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseConfig } from './config'

export async function createClient() {
  const cookieStore = await cookies()
  const { url, key } = getSupabaseConfig()

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
              cookieStore.set(name, value, options)
            })
          } catch {}
        },
      },
    }
  )
}
