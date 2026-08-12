import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import EventView from '@/components/EventView';
import { getEventPayload } from '@/lib/events';
import { cookieName, readCookieValue } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventPayload(slug).catch(() => null);
  return { title: event ? `${event.title} | days2meet` : 'days2meet' };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let meId: string | null = null;
  try {
    const store = await cookies();
    meId = readCookieValue(store.get(cookieName(slug))?.value);
  } catch {
    // A missing or short SESSION_SECRET should not blank the page; sign-in will
    // surface the real error.
    meId = null;
  }

  // Read before the event so the first render already carries the viewer's own
  // address, rather than waiting for the first poll to fill it in.
  const event = await getEventPayload(slug, meId);
  if (!event) notFound();

  const signedIn = meId && event.participants.some((person) => person.id === meId) ? meId : null;

  return <EventView initialEvent={event} initialMeId={signedIn} />;
}
