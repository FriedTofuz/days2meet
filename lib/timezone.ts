/**
 * Timezone helpers for `date_time` events.
 *
 * The grid is canonically defined in the event's timezone: row 4 on Dec 16 means
 * the same wall-clock hour for everyone. Viewers can relabel the gutter in their
 * own zone, but the buckets never move — re-bucketing would change what a stored
 * slot index means, and slot indices are already in the database.
 */

import { fromZonedTime, getTimezoneOffset } from 'date-fns-tz';
import { rowStartMinute, type EventGeometry } from './slots.ts';

/** Minutes east of UTC — `-300` for America/New_York in winter. */
export function offsetMinutes(timeZone: string, instant: Date): number {
  return getTimezoneOffset(timeZone, instant) / 60_000;
}

/** The UTC instant at which a given row begins on a given date, in the event's zone. */
export function instantForRow(geometry: EventGeometry, dateIndex: number, rowIndex: number): Date {
  const minute = rowStartMinute(geometry, rowIndex);
  const hours = String(Math.floor(minute / 60)).padStart(2, '0');
  const mins = String(minute % 60).padStart(2, '0');
  return fromZonedTime(`${geometry.dates[dateIndex]}T${hours}:${mins}:00`, geometry.timezone!);
}

export function resolveViewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** `3 hours ahead`, `1 hour 30 minutes behind`, or `the same`. */
export function describeOffsetDelta(minutes: number): string {
  if (minutes === 0) return 'the same';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (mins) parts.push(`${mins} minute${mins === 1 ? '' : 's'}`);
  return `${parts.join(' ')} ${minutes > 0 ? 'ahead' : 'behind'}`;
}

/**
 * How far to shift gutter labels to read them in the viewer's zone, measured at
 * the event's first date. Deliberately a single number for the whole grid: the
 * DST chips flag the days where it is off by an hour.
 */
export function viewerShiftMinutes(geometry: EventGeometry, viewerTimeZone: string): number {
  if (geometry.mode !== 'date_time' || !geometry.timezone) return 0;
  const anchor = instantForRow(geometry, 0, 0);
  return offsetMinutes(viewerTimeZone, anchor) - offsetMinutes(geometry.timezone, anchor);
}

/**
 * One flag per date: true when that day's UTC offset in the event's timezone
 * differs from the first day's, i.e. a DST boundary falls inside the event.
 */
export function dstFlags(geometry: EventGeometry): boolean[] {
  if (geometry.mode !== 'date_time' || !geometry.timezone) {
    return geometry.dates.map(() => false);
  }
  const baseline = offsetMinutes(geometry.timezone, instantForRow(geometry, 0, 0));
  return geometry.dates.map(
    (_, dateIndex) =>
      offsetMinutes(geometry.timezone!, instantForRow(geometry, dateIndex, 0)) !== baseline,
  );
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The full IANA list where the runtime exposes it, with a usable fallback. */
export function listTimeZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === 'function') {
    try {
      const zones = supported('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    } catch {
      /* fall through to the short list */
    }
  }
  return [
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC',
  ];
}
