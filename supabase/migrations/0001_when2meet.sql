create extension if not exists pgcrypto;

create table if not exists public.w2m_events (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  mode          text not null check (mode in ('date_time', 'date_only')),
  dates         date[] not null,          -- ordered, explicit list of candidate dates
  timezone      text,                     -- IANA name; null when mode = 'date_only'
  start_minute  int,                      -- minutes past local midnight, inclusive
  end_minute    int,                      -- minutes past local midnight, exclusive
  slot_minutes  int not null default 15,
  created_at    timestamptz not null default now(),
  constraint w2m_events_mode_fields check (
    (mode = 'date_only'
       and timezone is null and start_minute is null and end_minute is null)
    or
    (mode = 'date_time'
       and timezone is not null and start_minute is not null
       and end_minute is not null and end_minute > start_minute)
  )
);

create table if not exists public.w2m_participants (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.w2m_events(id) on delete cascade,
  name           text not null,
  password_hash  text,                    -- null means anyone may edit this name
  slots          int[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists w2m_participants_event_name_idx
  on public.w2m_participants (event_id, lower(name));

create index if not exists w2m_participants_event_idx
  on public.w2m_participants (event_id);

alter table public.w2m_events        enable row level security;
alter table public.w2m_participants  enable row level security;

-- Deliberately no policies. anon and authenticated roles get zero access.
-- All reads and writes go through Next.js server code using the service role
-- key, which bypasses RLS. This keeps password hashes unreachable from the client.
