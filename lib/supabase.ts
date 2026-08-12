/**
 * Server-only Supabase access.
 *
 * The service role key bypasses row level security, and the w2m_ tables have no
 * policies at all, so this module is the only door into the data. It must never
 * be imported from a file that carries "use client" — the guard below turns that
 * mistake into an immediate, obvious crash instead of a leaked key.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

if (typeof window !== 'undefined') {
  throw new Error('lib/supabase.ts is server-only and must not be imported from client code.');
}

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('SUPABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Copy .env.example to .env.local and fill it in.',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'days2meet' } },
  });
  return cached;
}

export const EVENTS_TABLE = 'w2m_events';
export const PARTICIPANTS_TABLE = 'w2m_participants';
