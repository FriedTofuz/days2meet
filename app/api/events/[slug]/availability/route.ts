import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { findEventBySlug, findParticipantById, geometryFromRow } from '@/lib/events';
import { jsonError, readJsonBody, serverError } from '@/lib/http';
import { cookieName, readCookieValue } from '@/lib/session';
import { totalSlots, validateSlots } from '@/lib/slots';
import { PARTICIPANTS_TABLE, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;

    const body = await readJsonBody(request);
    if (!body) return jsonError('Send a JSON object with a slots array.');

    const event = await findEventBySlug(slug);
    if (!event) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    // Checked before the session so no write can slip through on any path,
    // including the leader's own.
    if (event.responses_closed) {
      return jsonError('This days2meet is closed to new responses.', 403);
    }

    const store = await cookies();
    const participantId = readCookieValue(store.get(cookieName(slug))?.value);
    if (!participantId) return jsonError('You are signed out. Enter your name again to keep editing.', 401);

    const participant = await findParticipantById(event.id, participantId);
    if (!participant) {
      return jsonError('You are signed out. Enter your name again to keep editing.', 401);
    }

    const validation = validateSlots(body.slots, totalSlots(geometryFromRow(event)));
    if (!validation.ok) return jsonError(validation.message);

    const updatedAt = new Date().toISOString();
    const { error } = await supabaseAdmin()
      .from(PARTICIPANTS_TABLE)
      .update({ slots: validation.slots, updated_at: updatedAt })
      .eq('id', participantId)
      .eq('event_id', event.id);

    if (error) throw new Error(error.message);

    return NextResponse.json({
      participant: {
        id: participant.id,
        name: participant.name,
        slots: validation.slots,
        updatedAt,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
