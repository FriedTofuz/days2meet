/**
 * Participant sessions and password hashing. Server-only.
 *
 * There is no session table. The cookie value is `<participantId>.<hmac>`, where
 * the HMAC is SHA-256 over the participant id keyed by SESSION_SECRET. The id is
 * readable by the holder, which is fine — it is already public in the event
 * payload — but it cannot be forged for a participant you are not.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

if (typeof window !== 'undefined') {
  throw new Error('lib/session.ts is server-only and must not be imported from client code.');
}

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length !== SALT_LENGTH || expected.length === 0) return false;

  const derived = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(derived, expected);
}

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or shorter than 32 characters. See .env.example for how to generate one.',
    );
  }
  return value;
}

function sign(participantId: string): string {
  return createHmac('sha256', secret()).update(participantId).digest('hex');
}

/**
 * A keyed digest, for when a column has to recognise something without storing
 * it — an IP address, say. Keyed rather than a plain hash because the whole
 * IPv4 space fits in an afternoon of hashing, which makes an unkeyed digest of
 * an address just a slower way of writing the address down.
 *
 * `label` separates the namespaces, so a digest minted to count one thing can
 * never be mistaken for one minted to count another. It deliberately does not
 * share an implementation with `sign` above: that one's exact bytes are load
 * bearing, because changing them signs every live session out.
 */
export function keyedDigest(label: string, value: string): string {
  return createHmac('sha256', secret()).update(`${label}:${value}`).digest('hex');
}

export function cookieName(slug: string): string {
  return `w2m_${slug}`;
}

/**
 * The creator's cookie, separate from the participant session because it is
 * issued at event creation, before anyone has a name to sign in with.
 */
export function adminCookieName(slug: string): string {
  return `w2m_admin_${slug}`;
}

export function newAdminToken(): string {
  return randomBytes(32).toString('hex');
}

export interface Session {
  id: string;
  /**
   * Whether the holder proved who they are with a private factor — the row's
   * password, or the address it was created with — as opposed to typing a name
   * that is public in the roster. Only a verified session is shown the stored
   * email; a name-only one may still edit availability, When2meet-style.
   */
  verified: boolean;
}

/**
 * `verified` rides inside the signed value, so the flag cannot be flipped
 * without the secret. Participant ids are UUIDs and carry no dots, so the value
 * splits cleanly on `.` into id, flag, and signature.
 */
export function issueCookieValue(participantId: string, verified: boolean): string {
  const token = `${participantId}.${verified ? 'v' : 'n'}`;
  return `${token}.${sign(token)}`;
}

/** The session if the signature checks out, otherwise null. */
export function readSession(raw: string | undefined | null): Session | null {
  if (!raw) return null;
  const parts = raw.split('.');

  // Current shape: `<id>.<flag>.<hmac>`, the HMAC taken over `<id>.<flag>`.
  if (parts.length === 3) {
    const [id, flag, mac] = parts;
    if (!id || (flag !== 'v' && flag !== 'n')) return null;
    if (!macMatches(`${id}.${flag}`, mac)) return null;
    return { id, verified: flag === 'v' };
  }

  // Legacy shape: `<id>.<hmac>` over the id alone, from before the flag existed.
  // Still trusted for identity, but never treated as verified — the holder can
  // re-sign-in to prove the address again.
  if (parts.length === 2) {
    const [id, mac] = parts;
    if (!id || !macMatches(id, mac)) return null;
    return { id, verified: false };
  }

  return null;
}

/** The participant id if the signature checks out, otherwise null. */
export function readCookieValue(raw: string | undefined | null): string | null {
  return readSession(raw)?.id ?? null;
}

function macMatches(payload: string, mac: string): boolean {
  const presented = Buffer.from(mac, 'utf8');
  const expected = Buffer.from(sign(payload), 'utf8');
  if (presented.length !== expected.length) return false;
  return timingSafeEqual(presented, expected);
}

export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}
