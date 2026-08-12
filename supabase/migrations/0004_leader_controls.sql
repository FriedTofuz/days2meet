alter table public.w2m_events
  add column if not exists responses_closed boolean not null default false;

-- Email is now always asked for and optional by default; the organiser may
-- upgrade it to required. The old "don't ask at all" state is gone, so every
-- existing event is brought forward to asking.
update public.w2m_events set collect_email = true where collect_email = false;

-- One address answers once per event. Partial so the many null emails do not
-- collide, and lower() so case cannot be used to answer twice.
create unique index if not exists w2m_participants_event_email_idx
  on public.w2m_participants (event_id, lower(email))
  where email is not null;
