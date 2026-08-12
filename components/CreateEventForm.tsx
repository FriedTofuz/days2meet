'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { formatMinuteOfDay } from '@/lib/dates';
import type { EventMode } from '@/lib/slots';
import { listTimeZones, resolveViewerTimeZone } from '@/lib/timezone';
import {
  leaderPasswordProblem,
  looksLikeEmail,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@/lib/identity';
import CreationCalendar from './CreationCalendar';
import ShareDialog from './ShareDialog';
import StarBanner from './StarBanner';

const GRANULARITIES = [15, 30, 60] as const;

/**
 * One fixed example makes this look like a holiday planner. Cycling a spread of
 * them shows the range without spending a line of copy on it. Kept short so
 * nothing is clipped in the field on a 375px screen.
 */
const TITLE_SUGGESTIONS = [
  'Winter break trip',
  'Weekly design sync',
  'Board game night',
  'Finals study group',
  "Nana's 80th",
  'Sprint retro',
  'Climbing gym meetup',
  'Thanksgiving with family',
  'Thesis check-in',
  'Cousins reunion weekend',
] as const;

const SUGGESTION_MS = 3500;

function timeOptions(from: number, to: number): number[] {
  const out: number[] = [];
  for (let minute = from; minute <= to; minute += 30) out.push(minute);
  return out;
}

const START_OPTIONS = timeOptions(0, 1410);
const END_OPTIONS = timeOptions(30, 1440);

export default function CreateEventForm() {
  const router = useRouter();
  const zones = useMemo(() => listTimeZones(), []);

  const [title, setTitle] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [leaderEmail, setLeaderEmail] = useState('');
  const [leaderPassword, setLeaderPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<EventMode>('date_time');
  const [dates, setDates] = useState<string[]>([]);
  const [startMinute, setStartMinute] = useState(540); // 9:00 AM
  const [endMinute, setEndMinute] = useState(1020); // 5:00 PM
  const [slotMinutes, setSlotMinutes] = useState<number>(15);
  const [timezone, setTimezone] = useState(() => resolveViewerTimeZone());
  const [emailRequired, setEmailRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<{ slug: string; url: string } | null>(null);

  const [suggestion, setSuggestion] = useState(0);
  const [titleTouched, setTitleTouched] = useState(false);

  // Index 0 on both server and client, and it only moves after mount — a random
  // or clock-derived start would render differently in the two places and throw
  // a hydration mismatch. The rotation also stops for good once the field has
  // been touched, because a placeholder changing under someone mid-thought
  // reads as a glitch.
  useEffect(() => {
    if (titleTouched) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timer = window.setInterval(() => {
      setSuggestion((current) => (current + 1) % TITLE_SUGGESTIONS.length);
    }, SUGGESTION_MS);
    return () => window.clearInterval(timer);
  }, [titleTouched]);

  const changeMode = (next: EventMode) => {
    setMode(next);
    setDates([]);
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Give the event a name.');
      return;
    }
    const organiser = leaderName.trim();
    const organiserEmail = leaderEmail.trim();
    if (!organiser) {
      setError('Enter your name so everyone knows who is organising.');
      return;
    }
    if (!organiserEmail) {
      setError('Enter your email address.');
      return;
    }
    if (!looksLikeEmail(organiserEmail)) {
      setError('That does not look like an email address.');
      return;
    }
    // Not trimmed: whatever was typed is the secret, and signin compares it as
    // typed.
    const passwordProblem = leaderPasswordProblem(leaderPassword);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }
    if (dates.length === 0) {
      setError(
        mode === 'date_only'
          ? 'Pick a date range on the calendar.'
          : 'Pick at least one date on the calendar.',
      );
      return;
    }
    if (mode === 'date_time' && endMinute <= startMinute) {
      setError('The end time has to come after the start time.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          leaderName: organiser,
          leaderEmail: organiserEmail,
          leaderPassword,
          mode,
          dates,
          // Every event asks for an address now. The checkbox only decides
          // whether a respondent is allowed to leave the box empty.
          collectEmail: true,
          emailRequired,
          ...(mode === 'date_time' ? { timezone, startMinute, endMinute, slotMinutes } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { slug?: string; error?: string }
        | null;

      if (!response.ok || !payload?.slug) {
        setError(payload?.error ?? 'Could not create the event. Try again.');
        setSubmitting(false);
        return;
      }
      // Left submitting: the event exists from here on, so the form must never
      // run again. The dialog is the only way forward.
      setCreated({ slug: payload.slug, url: `${window.location.origin}/e/${payload.slug}` });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setSubmitting(false);
    }
  };

  return (
    <>
      <form onSubmit={submit} className="space-y-7">
        <div>
          <label className="label" htmlFor="event-title">
            Event name
          </label>
          <input
            id="event-title"
            className="field"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTitleTouched(true);
            }}
            onFocus={() => setTitleTouched(true)}
            placeholder={TITLE_SUGGESTIONS[suggestion]}
            maxLength={120}
            required
          />
        </div>

        {/*
          A plain div rather than a fieldset: the group caption is gone, and a
          fieldset without a legend is invalid. Each label carries its own field.
        */}
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="leader-name">
                Your name
              </label>
              <input
                id="leader-name"
                className="field"
                value={leaderName}
                onChange={(event) => setLeaderName(event.target.value)}
                autoComplete="name"
                maxLength={60}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="leader-email">
                Your email
              </label>
              <input
                id="leader-email"
                className="field"
                // type=email brings up the @ keyboard on phones and lets the
                // browser offer a saved address.
                type="email"
                inputMode="email"
                value={leaderEmail}
                onChange={(event) => setLeaderEmail(event.target.value)}
                autoComplete="email"
                maxLength={254}
                required
              />
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label className="label mb-0" htmlFor="leader-password">
                Your password
              </label>
              {/* Nothing in the app can reset this one, so a typo is permanent.
                  A reveal catches every mistyping; a confirm field only catches
                  the ones you would not repeat, and fights password managers. */}
              <button
                type="button"
                className="btn-link"
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="leader-password"
              className="field"
              type={showPassword ? 'text' : 'password'}
              value={leaderPassword}
              onChange={(event) => setLeaderPassword(event.target.value)}
              // new-password, so a password manager offers to save it. There is
              // no reset: a lost one cannot be recovered from anywhere.
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              required
            />
            <p className="hint mt-1">
              At least {MIN_PASSWORD_LENGTH} characters. You need it to sign back in as the group
              leader on another device.
            </p>
          </div>
        </div>

        <fieldset>
          <legend className="label">Mode</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: 'date_time' as const,
                  title: 'Dates & times',
                  blurb: "Everyone marks the hours they're free.",
                },
                {
                  value: 'date_only' as const,
                  title: 'Dates only',
                  blurb: "Everyone marks the days they're free. Good for far-off planning.",
                },
              ] satisfies { value: EventMode; title: string; blurb: string }[]
            ).map((option) => (
              <label
                key={option.value}
                className={[
                  'block cursor-pointer rounded-lg border p-3 transition-colors',
                  mode === option.value
                    ? 'border-ink bg-surface'
                    : 'border-line bg-surface hover:border-[#c9ccd4]',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="mode"
                  className="sr-only"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => changeMode(option.value)}
                />
                <span className="flex items-center gap-2 text-[0.9375rem] font-semibold">
                  <span
                    aria-hidden="true"
                    className={[
                      'inline-block size-3.5 shrink-0 rounded-full border',
                      mode === option.value ? 'border-[5px] border-ink' : 'border-line',
                    ].join(' ')}
                  />
                  {option.title}
                </span>
                <span className="hint mt-1 block pl-[1.375rem]">{option.blurb}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <span className="label">Dates</span>
          <div className="panel p-3">
            <CreationCalendar key={mode} mode={mode} onChange={setDates} />
          </div>
        </div>

        {mode === 'date_time' ? (
          <>
            <fieldset>
              <legend className="label">Time window</legend>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[8.5rem] flex-1">
                  <label className="hint mb-1 block" htmlFor="start-minute">
                    No earlier than
                  </label>
                  <select
                    id="start-minute"
                    className="field num"
                    value={startMinute}
                    onChange={(event) => setStartMinute(Number(event.target.value))}
                  >
                    {START_OPTIONS.map((minute) => (
                      <option key={minute} value={minute}>
                        {formatMinuteOfDay(minute)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[8.5rem] flex-1">
                  <label className="hint mb-1 block" htmlFor="end-minute">
                    No later than
                  </label>
                  <select
                    id="end-minute"
                    className="field num"
                    value={endMinute}
                    onChange={(event) => setEndMinute(Number(event.target.value))}
                  >
                    {END_OPTIONS.map((minute) => (
                      <option key={minute} value={minute}>
                        {minute === 1440 ? '12:00 AM (midnight)' : formatMinuteOfDay(minute)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-3">
                <span className="hint mb-1 block">Granularity</span>
                <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
                  {GRANULARITIES.map((value) => (
                    <label
                      key={value}
                      className={[
                        'num flex min-h-10 cursor-pointer items-center rounded-md px-3 text-[0.8125rem]',
                        slotMinutes === value ? 'bg-ink text-paper' : 'text-ink hover:bg-ramp-1',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="granularity"
                        className="sr-only"
                        value={value}
                        checked={slotMinutes === value}
                        onChange={() => setSlotMinutes(value)}
                      />
                      {value} min
                    </label>
                  ))}
                </div>
              </div>
            </fieldset>

            <div>
              <label className="label" htmlFor="timezone">
                Timezone
              </label>
              <select
                id="timezone"
                className="field"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {zones.includes(timezone) ? null : <option value={timezone}>{timezone}</option>}
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </select>
              <p className="hint mt-1">The grid is defined in this zone. Respondents can relabel it in theirs.</p>
            </div>
          </>
        ) : null}

        <fieldset>
          <legend className="label">Email addresses</legend>
          <div className="rounded-lg border border-line bg-surface px-3">
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[0.9375rem]">
              <input
                type="checkbox"
                className="size-4 shrink-0 cursor-pointer accent-ink"
                checked={emailRequired}
                onChange={(event) => setEmailRequired(event.target.checked)}
              />
              Require an email address
            </label>
          </div>
          <p className="hint mt-1">
            Respondents always get an email box on the sign-in card. Leave this off and they can skip
            it — your own address above is separate.
          </p>
        </fieldset>

        {error ? (
          <p className="rounded-lg border border-[#f0d4dc] bg-[#fdf3f5] px-3 py-2 text-[0.875rem] text-danger" role="alert">
            {error}
          </p>
        ) : null}

        {/* Phone only — see the note in app/page.tsx. Up here it would be the
            first thing between someone and the form; down here it is the last
            thing they read before committing, built as the button's twin so the
            two read as one stack rather than a banner that happens to be near. */}
        <StarBanner className="w-full sm:hidden" buttonSized />

        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={submitting}>
          {created ? 'Event created' : submitting ? 'Creating…' : 'Create event'}
        </button>
      </form>

      {created ? (
        <ShareDialog
          url={created.url}
          eventTitle={title.trim()}
          onContinue={() => router.push(`/e/${created.slug}`)}
        />
      ) : null}
    </>
  );
}
