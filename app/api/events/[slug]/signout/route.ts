import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { serverError } from '@/lib/http';
import { cookieName, cookieOptions } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const store = await cookies();
    store.set(cookieName(slug), '', { ...cookieOptions(), maxAge: 0 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
