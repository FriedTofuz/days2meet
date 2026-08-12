/**
 * Metering on event creation. Server-only.
 *
 * Creation is the one anonymous request that mints rows nobody asked for, so it
 * is the one worth metering. Answering an existing event is not: it needs a link
 * somebody shared, and it updates a row rather than adding one.
 */

import { keyedDigest } from './session.ts';
import { supabaseAdmin } from './supabase.ts';

if (typeof window !== 'undefined') {
  throw new Error('lib/rate-limit.ts is server-only and must not be imported from client code.');
}

export const CREATIONS_TABLE = 'w2m_event_creations';

/**
 * Deliberately generous. A household, a dorm, a school, and anyone behind
 * carrier-grade NAT all share one address, so the cap has to clear a room full
 * of people planning things on the same wifi. Locking that room out is a worse
 * failure than letting a script make twenty polls before it stops.
 */
export const CREATIONS_PER_WINDOW = 20;
export const WINDOW_MS = 60 * 60 * 1000;

/**
 * Sign-in throttling. Only *failed* attempts are counted, so a room of people
 * signing in correctly from one address is never touched; a script guessing the
 * leader's password is. The window is short so a wrong guess or two does not
 * lock a real person out for long. Fifteen scrypts per address per quarter hour
 * is also the ceiling on the CPU an unauthenticated caller can make sign-in burn.
 */
export const SIGNIN_FAILURES_PER_WINDOW = 15;
export const SIGNIN_WINDOW_MS = 15 * 60 * 1000;

export type RateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Vercel sets both of these at the edge, overwriting whatever the client sent.
 * `x-real-ip` is preferred because it is a single value; `x-forwarded-for` is a
 * list whose first entry is the client and whose tail is proxies.
 *
 * Off Vercel neither is guaranteed, and a caller could then choose their own
 * bucket. That is worth knowing but not worth defending here: the fallback is a
 * shared bucket, so forging a header moves you between queues rather than out of
 * one.
 */
function clientAddress(request: Request): string | null {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;

  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || null;
}

/**
 * Counts this address's creations in the window and, if there is room, records
 * this one. Call it once per creation attempt, and only after the request has
 * been validated — a malformed body should not spend someone's allowance.
 *
 * The count and the insert are two statements, so a simultaneous burst from one
 * address can seat a couple of extra rows. That is an acceptable miss: this
 * exists to blunt a script running flat out, and such a script is caught by the
 * next request either way.
 */
export async function recordCreationAttempt(request: Request): Promise<RateVerdict> {
  const address = clientAddress(request);
  const bucket = keyedDigest('event-creation-ip', address ?? 'unknown');
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const db = supabaseAdmin();

  const { data, error } = await db
    .from(CREATIONS_TABLE)
    .select('created_at')
    .eq('ip_hash', bucket)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    // Fail open. The limit blunts abuse; it is not what makes the product
    // correct, and an outage in the meter must not stop people planning things.
    console.error('[rate-limit] read failed, allowing:', error.message);
    return { allowed: true };
  }

  const hits = (data ?? []) as { created_at: string }[];
  if (hits.length >= CREATIONS_PER_WINDOW) {
    // The window is rolling, so room appears when the oldest hit ages out.
    const oldest = Date.parse(hits[0].created_at);
    const retryAfterSeconds = Number.isFinite(oldest)
      ? Math.max(1, Math.ceil((oldest + WINDOW_MS - Date.now()) / 1000))
      : Math.ceil(WINDOW_MS / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  const { error: writeError } = await db.from(CREATIONS_TABLE).insert({ ip_hash: bucket });
  if (writeError) {
    // Losing one tally is not worth failing a creation the caller was entitled
    // to make.
    console.error('[rate-limit] write failed, allowing:', writeError.message);
  }

  // Sweeping here rather than on a schedule keeps the table self-maintaining
  // with no cron to forget about, and it is awaited rather than left floating
  // because this runs in a function that may be frozen the moment it responds —
  // a promise nobody waits for is a promise that sometimes never runs. One
  // indexed delete on an operation this rare is affordable.
  const { error: sweepError } = await db.from(CREATIONS_TABLE).delete().lt('created_at', since);
  if (sweepError) console.error('[rate-limit] sweep failed:', sweepError.message);

  return { allowed: true };
}

/**
 * Whether this address may attempt a sign-in, without recording anything — call
 * it before spending a scrypt so a blocked caller costs nothing. It shares the
 * creations table under a separate digest label, so the two counts never mix.
 */
export async function checkSigninRate(request: Request): Promise<RateVerdict> {
  const bucket = keyedDigest('signin-fail-ip', clientAddress(request) ?? 'unknown');
  const since = new Date(Date.now() - SIGNIN_WINDOW_MS).toISOString();

  const { data, error } = await supabaseAdmin()
    .from(CREATIONS_TABLE)
    .select('created_at')
    .eq('ip_hash', bucket)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    // Fail open, as creation does: a broken meter must not lock people out.
    console.error('[rate-limit] signin read failed, allowing:', error.message);
    return { allowed: true };
  }

  const hits = (data ?? []) as { created_at: string }[];
  if (hits.length >= SIGNIN_FAILURES_PER_WINDOW) {
    const oldest = Date.parse(hits[0].created_at);
    const retryAfterSeconds = Number.isFinite(oldest)
      ? Math.max(1, Math.ceil((oldest + SIGNIN_WINDOW_MS - Date.now()) / 1000))
      : Math.ceil(SIGNIN_WINDOW_MS / 1000);
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true };
}

/**
 * Records one failed sign-in for this address. Call it only after a password
 * actually fails to match — a correct sign-in leaves no trace, so honest use is
 * never throttled. Prunes the same rows the creation sweep does, so the shared
 * table stays bounded even on a deployment that only ever sees sign-ins.
 */
export async function recordSigninFailure(request: Request): Promise<void> {
  const bucket = keyedDigest('signin-fail-ip', clientAddress(request) ?? 'unknown');
  const db = supabaseAdmin();

  const { error } = await db.from(CREATIONS_TABLE).insert({ ip_hash: bucket });
  if (error) console.error('[rate-limit] signin write failed:', error.message);

  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString();
  const { error: sweepError } = await db.from(CREATIONS_TABLE).delete().lt('created_at', cutoff);
  if (sweepError) console.error('[rate-limit] signin sweep failed:', sweepError.message);
}
