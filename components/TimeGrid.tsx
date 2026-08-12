'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { formatColumnHeader, formatMinuteOfDay } from '@/lib/dates';
import { FULL_HOUSE_CLASS, isFullHouse, rampFillClass, rampStep } from '@/lib/results';
import {
  GUTTER_WIDTH,
  MIN_COLUMN_WIDTH,
  isHourBoundary,
  rectangleSlots,
  rowHeightFor,
  rowStartMinute,
  slotsPerDay,
  type Cell,
  type EventGeometry,
} from '@/lib/slots';
import HighlightOverlay from './HighlightOverlay';
import { useScrollLock } from './useScrollLock';

export interface HoverPayload {
  slot: number;
  x: number;
  y: number;
  pinned: boolean;
}

interface Props {
  geometry: EventGeometry;
  editable: boolean;
  /** Your own marks. Only meaningful when `editable`. */
  selected: Set<number>;
  onCommit?: (next: Set<number>) => void;
  /** Fires the moment a drag starts, so polling can stop overwriting local edits. */
  onPaintStart?: () => void;
  /** Group headcount per slot. Only meaningful when not `editable`. */
  counts?: readonly number[];
  totalParticipants?: number;
  /** Roster filter: slots outside this set drop back. Null means no filter. */
  filterSet?: Set<number> | null;
  highlightKeys?: string[] | null;
  onHover?: (payload: HoverPayload | null) => void;
  /** Minutes to add to gutter labels so they read in the viewer's timezone. */
  gutterShiftMinutes?: number;
  dstFlags?: boolean[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function gutterLabel(minute: number): string {
  const total = ((minute % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const mins = total % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  return mins === 0 ? `${hour12} ${suffix}` : `${hour12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

export default function TimeGrid({
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
  gutterShiftMinutes = 0,
  dstFlags,
}: Props) {
  const perDay = slotsPerDay(geometry);
  const rowHeight = rowHeightFor(geometry.slotMinutes);
  const contentRef = useRef<HTMLDivElement>(null);

  const [preview, setPreviewState] = useState<{ slots: Set<number>; adding: boolean } | null>(null);
  const previewRef = useRef<{ slots: Set<number>; adding: boolean } | null>(null);
  const dragRef = useRef<{
    active: boolean;
    anchor: Cell;
    adding: boolean;
    touch: boolean;
  } | null>(null);

  const setPreview = (next: { slots: Set<number>; adding: boolean } | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };

  // Mouse drags stay unlocked: wheel-scrolling mid-drag is normal on desktop and
  // freezing it there would be the regression. `preview` is the render-visible
  // half of the drag, so it is what flips the lock on and off.
  useScrollLock(preview !== null && dragRef.current?.touch === true);

  const [focusCell, setFocusCell] = useState<Cell>({ dateIndex: 0, rowIndex: 0 });
  const keyboardAnchor = useRef<Cell | null>(null);
  const hasFocus = useRef(false);

  /** What the grid shows right now, including an in-flight drag. */
  const shown = useMemo(() => {
    if (!preview) return selected;
    const next = new Set(selected);
    for (const slot of preview.slots) {
      if (preview.adding) next.add(slot);
      else next.delete(slot);
    }
    return next;
  }, [selected, preview]);

  const cellAtPoint = (clientX: number, clientY: number): Cell | null => {
    const element = document.elementFromPoint(clientX, clientY);
    const cell = element?.closest('[data-cell]') as HTMLElement | null;
    if (!cell?.dataset.cell) return null;
    const [dateIndex, rowIndex] = cell.dataset.cell.split('-').map(Number);
    return { dateIndex, rowIndex };
  };

  const startDrag = (event: React.PointerEvent<HTMLDivElement>, cell: Cell) => {
    if (!editable) return;
    event.preventDefault();
    onPaintStart?.();
    const slot = cell.dateIndex * perDay + cell.rowIndex;
    const adding = !selected.has(slot);
    dragRef.current = { active: true, anchor: cell, adding, touch: event.pointerType === 'touch' };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture is an optimisation for drags that leave the grid. If the pointer
      // is already gone, painting still works through the window listeners.
    }
    setPreview({ slots: new Set([slot]), adding });
  };

  const extendDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!editable || !drag?.active) return;
    const cell = cellAtPoint(event.clientX, event.clientY);
    if (!cell) return;
    setPreview({
      slots: new Set(rectangleSlots(geometry, drag.anchor, cell)),
      adding: drag.adding,
    });
  };

  // Pointer capture keeps events flowing here, but a cancel or a pointerup over
  // another element still has to commit, so the listener lives on the window.
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

  useEffect(() => {
    if (!hasFocus.current) return;
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${focusCell.dateIndex}-${focusCell.rowIndex}"]`)
      ?.focus();
  }, [focusCell]);

  const toggle = (cell: Cell) => {
    if (!editable) return;
    const slot = cell.dateIndex * perDay + cell.rowIndex;
    const next = new Set(selected);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    onCommit?.(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      keyboardAnchor.current = null;
      toggle(focusCell);
      return;
    }

    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();

    const next: Cell = {
      dateIndex: clamp(focusCell.dateIndex + delta[0], 0, geometry.dates.length - 1),
      rowIndex: clamp(focusCell.rowIndex + delta[1], 0, perDay - 1),
    };

    if (event.shiftKey) {
      if (!keyboardAnchor.current) keyboardAnchor.current = focusCell;
      const merged = new Set(selected);
      for (const slot of rectangleSlots(geometry, keyboardAnchor.current, next)) merged.add(slot);
      onCommit?.(merged);
    } else {
      keyboardAnchor.current = null;
    }
    setFocusCell(next);
  };

  const template = `${GUTTER_WIDTH}px repeat(${geometry.dates.length}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`;

  return (
    <div className="scroll-x">
      <div ref={contentRef} className="relative min-w-max">
        <div
          role="grid"
          aria-label={editable ? 'Your availability' : 'Group availability'}
          aria-readonly={!editable}
          className={`grid ${editable ? 'no-touch-pan' : ''}`}
          style={{ gridTemplateColumns: template }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            hasFocus.current = true;
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) hasFocus.current = false;
          }}
        >
          {/* Column headers */}
          <div role="row" style={{ display: 'contents' }}>
            <div
              role="columnheader"
              className="sticky left-0 z-10 bg-paper"
              style={{ width: GUTTER_WIDTH }}
            >
              <span className="sr-only">Time</span>
            </div>
            {geometry.dates.map((date, dateIndex) => {
              const { weekday, monthDay } = formatColumnHeader(date);
              const dst = dstFlags?.[dateIndex] ?? false;
              return (
                <div key={date} role="columnheader" className="px-0.5 pb-1.5 text-center">
                  <div className="num text-[0.6875rem] leading-tight text-muted">{weekday}</div>
                  <div className="num text-[0.8125rem] font-semibold leading-tight">{monthDay}</div>
                  {dst ? (
                    <span
                      className="chip mt-0.5 px-1 py-0 text-[0.5625rem] text-muted"
                      title="Daylight saving time shifts on this day. The grid keeps the event's hours; only the clock labels move by an hour."
                    >
                      DST
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>

          {/* Slot rows */}
          {Array.from({ length: perDay }, (_, rowIndex) => {
            const onHourLine = isHourBoundary(geometry, rowIndex);
            const minute = rowStartMinute(geometry, rowIndex);
            return (
              <div key={rowIndex} role="row" style={{ display: 'contents' }}>
                <div
                  role="rowheader"
                  className="sticky left-0 z-10 bg-paper pr-1.5 text-right"
                  style={{ width: GUTTER_WIDTH, height: rowHeight }}
                >
                  {onHourLine ? (
                    <span className="num text-[0.6875rem] leading-none text-muted">
                      {gutterLabel(minute + gutterShiftMinutes)}
                    </span>
                  ) : null}
                </div>

                {geometry.dates.map((date, dateIndex) => {
                  const slot = dateIndex * perDay + rowIndex;
                  const isMine = shown.has(slot);
                  const count = counts?.[slot] ?? 0;
                  const step = editable ? 0 : rampStep(count, totalParticipants);
                  const full = !editable && isFullHouse(count, totalParticipants);
                  const dimmed = filterSet !== null && !filterSet.has(slot);
                  const isFocus =
                    editable && focusCell.dateIndex === dateIndex && focusCell.rowIndex === rowIndex;

                  const label = editable
                    ? `${formatColumnHeader(date).weekday} ${formatColumnHeader(date).monthDay}, ${formatMinuteOfDay(minute)}, ${isMine ? 'free' : 'not free'}`
                    : `${formatColumnHeader(date).weekday} ${formatColumnHeader(date).monthDay}, ${formatMinuteOfDay(minute)}, ${count} of ${totalParticipants} available`;

                  return (
                    <div
                      key={slot}
                      role="gridcell"
                      aria-label={label}
                      aria-selected={editable ? isMine : undefined}
                      data-cell={editable ? `${dateIndex}-${rowIndex}` : undefined}
                      data-hl={`s${slot}`}
                      tabIndex={editable ? (isFocus ? 0 : -1) : undefined}
                      onFocus={editable ? () => setFocusCell({ dateIndex, rowIndex }) : undefined}
                      onPointerDown={
                        editable
                          ? (event) => startDrag(event, { dateIndex, rowIndex })
                          : (event) => {
                              if (event.pointerType === 'touch') {
                                const box = event.currentTarget.getBoundingClientRect();
                                onHover?.({
                                  slot,
                                  x: box.left + box.width / 2,
                                  y: box.top,
                                  pinned: true,
                                });
                              }
                            }
                      }
                      onPointerMove={editable ? extendDrag : undefined}
                      onPointerEnter={
                        !editable
                          ? (event) => {
                              if (event.pointerType === 'touch') return;
                              const box = event.currentTarget.getBoundingClientRect();
                              onHover?.({
                                slot,
                                x: box.left + box.width / 2,
                                y: box.top,
                                pinned: false,
                              });
                            }
                          : undefined
                      }
                      onPointerLeave={
                        !editable
                          ? (event) => {
                              if (event.pointerType === 'touch') return;
                              onHover?.(null);
                            }
                          : undefined
                      }
                      className={[
                        'relative border-l border-l-line/70',
                        onHourLine ? 'border-t border-t-line' : 'border-t border-t-[#f1f2f5]',
                        dateIndex === geometry.dates.length - 1 ? 'border-r border-r-line/70' : '',
                        rowIndex === perDay - 1 ? 'border-b border-b-line' : '',
                        editable
                          ? isMine
                            ? 'bg-[#faefc9] shadow-[inset_0_0_0_1px_var(--color-you)]'
                            : 'bg-surface hover:bg-[#fdf8e8]'
                          : full
                            ? FULL_HOUSE_CLASS
                            : rampFillClass(step),
                        editable ? 'cursor-pointer' : '',
                        dimmed ? 'opacity-15' : '',
                      ].join(' ')}
                      style={{ height: rowHeight }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>

        <HighlightOverlay containerRef={contentRef} keys={highlightKeys} shape="outline" />
      </div>
    </div>
  );
}
