import { NextResponse } from 'next/server';

/** `headers` exists for the few statuses that mean nothing without one — 429 and Retry-After. */
export function jsonError(message: string, status = 400, headers?: HeadersInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
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
  const message =
    error instanceof Error && /SUPABASE_|SESSION_SECRET/.test(error.message)
      ? error.message
      : 'Something went wrong on our end. Try again in a moment.';
  return NextResponse.json({ error: message }, { status: 500 });
}
