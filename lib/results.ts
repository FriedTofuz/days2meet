/**
 * Pure ranking math for the results panel. No DOM, no Node built-ins — the same
 * functions run on the server in tests and in the browser on every poll.
 */

import { isNextDay } from './dates.ts';
import { decodeSlot, slotsPerDay, totalSlots, type EventGeometry } from './slots.ts';

export interface ParticipantLite {
  id: string;
  name: string;
  slots: number[];
  /** Only ever populated for the group leader; null for every other viewer. */
  email?: string | null;
}

/** How many people are free in each slot, indexed by slot index. */
export function buildCounts(participants: readonly ParticipantLite[], total: number): number[] {
  const counts = new Array<number>(total).fill(0);
  for (const person of participants) {
    for (const slot of person.slots) {
      if (slot >= 0 && slot < total) counts[slot] += 1;
    }
  }
  return counts;
}

export function buildSlotSets(participants: readonly ParticipantLite[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const person of participants) map.set(person.id, new Set(person.slots));
  return map;
}

/**
 * Slots where *every* selected person is free — the roster's multi-select filter.
 *
 * Returns null when nothing is selected, which the grids read as "no filter".
 * Walking the smallest set first keeps this linear in that set rather than in
 * whichever one happened to be picked first. Unknown ids are skipped rather than
 * treated as empty: a roster only grows, so a missing id means a poll has not
 * caught up yet, and collapsing the whole overlap would flicker the heatmap.
 */
export function overlapSlots(
  sets: Map<string, Set<number>>,
  ids: Iterable<string>,
): Set<number> | null {
  const chosen: Set<number>[] = [];
  for (const id of ids) {
    const set = sets.get(id);
    if (set) chosen.push(set);
  }
  if (chosen.length === 0) return null;

  chosen.sort((a, b) => a.size - b.size);
  const [smallest, ...rest] = chosen;
  const out = new Set<number>();
  for (const slot of smallest) {
    if (rest.every((set) => set.has(slot))) out.add(slot);
  }
  return out;
}

function maxOf(values: readonly number[]): number {
  let max = 0;
  for (const value of values) if (value > max) max = value;
  return max;
}

/* ---------------------------------------------------------------- date_time */

export interface TimeWindow {
  key: string;
  dateIndex: number;
  date: string;
  /** Inclusive row bounds. */
  startRow: number;
  endRow: number;
  slotCount: number;
  /** Smallest headcount anywhere inside the window — what the ranking uses. */
  minCount: number;
  slots: number[];
}

/**
 * The best contiguous windows, ranked by minimum headcount across the window and
 * then by duration.
 *
 * For each column and each headcount threshold k, the maximal runs where every
 * row clears k are candidates. Taking runs per threshold rather than per row is
 * what makes a long 4-of-6 window rank alongside a short 6-of-6 one instead of
 * being swallowed by it.
 */
export function topTimeWindows(
  geometry: EventGeometry,
  counts: readonly number[],
  limit = 5,
): TimeWindow[] {
  if (geometry.mode !== 'date_time') return [];
  const perDay = slotsPerDay(geometry);
  const ceiling = maxOf(counts);
  if (ceiling === 0) return [];

  const seen = new Set<string>();
  const windows: TimeWindow[] = [];

  const push = (dateIndex: number, startRow: number, endRow: number) => {
    const key = `${dateIndex}:${startRow}:${endRow}`;
    if (seen.has(key)) return;
    seen.add(key);
    const slots: number[] = [];
    let minCount = Infinity;
    for (let row = startRow; row <= endRow; row++) {
      const slot = dateIndex * perDay + row;
      slots.push(slot);
      if (counts[slot] < minCount) minCount = counts[slot];
    }
    windows.push({
      key,
      dateIndex,
      date: geometry.dates[dateIndex],
      startRow,
      endRow,
      slotCount: endRow - startRow + 1,
      minCount,
      slots,
    });
  };

  for (let dateIndex = 0; dateIndex < geometry.dates.length; dateIndex++) {
    for (let threshold = ceiling; threshold >= 1; threshold--) {
      let runStart = -1;
      for (let row = 0; row <= perDay; row++) {
        const clears = row < perDay && counts[dateIndex * perDay + row] >= threshold;
        if (clears) {
          if (runStart < 0) runStart = row;
        } else if (runStart >= 0) {
          push(dateIndex, runStart, row - 1);
          runStart = -1;
        }
      }
    }
  }

  windows.sort(
    (a, b) =>
      b.minCount - a.minCount ||
      b.slotCount - a.slotCount ||
      a.dateIndex - b.dateIndex ||
      a.startRow - b.startRow,
  );
  return windows.slice(0, limit);
}

/* ---------------------------------------------------------------- date_only */

export interface DayRank {
  dateIndex: number;
  date: string;
  count: number;
}

export function rankDays(geometry: EventGeometry, counts: readonly number[]): DayRank[] {
  const perDay = slotsPerDay(geometry);
  return geometry.dates
    .map((date, dateIndex) => ({ dateIndex, date, count: counts[dateIndex * perDay] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.dateIndex - b.dateIndex);
}

export interface Stretch {
  key: string;
  startIndex: number;
  endIndex: number;
  length: number;
  /** Smallest headcount on any day in the run. */
  minCount: number;
  dates: string[];
}

/**
 * The longest runs of consecutive dates where at least `threshold` people are
 * free every day.
 *
 * One pass over the ordered `dates` array. A gap in the array — Dec 23 followed
 * by Dec 26 — breaks the run, because those are not consecutive days even though
 * they are adjacent entries.
 */
export function longestStretches(
  geometry: EventGeometry,
  counts: readonly number[],
  threshold: number,
  limit = 3,
): Stretch[] {
  if (geometry.mode !== 'date_only' || threshold < 1) return [];
  const dates = geometry.dates;
  const runs: Stretch[] = [];

  const close = (startIndex: number, endIndex: number) => {
    let minCount = Infinity;
    for (let i = startIndex; i <= endIndex; i++) minCount = Math.min(minCount, counts[i] ?? 0);
    runs.push({
      key: `${startIndex}:${endIndex}`,
      startIndex,
      endIndex,
      length: endIndex - startIndex + 1,
      minCount,
      dates: dates.slice(startIndex, endIndex + 1),
    });
  };

  let runStart = -1;
  for (let i = 0; i < dates.length; i++) {
    const clears = (counts[i] ?? 0) >= threshold;
    if (!clears) {
      if (runStart >= 0) close(runStart, i - 1);
      runStart = -1;
      continue;
    }
    if (runStart < 0) {
      runStart = i;
      continue;
    }
    if (!isNextDay(dates[i - 1], dates[i])) {
      close(runStart, i - 1);
      runStart = i;
    }
  }
  if (runStart >= 0) close(runStart, dates.length - 1);

  runs.sort((a, b) => b.length - a.length || b.minCount - a.minCount || a.startIndex - b.startIndex);
  return runs.slice(0, limit);
}

/** People free on *every* one of these slots. Used for stretch hover detail. */
export function alwaysFreeNames(
  participants: readonly ParticipantLite[],
  slots: readonly number[],
): string[] {
  if (slots.length === 0) return [];
  return participants
    .filter((person) => {
      const owned = new Set(person.slots);
      return slots.every((slot) => owned.has(slot));
    })
    .map((person) => person.name);
}

export function splitByAvailability(
  participants: readonly ParticipantLite[],
  sets: Map<string, Set<number>>,
  slot: number,
): { available: string[]; unavailable: string[] } {
  const available: string[] = [];
  const unavailable: string[] = [];
  for (const person of participants) {
    if (sets.get(person.id)?.has(slot)) available.push(person.name);
    else unavailable.push(person.name);
  }
  return { available, unavailable };
}

/* ------------------------------------------------------------- heatmap ramp */

export const RAMP_STEPS = 5;

/**
 * Everyone is free in this slot.
 *
 * This is deliberately not "ramp step 5": with six respondents, five of six also
 * lands on step 5, and a full house has to be distinguishable from a near miss.
 */
export function isFullHouse(count: number, total: number): boolean {
  return total > 0 && count === total;
}

/** Gold fill, dark ink, and a hairline ring for definition against the ramp. */
export const FULL_HOUSE_CLASS = 'bg-full text-ink shadow-[inset_0_0_0_1px_rgba(20,22,26,0.25)]';

/** 0 for nobody, otherwise 1..5 across the teal ramp. */
export function rampStep(count: number, total: number): number {
  if (count <= 0 || total <= 0) return 0;
  return Math.max(1, Math.min(RAMP_STEPS, Math.ceil((count / total) * RAMP_STEPS)));
}

/**
 * Ink stays readable through step 4; step 5 is dark enough to need paper.
 * Both directions clear WCAG AA at the sizes used here.
 */
export function rampTextClass(step: number): string {
  return step >= 5 ? 'text-paper' : 'text-ink';
}

/** Background class per ramp step. Steps, not a gradient, so counts stay legible. */
export function rampFillClass(step: number): string {
  switch (step) {
    case 1:
      return 'bg-ramp-1';
    case 2:
      return 'bg-ramp-2';
    case 3:
      return 'bg-ramp-3';
    case 4:
      return 'bg-ramp-4';
    case 5:
      return 'bg-ramp-5';
    default:
      return 'bg-paper';
  }
}

export function emptyCounts(geometry: EventGeometry): number[] {
  return new Array<number>(totalSlots(geometry)).fill(0);
}

export { decodeSlot };
