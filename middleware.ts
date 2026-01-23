import type { NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

export async function middleware(req: NextRequest) {
  return updateSession(req)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
