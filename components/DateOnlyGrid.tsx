'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { formatMonthTitle, formatWeekdayMonthDay, toKey, toLocalDate } from '@/lib/dates';
import { FULL_HOUSE_CLASS, isFullHouse, rampFillClass, rampStep, rampTextClass } from '@/lib/results';
import { DAY_CELL_MIN_HEIGHT, type EventGeometry } from '@/lib/slots';
import HighlightOverlay from './HighlightOverlay';
import type { HoverPayload } from './TimeGrid';
import { useScrollLock } from './useScrollLock';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Props {
  geometry: EventGeometry;
  editable: boolean;
  selected: Set<number>;
  onCommit?: (next: Set<number>) => void;
  /** Fires the moment a drag starts, so polling can stop overwriting local edits. */
  onPaintStart?: () => void;
  counts?: readonly number[];
  totalParticipants?: number;
  filterSet?: Set<number> | null;
  highlightKeys?: string[] | null;
  onHover?: (payload: HoverPayload | null) => void;
}

function monthGrid(year: number, month: number): (string | null)[] {
  const lead = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= dayCount; day++) cells.push(toKey(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/**
 * In `date_only` mode a slot index is just the date index, so this calendar and
 * the time grid write the same `int[]`. Dates the event does not cover still get
 * a cell, dimmed and inert, so the weekday columns stay honest.
 */
export default function DateOnlyGrid({
  geometry,
  editable,
  selected,
  onCommit,
  onPaintStart,
  counts,
  totalParticipants = 0,
  filterSet = null,
  highlightKeys = null,
  onHover,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [preview, setPreviewState] = useState<{ slots: Set<number>; adding: boolean } | null>(null);
  const previewRef = useRef<{ slots: Set<number>; adding: boolean } | null>(null);
  const dragRef = useRef<{ active: boolean; adding: boolean; touch: boolean } | null>(null);

  const setPreview = (next: { slots: Set<number>; adding: boolean } | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };

  // See TimeGrid: touch only, and `preview` is the half of the drag a render sees.
  useScrollLock(preview !== null && dragRef.current?.touch === true);

  const indexByDate = useMemo(
    () => new Map(geometry.dates.map((date, index) => [date, index] as const)),
    [geometry.dates],
  );

  const months = useMemo(() => {
    if (geometry.dates.length === 0) return [];
    const first = toLocalDate(geometry.dates[0]);
    const last = toLocalDate(geometry.dates[geometry.dates.length - 1]);
    const out: { year: number; month: number }[] = [];
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    const end = new Date(last.getFullYear(), last.getMonth(), 1);
    while (cursor <= end && out.length < 36) {
      out.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    return out;
  }, [geometry.dates]);

  const shown = useMemo(() => {
    if (!preview) return selected;
    const next = new Set(selected);
    for (const slot of preview.slots) {
      if (preview.adding) next.add(slot);
      else next.delete(slot);
    }
    return next;
  }, [selected, preview]);

  const slotAtPoint = (clientX: number, clientY: number): number | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest('[data-cell]') as HTMLElement | null;
    if (!cell?.dataset.cell) return null;
    return Number(cell.dataset.cell);
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, slot: number) => {
    if (!editable) return;
    event.preventDefault();
    onPaintStart?.();
    const adding = !selected.has(slot);
    dragRef.current = { active: true, adding, touch: event.pointerType === 'touch' };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // See TimeGrid: capture is best-effort, the window listeners are the guarantee.
    }
    setPreview({ slots: new Set([slot]), adding });
  };

  const extendDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!editable || !drag?.active) return;
    const slot = slotAtPoint(event.clientX, event.clientY);
    if (slot === null) return;
    const current = previewRef.current;
    if (current?.slots.has(slot)) return;
    const slots = new Set(current?.slots ?? []);
    slots.add(slot);
    setPreview({ slots, adding: drag.adding });
  };

  useEffect(() => {
    if (!editable) return;
    const finish = () => {
      const drag = dragRef.current;
      if (!drag?.active) return;
      dragRef.current = null;
      const current = previewRef.current;
      previewRef.current = null;
      setPreviewState(null);
      if (!current) return;
      const next = new Set(selected);
      for (const slot of current.slots) {
        if (current.adding) next.add(slot);
        else next.delete(slot);
      }
      onCommit?.(next);
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [editable, selected, onCommit]);

  const toggle = (slot: number) => {
    const next = new Set(selected);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    onCommit?.(next);
  };

  return (
    <div ref={contentRef} className={`relative ${editable ? 'no-touch-pan' : ''}`}>
      <div className="grid gap-4 sm:grid-cols-2">
        {months.map(({ year, month }) => (
          <div key={`${year}-${month}`}>
            <div className="mb-1.5 text-[0.8125rem] font-semibold">
              {formatMonthTitle(year, month)}
            </div>
            <div className="mb-1 grid grid-cols-7 gap-0.5 sm:gap-1">
              {WEEKDAYS.map((day) => (
                <div key={day} className="num text-center text-[0.625rem] uppercase text-muted">
                  <span aria-hidden="true">{day.slice(0, 1)}</span>
                  <span className="sr-only">{day}</span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
              {monthGrid(year, month).map((date, index) => {
                const slot = date === null ? undefined : indexByDate.get(date);

                if (date === null || slot === undefined) {
                  return (
                    <div
                      key={date ?? `pad-${index}`}
                      aria-hidden="true"
                      className="rounded border border-dashed border-line/60 bg-transparent"
                      style={{ minHeight: DAY_CELL_MIN_HEIGHT }}
                    >
                      {date ? (
                        <span className="num block px-1 pt-0.5 text-[0.6875rem] text-line">
                          {Number(date.slice(8, 10))}
                        </span>
                      ) : null}
                    </div>
                  );
                }

                const dayNumber = Number(date.slice(8, 10));
                const isMine = shown.has(slot);
                const count = counts?.[slot] ?? 0;
                const step = editable ? 0 : rampStep(count, totalParticipants);
                const dimmed = filterSet !== null && !filterSet.has(slot);
                const full = !editable && isFullHouse(count, totalParticipants);

                const shared = {
                  'data-hl': `s${slot}`,
                  style: { minHeight: DAY_CELL_MIN_HEIGHT },
                } as const;

                if (!editable) {
                  return (
                    <div
                      key={date}
                      {...shared}
                      aria-label={`${formatWeekdayMonthDay(date)}, ${count} of ${totalParticipants} available`}
                      onPointerEnter={(event) => {
                        if (event.pointerType === 'touch') return;
                        const box = event.currentTarget.getBoundingClientRect();
                        onHover?.({ slot, x: box.left + box.width / 2, y: box.top, pinned: false });
                      }}
                      onPointerLeave={(event) => {
                        if (event.pointerType === 'touch') return;
                        onHover?.(null);
                      }}
                      onPointerDown={(event) => {
                        if (event.pointerType !== 'touch') return;
                        const box = event.currentTarget.getBoundingClientRect();
                        onHover?.({ slot, x: box.left + box.width / 2, y: box.top, pinned: true });
                      }}
                      className={[
                        'flex flex-col justify-between rounded border border-line p-1',
                        full ? FULL_HOUSE_CLASS : `${rampFillClass(step)} ${rampTextClass(step)}`,
                        dimmed ? 'opacity-15' : '',
                      ].join(' ')}
                    >
                      <span className="num text-[0.75rem] font-semibold leading-none">
                        {dayNumber}
                      </span>
                      {totalParticipants > 0 ? (
                        // Full opacity: the ramp step already sets this apart from
                        // the day number above it, and at 10px the extra fade left
                        // the count just under the AA contrast floor on the darker
                        // cells.
                        <span className="num text-right text-[0.625rem] leading-none">
                          {count}/{totalParticipants}
                        </span>
                      ) : null}
                    </div>
                  );
                }

                return (
                  <button
                    key={date}
                    type="button"
                    {...shared}
                    data-cell={slot}
                    aria-pressed={isMine}
                    aria-label={`${formatWeekdayMonthDay(date)}, ${isMine ? 'free' : 'not free'}`}
                    onPointerDown={(event) => startDrag(event, slot)}
                    onPointerMove={extendDrag}
                    onClick={(event) => {
                      // Keyboard activation reports detail 0 and skips the drag path.
                      if (event.detail === 0) toggle(slot);
                    }}
                    className={[
                      'flex cursor-pointer flex-col rounded border p-1 text-left transition-colors',
                      isMine
                        ? 'border-you bg-[#faefc9] shadow-[inset_0_0_0_1px_var(--color-you)]'
                        : 'border-line bg-surface hover:bg-[#fdf8e8]',
                    ].join(' ')}
                  >
                    {/* The fill and ring carry "free"; the aria-label says it for screen readers. */}
                    <span className="num text-[0.8125rem] font-semibold leading-none">
                      {dayNumber}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <HighlightOverlay containerRef={contentRef} keys={highlightKeys} shape="bracket" />
    </div>
  );
}
