import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import type { EventRow } from '@/lib/events';
import {
  claimLeader,
  findEventBySlug,
  findParticipantByEmail,
  findParticipantByName,
  hasValidAdminToken,
  readParticipantEmail,
} from '@/lib/events';
import { jsonError, readJsonBody, serverError } from '@/lib/http';
import {
  looksLikeEmail,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PASSWORD_LENGTH,
  normalizeName,
} from '@/lib/identity';
import {
  adminCookieName,
  cookieName,
  cookieOptions,
  hashPassword,
  issueCookieValue,
  verifyPassword,
} from '@/lib/session';
import { PARTICIPANTS_TABLE, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const body = await readJsonBody(request);
    if (!body) return jsonError('Send a JSON object with a name.');

    // Either half can identify someone, so neither is required on its own; the
    // "you gave us nothing" check waits until both have been read.
    const name = normalizeName(body.name);
    if (name.length > MAX_NAME_LENGTH) {
      return jsonError(`Names are limited to ${MAX_NAME_LENGTH} characters.`);
    }

    const rawPassword = body.password;
    if (rawPassword !== undefined && rawPassword !== null && typeof rawPassword !== 'string') {
      return jsonError('The password has to be text.');
    }
    const password = typeof rawPassword === 'string' && rawPassword.length > 0 ? rawPassword : null;
    if (password && password.length > MAX_PASSWORD_LENGTH) {
      return jsonError(`Passwords are limited to ${MAX_PASSWORD_LENGTH} characters.`);
    }

    // Shape-checked here with the rest of the body, before the name is looked up,
    // so a malformed address never answers the question of who is on this event.
    const rawEmail = body.email;
    if (rawEmail !== undefined && rawEmail !== null && typeof rawEmail !== 'string') {
      return jsonError('The email has to be text.');
    }
    const submitted = typeof rawEmail === 'string' ? rawEmail.trim() : '';
    if (submitted.length > MAX_EMAIL_LENGTH) {
      return jsonError(`Email addresses are limited to ${MAX_EMAIL_LENGTH} characters.`);
    }
    if (submitted && !looksLikeEmail(submitted)) {
      return jsonError('That does not look like an email address.');
    }

    const event = await findEventBySlug(slug);
    if (!event) return jsonError('That event link does not exist. Check the URL and try again.', 404);

    // An event that does not ask for addresses must never accumulate them, so the
    // submitted value is dropped here and cannot reach an insert or an update.
    const email = event.collect_email ? submitted : '';
    if (!name && !email) return jsonError('Enter your name or your email address.');
    if (event.collect_email && event.email_required && !email) {
      return jsonError('Enter your email address.');
    }

    const client = supabaseAdmin();

    // The address wins over the name. Someone who cannot remember whether they
    // answered as "Sam" or "sam h" still lands on their own row instead of
    // starting a second one, and the name they typed this time is ignored rather
    // than renaming them.
    let existing = await findParticipantByEmail(event.id, email);
    const matchedByEmail = existing !== null;

    if (!existing) {
      if (!name) {
        return jsonError('No one has answered with that email yet. Enter your name to start.');
      }
      existing = await findParticipantByName(event.id, name);
    }

    if (!existing) {
      // Closing an event stops it growing. Whoever already answered may still
      // sign in below to look at the results.
      if (event.responses_closed) {
        return jsonError('This days2meet is closed to new responses.', 403);
      }

      const { data, error } = await client
        .from(PARTICIPANTS_TABLE)
        .insert({
          event_id: event.id,
          name,
          password_hash: password ? await hashPassword(password) : null,
          slots: [],
          email: email || null,
        })
        .select('id, name, slots, updated_at')
        .single();

      if (error) {
        if (error.code !== '23505') throw new Error(error.message);
        // Two unique indexes can raise this. The address one means someone else
        // took it between the lookup above and this insert, which no amount of
        // checking first can prevent.
        if (isEmailConflict(error)) {
          return jsonError('That email has already answered. Sign in with it instead.');
        }
        // The name one: fall through and treat it as an existing name.
        existing = await findParticipantByName(event.id, name);
        if (!existing) throw new Error(error.message);
      } else {
        const created = data as { id: string; name: string; slots: number[] | null; updated_at: string };
        return await respondSignedIn(event, {
          id: created.id,
          name: created.name,
          slots: created.slots ?? [],
          updatedAt: created.updated_at,
          email: email || null,
        });
      }
    }

    let passwordIgnored = false;

    if (existing.password_hash) {
      if (!password) {
        return jsonError('That name is password protected. Enter the password to edit it.', 401);
      }
      const matches = await verifyPassword(password, existing.password_hash);
      if (!matches) return jsonError('That password does not match. Try again.', 401);
    } else if (password) {
      // The name was created without a password, so it is open to anyone. Setting
      // a password now would let a stranger lock out whoever answered first, so
      // the password is ignored and the client is told.
      passwordIgnored = true;
    }

    // Only now, past the password check, may this request touch a stored address.
    let storedEmail: string | null = email || null;
    if (matchedByEmail) {
      // This row was found *by* that address, so writing it back could only
      // change the capitalisation they first chose. Read theirs instead.
      storedEmail = await readParticipantEmail(event.id, existing.id);
    } else if (email) {
      // Safe to claim: the lookup above found nobody holding this address on
      // this event, and the unique index catches anyone who took it since.
      const { error } = await client
        .from(PARTICIPANTS_TABLE)
        .update({ email })
        .eq('id', existing.id)
        .eq('event_id', event.id);

      if (error) {
        if (error.code === '23505') {
          return jsonError('That email has already answered. Sign in with it instead.');
        }
        throw new Error(error.message);
      }
    } else if (event.collect_email) {
      // Signing in again without retyping the address must not wipe it.
      storedEmail = await readParticipantEmail(event.id, existing.id);
    }

    return await respondSignedIn(
      event,
      {
        id: existing.id,
        name: existing.name,
        slots: existing.slots,
        updatedAt: existing.updated_at,
        email: storedEmail,
      },
      passwordIgnored,
    );
  } catch (error) {
    return serverError(error);
  }
}

/**
 * Which of the two unique indexes on w2m_participants a 23505 came from. Named
 * in the message and the detail by Postgres; if a future driver stops reporting
 * it, this answers "not the email one" and the name path handles it or throws.
 */
function isEmailConflict(error: { message?: string | null; details?: string | null }): boolean {
  return /w2m_participants_event_email_idx/.test(`${error.message ?? ''} ${error.details ?? ''}`);
}

async function respondSignedIn(
  event: EventRow,
  participant: {
    id: string;
    name: string;
    slots: number[];
    updatedAt: string;
    email: string | null;
  },
  passwordIgnored = false,
) {
  await claimLeadership(event, participant.id);

  const store = await cookies();
  store.set(cookieName(event.slug), issueCookieValue(participant.id), cookieOptions());
  return NextResponse.json({ participant, passwordIgnored });
}

/**
 * The creator becomes leader on their first signin, proven by the admin cookie
 * issued when they made the event. The free check comes first so an ordinary
 * signin never pays for a scrypt verify.
 */
async function claimLeadership(event: EventRow, participantId: string) {
  if (event.leader_participant_id !== null) return;

  const store = await cookies();
  if (!(await hasValidAdminToken(event.id, store.get(adminCookieName(event.slug))?.value))) return;

  await claimLeader(event.id, participantId);
}
