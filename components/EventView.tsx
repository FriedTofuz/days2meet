'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { formatDateSpan, formatMinuteOfDay, formatWeekdayMonthDay } from '@/lib/dates';
import {
  buildCounts,
  buildSlotSets,
  overlapSlots,
  splitByAvailability,
  type ParticipantLite,
} from '@/lib/results';
import { rowStartMinute, slotsPerDay, totalSlots, type EventGeometry } from '@/lib/slots';
import type { EventPayload } from '@/lib/types';
import { describeOffsetDelta, dstFlags, resolveViewerTimeZone, viewerShiftMinutes } from '@/lib/timezone';

import CellTooltip, { type TooltipData } from './CellTooltip';
import CopyLinkButton from './CopyLinkButton';
import DateOnlyGrid from './DateOnlyGrid';
import Legend from './Legend';
import ResultsPanel from './ResultsPanel';
import Roster from './Roster';
import SignInCard from './SignInCard';
import { REPO_URL } from './StarBanner';
import TimeGrid, { type HoverPayload } from './TimeGrid';

/** Refetch cadence while the tab is visible. */
const POLL_MS = 5000;
const SAVE_DEBOUNCE_MS = 400;

interface Props {
  initialEvent: EventPayload;
  initialMeId: string | null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function EventView({ initialEvent, initialMeId }: Props) {
  const [event, setEvent] = useState(initialEvent);
  const [meId, setMeId] = useState<string | null>(initialMeId);
  const [mySlots, setMySlots] = useState<Set<number>>(() => {
    const mine = initialEvent.participants.find((person) => person.id === initialMeId);
    return new Set(mine?.slots ?? []);
  });

  /**
   * On one column there is no room to paint your own grid and read the group's
   * at the same time, so the page is one or the other. What decides it is
   * whether there is anything against your name: a mark of any kind lands you
   * on the results, nothing marked lands you in the editor. Signing in asks the
   * same question again rather than assuming the editor. Desktop ignores this
   * entirely and always shows both.
   */
  const [mobileEditing, setMobileEditing] = useState(() => {
    const mine = initialEvent.participants.find((person) => person.id === initialMeId);
    return initialMeId !== null && (mine?.slots.length ?? 0) === 0;
  });

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filterIds, setFilterIds] = useState<Set<string>>(() => new Set());
  const [highlightKeys, setHighlightKeys] = useState<string[] | null>(null);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [viewerZone, setViewerZone] = useState<string | null>(null);
  const [showViewerTimes, setShowViewerTimes] = useState(false);

  const dirtyRef = useRef(false);
  const versionRef = useRef(0);
  const slotsRef = useRef(mySlots);
  const meIdRef = useRef(meId);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  slotsRef.current = mySlots;
  meIdRef.current = meId;

  const geometry: EventGeometry = useMemo(
    () => ({
      mode: event.mode,
      dates: event.dates,
      timezone: event.timezone,
      slotMinutes: event.slotMinutes,
      startMinute: event.startMinute,
      endMinute: event.endMinute,
    }),
    [event.mode, event.dates, event.timezone, event.slotMinutes, event.startMinute, event.endMinute],
  );

  const me = useMemo(
    () => event.participants.find((person) => person.id === meId) ?? null,
    [event.participants, meId],
  );

  /** My unsaved edits win over the polled copy, so the group panel never lags my own grid. */
  const participants: ParticipantLite[] = useMemo(() => {
    if (!meId) return event.participants;
    const mine = [...mySlots].sort((a, b) => a - b);
    const known = event.participants.some((person) => person.id === meId);
    if (!known) {
      return [...event.participants, { id: meId, name: me?.name ?? 'You', slots: mine }];
    }
    return event.participants.map((person) =>
      person.id === meId ? { ...person, slots: mine } : person,
    );
  }, [event.participants, meId, mySlots, me?.name]);

  const total = participants.length;
  const counts = useMemo(
    () => buildCounts(participants, totalSlots(geometry)),
    [participants, geometry],
  );
  const slotSets = useMemo(() => buildSlotSets(participants), [participants]);
  const filterSet = useMemo(() => overlapSlots(slotSets, filterIds), [slotSets, filterIds]);

  const toggleFilter = useCallback((id: string) => {
    setFilterIds((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const clearFilter = useCallback(() => setFilterIds(new Set()), []);

  useEffect(() => {
    setViewerZone(resolveViewerTimeZone());
  }, []);

  const shiftMinutes = useMemo(
    () => (viewerZone ? viewerShiftMinutes(geometry, viewerZone) : 0),
    [geometry, viewerZone],
  );
  const columnDstFlags = useMemo(() => dstFlags(geometry), [geometry]);

  /* ------------------------------------------------------------- refreshing */

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/events/${event.slug}`, { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as EventPayload;
      setEvent(payload);

      // Only adopt the server's copy of my row when there is nothing local in
      // flight — otherwise a poll landing mid-drag would erase the drag.
      if (!dirtyRef.current && meIdRef.current) {
        const mine = payload.participants.find((person) => person.id === meIdRef.current);
        if (mine) setMySlots(new Set(mine.slots));
      }
    } catch {
      /* a dropped poll is not worth surfacing; the next one is 5s away */
    }
  }, [event.slug]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const interval = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', tick);
    };
  }, [refresh]);

  /* ---------------------------------------------------------------- editing */

  const save = useCallback(
    async (version: number) => {
      const slots = [...slotsRef.current].sort((a, b) => a - b);
      try {
        const response = await fetch(`/api/events/${event.slug}/availability`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slots }),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setSaveError(body?.error ?? 'Could not save your availability.');
          setSaveState('error');
          if (response.status === 401) {
            setMeId(null);
            dirtyRef.current = false;
          }
          return;
        }
        if (versionRef.current === version) {
          dirtyRef.current = false;
          setSaveState('saved');
          setSaveError(null);
        }
        void refresh();
      } catch {
        setSaveError('Could not reach the server. Your changes are not saved yet.');
        setSaveState('error');
      }
    },
    [event.slug, refresh],
  );

  const commit = useCallback(
    (next: Set<number>) => {
      setMySlots(next);
      slotsRef.current = next;
      dirtyRef.current = true;
      setSaveState('saving');
      const version = ++versionRef.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(version), SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  const signIn = useCallback(
    async (name: string, password: string, email: string): Promise<string | null> => {
      try {
        const response = await fetch(`/api/events/${event.slug}/signin`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            password: password || undefined,
            email: email || undefined,
          }),
        });
        const body = (await response.json().catch(() => null)) as
          | { participant?: { id: string; slots: number[] }; passwordIgnored?: boolean; error?: string }
          | null;

        if (!response.ok || !body?.participant) {
          return body?.error ?? 'Could not sign you in. Try again.';
        }
        setMeId(body.participant.id);
        meIdRef.current = body.participant.id;
        const slots = new Set(body.participant.slots);
        setMySlots(slots);
        slotsRef.current = slots;
        dirtyRef.current = false;
        setSaveState('idle');
        // Signing in is usually the act of intending to answer, so the editor
        // opens — but not for someone whose answers are already in. Coming back
        // to an event on a phone that has lost its session means signing in
        // again, and that trip is to read the results, not to redo the grid.
        // The response carries their stored row, so this asks the same question
        // the initial state does.
        setMobileEditing(slots.size === 0);
        setNotice(
          body.passwordIgnored
            ? 'That name was created without a password, so anyone can edit it. Your password was not set.'
            : null,
        );
        void refresh();
        return null;
      } catch {
        return 'Could not reach the server. Check your connection and try again.';
      }
    },
    [event.slug, refresh],
  );

  const signOut = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await fetch(`/api/events/${event.slug}/signout`, { method: 'POST' }).catch(() => null);
    setMeId(null);
    meIdRef.current = null;
    const empty = new Set<number>();
    setMySlots(empty);
    slotsRef.current = empty;
    dirtyRef.current = false;
    setSaveState('idle');
    setNotice(null);
    setMobileEditing(false);
    void refresh();
  }, [event.slug, refresh]);

  /**
   * Remove one response. The server decides whether this is allowed — you may
   * always delete your own, the group leader may delete anyone's. The UI only
   * hides the button it knows would be refused.
   */
  const removeParticipant = useCallback(
    async (participantId: string): Promise<string | null> => {
      try {
        const response = await fetch(`/api/events/${event.slug}/participants/${participantId}`, {
          method: 'DELETE',
        });
        const body = (await response.json().catch(() => null)) as
          | { selfRemoved?: boolean; error?: string }
          | null;
        if (!response.ok) return body?.error ?? 'Could not remove that response.';

        // Drop them from the filter, or the overlap keeps intersecting a ghost.
        setFilterIds((current) => {
          if (!current.has(participantId)) return current;
          const next = new Set(current);
          next.delete(participantId);
          return next;
        });

        if (body?.selfRemoved) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          setMeId(null);
          meIdRef.current = null;
          const empty = new Set<number>();
          setMySlots(empty);
          slotsRef.current = empty;
          // Clear before refreshing, or the poll guard would keep the stale row.
          dirtyRef.current = false;
          setSaveState('idle');
          setSaveError(null);
          setNotice(null);
          setMobileEditing(false);
        }

        await refresh();
        return null;
      } catch {
        return 'Could not reach the server. Try again.';
      }
    },
    [event.slug, refresh],
  );

  /* --------------------------------------------------------------- tooltips */

  const handleHover = useCallback(
    (payload: HoverPayload | null) => {
      if (!payload) {
        setTooltip((current) => (current?.pinned ? current : null));
        return;
      }
      const { available, unavailable } = splitByAvailability(participants, slotSets, payload.slot);
      const perDay = slotsPerDay(geometry);
      const dateIndex = Math.floor(payload.slot / perDay);
      const rowIndex = payload.slot % perDay;
      const date = geometry.dates[dateIndex];

      const heading =
        geometry.mode === 'date_only'
          ? formatWeekdayMonthDay(date)
          : `${formatWeekdayMonthDay(date)}, ${formatMinuteOfDay(rowStartMinute(geometry, rowIndex))}`;

      setTooltip((current) => {
        if (current?.pinned && !payload.pinned) return current;
        return {
          heading,
          count: available.length,
          total,
          available,
          unavailable,
          anchor: { x: payload.x, y: payload.y },
          pinned: payload.pinned,
        };
      });
    },
    [participants, slotSets, geometry, total],
  );

  // A tap outside the grid releases a pinned tooltip.
  useEffect(() => {
    if (!tooltip?.pinned) return;
    const release = (nativeEvent: Event) => {
      const target = nativeEvent.target as HTMLElement | null;
      if (target?.closest('[data-hl]')) return;
      setTooltip(null);
    };
    document.addEventListener('pointerdown', release);
    return () => document.removeEventListener('pointerdown', release);
  }, [tooltip?.pinned]);

  /* ----------------------------------------------------------------- render */

  const saveLabel =
    saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : '';

  const timeLine = (() => {
    if (geometry.mode !== 'date_time' || !event.timezone) return null;
    const shown = showViewerTimes && viewerZone ? `${viewerZone} (your time)` : `${event.timezone} (event time)`;
    const suffix = viewerZone ? ` Your timezone is ${viewerZone}, ${describeOffsetDelta(shiftMinutes)}.` : '';
    return `Times shown in ${shown}.${suffix}`;
  })();

  const gridCommon = {
    geometry,
    filterSet,
    totalParticipants: total,
    counts,
  };

  // Which half of the page survives on one column. Signed out, the personal
  // column holds the sign-in card, so it has to stay reachable either way; once
  // responses are closed it holds a short notice that both halves have room for.
  const editing = mobileEditing && !event.responsesClosed;
  const personalOnMobile = event.responsesClosed || !meId || editing;
  const groupOnMobile = !editing;

  const personalGrid =
    geometry.mode === 'date_time' ? (
      <TimeGrid
        geometry={geometry}
        editable
        selected={mySlots}
        onCommit={commit}
        onPaintStart={() => {
          dirtyRef.current = true;
        }}
        gutterShiftMinutes={showViewerTimes ? shiftMinutes : 0}
        dstFlags={columnDstFlags}
      />
    ) : (
      <DateOnlyGrid
        geometry={geometry}
        editable
        selected={mySlots}
        onCommit={commit}
        onPaintStart={() => {
          dirtyRef.current = true;
        }}
      />
    );

  const groupGrid =
    geometry.mode === 'date_time' ? (
      <TimeGrid
        {...gridCommon}
        editable={false}
        selected={mySlots}
        highlightKeys={highlightKeys}
        onHover={handleHover}
        gutterShiftMinutes={showViewerTimes ? shiftMinutes : 0}
        dstFlags={columnDstFlags}
      />
    ) : (
      <DateOnlyGrid
        {...gridCommon}
        editable={false}
        selected={mySlots}
        highlightKeys={highlightKeys}
        onHover={handleHover}
      />
    );

  return (
    <main className="mx-auto w-full max-w-[1440px] px-2 py-5 sm:px-6 sm:py-8">
      <header className="border-b border-line pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{event.title}</h1>
            <p className="num mt-1.5 text-[0.8125rem] text-muted">{formatDateSpan(event.dates)}</p>
          </div>
          {/*
            No shrink-0 here: with four buttons the row is wider than a phone,
            and a row that cannot shrink to the line never reaches its own
            flex-wrap — it just overflows. The buttons keep theirs, so they wrap
            whole rather than squashing.

            Below `sm:` that wrap still landed a ragged 2x2, so there the row is
            a two-column grid instead: tracks give every button the same width
            whatever its label says, and an odd count leaves the last cell empty
            rather than stretching one button wider than the rest.

            That grid is also the only place `order-*` applies, to lift Copy
            link into the top row and drop Edit days2meet into the bottom one.
            It resets at `sm:`, so source order is still the desktop order and
            the flex row's tab order still matches what you see. On a phone it
            no longer does — a keyboard or screen reader reaches Edit days2meet
            second and Copy link last, which is the price of the swap. All four
            grid cells are numbered rather than just the swapped pair, because
            anything left un-numbered sorts as 0 and would jump the queue — the
            GitHub square at the end needs no number because it is not in the
            grid at all. Copy link needs the wrapper only because it takes no
            className; `sm:contents` dissolves it so Copy link stands in the
            desktop row itself rather than inside a box of its own.
          */}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
            <Link href="/" className="btn order-1 shrink-0 sm:order-none">
              New days2meet
            </Link>
            {event.viewerIsLeader ? (
              <Link
                href={`/e/${event.slug}/edit`}
                className="btn btn-edit order-4 shrink-0 sm:order-none"
              >
                Edit days2meet
              </Link>
            ) : null}
            {meId && !mobileEditing && !event.responsesClosed ? (
              <button
                type="button"
                className="btn btn-edit order-3 shrink-0 sm:order-none lg:hidden"
                onClick={() => setMobileEditing(true)}
              >
                Edit availability
              </button>
            ) : null}
            <div className="order-2 grid sm:contents">
              <CopyLinkButton />
            </div>
            {/*
              Gone entirely below `sm:` rather than ordered last: a square in
              that two-column grid would be stretched to a track's width and
              stop being square, and an icon with no label is the one button
              worth dropping when the row has to fit a phone. `display: none`
              also keeps it out of the numbering above, which still has only
              the four to arrange.

              The icon is 1.5em tall, which is the line box its lettered
              siblings stand on, so `.btn`'s own padding and border put it at
              their exact height: 37px. The width restates that same sum
              because `aspect-square` cannot — a flex item sizes both axes from
              its content, so the ratio has nothing definite to work from and
              the box comes out 23 wide. Spelled in `.btn`'s own units rather
              than as 37px so the two sides still agree if its type changes.
            */}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="days2meet on GitHub"
              className="btn hidden w-[calc(1.5em+0.875rem+2px)] shrink-0 px-0 sm:inline-flex"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-[1.5em] w-[1.5em]"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27s-1.36.09-2 .27c-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.27-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
              </svg>
            </a>
          </div>
        </div>

        {/* The toggle sits in the sentence it changes, on the same baseline. */}
        {timeLine ? (
          <p className="hint mt-2">
            {timeLine}{' '}
            {viewerZone && shiftMinutes !== 0 ? (
              <button
                type="button"
                className="btn-link align-baseline font-medium text-danger hover:text-danger"
                onClick={() => setShowViewerTimes((value) => !value)}
              >
                {showViewerTimes ? 'Label in event time' : 'Label in my time'}
              </button>
            ) : null}
          </p>
        ) : null}
      </header>

      {/*
        Two columns, two rows on desktop: the grids on top, their read-outs
        underneath — ranking under yours, roster under the group's. Source order
        is the one-column order, where the roster comes first because who has
        answered is what you check before you trust the ranking; every cell then
        names its desktop slot so the 2x2 is unchanged. `order:` would have moved
        the roster on one column without moving it in the tab order. The honest
        cost of doing it this way round: on desktop the roster is now reached
        before the ranking that sits to its left.
      */}
      <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:gap-y-7">
        {/* Top left — your availability */}
        <section
          aria-labelledby="mine-heading"
          className={`min-w-0 lg:col-start-1 lg:row-start-1 lg:block ${personalOnMobile ? '' : 'hidden'}`}
        >
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 id="mine-heading" className="section-title">
              Your availability
            </h2>
            {meId ? (
              <span
                className={`hint num ${saveState === 'error' ? 'text-danger' : ''}`}
                aria-live="polite"
              >
                {saveLabel}
              </span>
            ) : null}
          </div>

          {event.responsesClosed ? (
            <div className="panel p-4">
              <p className="text-[0.875rem] font-semibold">Responses are closed.</p>
              <p className="hint mt-1">
                The group leader stopped collecting answers. The results are still on the right.
              </p>
            </div>
          ) : meId && me ? (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-[0.875rem]">
                  Signed in as <span className="font-semibold">{me.name}</span>
                  {event.viewerEmail ? (
                    <span className="break-all text-muted"> ({event.viewerEmail})</span>
                  ) : null}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => commit(new Set())}
                    disabled={mySlots.size === 0}
                  >
                    Clear all
                  </button>
                  <button type="button" className="btn-link" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              </div>

              {notice ? (
                <p className="mb-2 rounded-lg border border-line bg-ramp-1 px-3 py-2 text-[0.8125rem]">
                  {notice}
                </p>
              ) : null}
              {saveError ? (
                <p
                  className="mb-2 rounded-lg border border-[#f0d4dc] bg-[#fdf3f5] px-3 py-2 text-[0.8125rem] text-danger"
                  role="alert"
                >
                  {saveError}
                </p>
              ) : null}

              <div className="panel p-1.5 sm:p-3">{personalGrid}</div>
              <p className="hint mt-1.5">
                {geometry.mode === 'date_time'
                  ? 'Drag to paint a block. Drag over marked cells to clear them. Arrow keys move, space toggles, shift+arrow extends.'
                  : 'Tap a day to mark it. Drag across days to mark several at once.'}
              </p>

              {/* The only way out of the editor on one column. Desktop shows both
                  halves at once and never needs it. */}
              <button
                type="button"
                className="btn btn-primary mt-3 w-full lg:hidden"
                onClick={() => setMobileEditing(false)}
              >
                Finish editing
              </button>
            </>
          ) : (
            <SignInCard
              onSignIn={signIn}
              collectEmail={event.collectEmail}
              emailRequired={event.emailRequired}
              names={event.participants.map((person) => person.name)}
            />
          )}
        </section>

        {/* Top right — group availability */}
        <section
          aria-labelledby="group-heading"
          className={`min-w-0 lg:col-start-2 lg:row-start-1 lg:block ${groupOnMobile ? '' : 'hidden'}`}
        >
          <h2 id="group-heading" className="section-title mb-2">
            Group availability{' '}
            {total > 0 ? (
              <span className="font-normal text-muted">(gold = everyone free)</span>
            ) : null}
          </h2>

          {total === 0 ? (
            <p className="mb-3 rounded-lg border border-line bg-surface px-3 py-2 text-[0.875rem]">
              No one has responded yet. Copy the link to share it.
            </p>
          ) : null}

          <div className="panel p-1.5 sm:p-3">{groupGrid}</div>

          {total > 0 ? (
            <div className="mt-2">
              <Legend total={total} />
            </div>
          ) : null}
        </section>

        {/* Bottom right — who is in it, and the overlap filter */}
        {total > 0 ? (
          <div
            className={`min-w-0 lg:col-start-2 lg:row-start-2 lg:block ${groupOnMobile ? '' : 'hidden'}`}
          >
            <Roster
              participants={participants}
              selectedIds={filterIds}
              onToggle={toggleFilter}
              onClear={clearFilter}
              meId={meId}
              leaderId={event.leaderId}
              mode={geometry.mode}
              slotMinutes={geometry.slotMinutes}
              overlapCount={filterSet?.size ?? null}
              onRemove={removeParticipant}
            />
          </div>
        ) : null}

        {/* Bottom left — what the group grid adds up to */}
        {total > 0 ? (
          <div
            className={`panel min-w-0 p-3 lg:col-start-1 lg:row-start-2 lg:block ${groupOnMobile ? '' : 'hidden'}`}
          >
            <ResultsPanel
              geometry={geometry}
              participants={participants}
              counts={counts}
              onHighlight={setHighlightKeys}
            />
          </div>
        ) : null}
      </div>

      <CellTooltip data={tooltip} />
    </main>
  );
}
