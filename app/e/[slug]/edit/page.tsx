import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import EditEventPanel from '@/components/EditEventPanel';
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
  return { title: event ? `Edit ${event.title} | days2meet` : 'Edit | days2meet' };
}

export default async function EditEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let meId: string | null = null;
  try {
    const store = await cookies();
    meId = readCookieValue(store.get(cookieName(slug))?.value);
  } catch {
    // A missing or short SESSION_SECRET should not blank the page; the viewer
    // simply reads as nobody, which is the safe answer here.
    meId = null;
  }

  const event = await getEventPayload(slug, meId);
  if (!event) notFound();

  // The editor is never sent to anyone else. Gating it in the client would hand
  // every respondent's address to every respondent, since the payload carries
  // them once the viewer is the leader.
  if (!event.viewerIsLeader) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="panel p-4">
          <h1 className="section-title">Only the group leader can edit this days2meet</h1>
          <p className="hint mt-1.5">
            The person who created it can change the dates, the times and whether responses are
            still open.
          </p>
          <Link href={`/e/${slug}`} className="btn btn-edit mt-4 min-h-11">
            Back to the days2meet
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="mb-6 text-2xl font-bold tracking-tight sm:text-[1.75rem]">Edit days2meet</h1>
      <EditEventPanel event={event} />
    </main>
  );
}
