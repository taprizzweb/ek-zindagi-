import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '@/lib/env';

/**
 * Next.js remembers identical GET requests made while one page is being rendered and answers the second
 * from the first. For data that can change between two reads (create, then read back) that is wrong: a
 * request that carries its own abort signal is never remembered, so every call gets its own.
 */
const freshFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: 'no-store',
    signal: init?.signal ?? new AbortController().signal,
  });

/** Service-role client. Bypasses RLS: use only after the caller has been authorised. */
export function createAdminClient() {
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: freshFetch },
  });
}
