import { NextResponse } from 'next/server';

/** `headers` exists for the few statuses that mean nothing without one — 429 and Retry-After. */
export function jsonError(message: string, status = 400, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

/**
 * Far above any real request — the largest legitimate body is a full
 * availability array, a few hundred whole numbers — and small enough that a
 * caller cannot make the server parse megabytes of JSON before it is even
 * validated. A body with no declared length falls through to the platform's own
 * ceiling (~4.5 MB on Vercel).
 */
const MAX_JSON_BODY_BYTES = 1_000_000;

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) return null;

  try {
    const parsed = await request.json();
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Turns an unexpected server error into a 500 without leaking internals. */
export function serverError(error: unknown): NextResponse {
  console.error('[days2meet]', error);
  // In development, surface a missing-config message so the operator can see
  // what to set. In production the same detail only tells a prober which
  // environment variables the deploy expects, so it stays generic there.
  const expose =
    process.env.NODE_ENV !== 'production' &&
    error instanceof Error &&
    /SUPABASE_|SESSION_SECRET/.test(error.message);
  const message = expose
    ? (error as Error).message
    : 'Something went wrong on our end. Try again in a moment.';
  return NextResponse.json({ error: message }, { status: 500 });
}
