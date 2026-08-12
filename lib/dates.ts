/**
 * Calendar-date helpers. Dates in this app are labels ("Dec 22"), not instants,
 * so they are formatted from a local-midnight Date and compared as UTC
 * milliseconds. Mixing the two is what causes off-by-one-day bugs.
 */

import { format } from 'date-fns';

export const DAY_MS = 86_400_000;

/** `yyyy-MM-dd` -> a Date at local midnight, safe to hand to date-fns `format`. */
export function toLocalDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** `yyyy-MM-dd` -> UTC milliseconds, safe for arithmetic across DST. */
export function toUTCms(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function toKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function addDaysKey(key: string, days: number): string {
  const next = new Date(toUTCms(key) + days * DAY_MS);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(
    next.getUTCDate(),
  ).padStart(2, '0')}`;
}

/** True when `b` is the calendar day immediately after `a`. */
export function isNextDay(a: string, b: string): boolean {
  return toUTCms(b) - toUTCms(a) === DAY_MS;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUTCms(b) - toUTCms(a)) / DAY_MS);
}

/** Every date key from `start` to `end` inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const step = toUTCms(start) <= toUTCms(end) ? 1 : -1;
  let cursor = start;
  for (let guard = 0; guard < 1000; guard++) {
    out.push(cursor);
    if (cursor === end) break;
    cursor = addDaysKey(cursor, step);
  }
  return step === 1 ? out : out.reverse();
}

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/* Display formatting */

/** `Tue 12/16` */
export function formatColumnHeader(key: string): { weekday: string; monthDay: string } {
  const date = toLocalDate(key);
  return { weekday: format(date, 'EEE'), monthDay: format(date, 'M/d') };
}

/** `Dec 22` */
export function formatMonthDay(key: string): string {
  return format(toLocalDate(key), 'MMM d');
}

/** `Tue, Dec 22` */
export function formatWeekdayMonthDay(key: string): string {
  return format(toLocalDate(key), 'EEE, MMM d');
}

/** `December 2026` */
export function formatMonthTitle(year: number, month: number): string {
  return format(new Date(year, month, 1), 'MMMM yyyy');
}

/** `Dec 21 – Jan 4, 2027` or `Dec 21 – 27, 2026` */
export function formatDateSpan(dates: string[]): string {
  if (dates.length === 0) return '';
  const first = toLocalDate(dates[0]);
  const last = toLocalDate(dates[dates.length - 1]);
  if (dates.length === 1) return format(first, 'MMM d, yyyy');
  const sameYear = first.getFullYear() === last.getFullYear();
  const sameMonth = sameYear && first.getMonth() === last.getMonth();
  if (sameMonth) return `${format(first, 'MMM d')} – ${format(last, 'd, yyyy')}`;
  if (sameYear) return `${format(first, 'MMM d')} – ${format(last, 'MMM d, yyyy')}`;
  return `${format(first, 'MMM d, yyyy')} – ${format(last, 'MMM d, yyyy')}`;
}

/* Time-of-day formatting, from minutes past midnight. */

export function formatMinuteOfDay(minute: number, withMeridiem = true): string {
  const total = ((minute % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const mins = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const body = `${hour12}:${String(mins).padStart(2, '0')}`;
  return withMeridiem ? `${body} ${suffix}` : body;
}

export function meridiemOf(minute: number): 'AM' | 'PM' {
  const total = ((minute % 1440) + 1440) % 1440;
  return Math.floor(total / 60) < 12 ? 'AM' : 'PM';
}

/** `2:00–3:30 PM`, or `11:30 AM–1:00 PM` when the window crosses noon. */
export function formatMinuteRange(startMinute: number, endMinute: number): string {
  const sameHalf = meridiemOf(startMinute) === meridiemOf(endMinute);
  const start = formatMinuteOfDay(startMinute, !sameHalf);
  const end = formatMinuteOfDay(endMinute, true);
  return `${start}–${end}`;
}
