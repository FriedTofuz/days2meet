'use client';

import { useState } from 'react';

interface Props {
  onSignIn: (name: string, password: string, email: string) => Promise<string | null>;
  /** The organiser asked for email addresses when they made this event. */
  collectEmail: boolean;
  emailRequired: boolean;
  /** Names already on this event, for anyone who cannot remember theirs. */
  names: string[];
}

export default function SignInCard({ onSignIn, collectEmail, emailRequired, names }: Props) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [showNames, setShowNames] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Either identifier will do. The server resolves an address to whoever
    // already used it, so a forgotten name is not a dead end.
    if (!name.trim() && !email.trim()) {
      setError('Enter your name, or the email you answered with.');
      return;
    }
    if (collectEmail && emailRequired && !email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setBusy(true);
    setError(await onSignIn(name.trim(), password, email.trim()));
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="panel space-y-4 p-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <label className="label mb-0" htmlFor="participant-name">
            Your name
          </label>
          {names.length > 0 ? (
            <button
              type="button"
              className="btn-link shrink-0"
              aria-expanded={showNames}
              onClick={() => setShowNames((value) => !value)}
            >
              {showNames ? 'Hide names' : 'Forgot your name?'}
            </button>
          ) : null}
        </div>
        <input
          id="participant-name"
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          maxLength={60}
        />

        {showNames ? (
          <div className="mt-2 rounded-lg border border-line bg-surface p-1.5">
            <p className="hint mb-1 px-1">Pick the name you answered with.</p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {names.map((known) => (
                <li key={known}>
                  <button
                    type="button"
                    className="flex min-h-9 w-full cursor-pointer items-center rounded px-2 text-left text-[0.875rem] transition-colors hover:bg-ramp-1"
                    onClick={() => {
                      setName(known);
                      setShowNames(false);
                    }}
                  >
                    {known}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {collectEmail ? (
        <div>
          <label className="label" htmlFor="participant-email">
            Email {emailRequired ? null : <span className="font-normal text-muted">(optional)</span>}
          </label>
          <input
            id="participant-email"
            className="field"
            // type=email brings up the @ keyboard on phones and lets the browser
            // offer a saved address.
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required={emailRequired}
          />
          <p className="hint mt-1">
            If you already answered, your email signs you back in on its own.
          </p>
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="participant-password">
          Password <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="participant-password"
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="off"
          maxLength={200}
        />
        <p className="hint mt-1">
          Set a password if you want to be the only one who can edit your answer.
        </p>
      </div>

      {error ? (
        <p
          className="rounded-lg border border-[#f0d4dc] bg-[#fdf3f5] px-3 py-2 text-[0.875rem] text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
