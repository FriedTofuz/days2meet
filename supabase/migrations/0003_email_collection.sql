alter table public.w2m_events
  add column if not exists collect_email  boolean not null default false,
  add column if not exists email_required boolean not null default false;

alter table public.w2m_participants
  add column if not exists email text;

-- email_required only means anything while collect_email is true. The API forces
-- it back to false whenever the organiser is not asking for an address, so the
-- table can never hold "required but never asked for".
