-- One row per event created, so creation can be metered per client address.
--
-- ip_hash is an HMAC of the address keyed by SESSION_SECRET, never the address
-- itself: this table would otherwise be a log of who visited and when, which is
-- a heavier thing to hold than the events are.
create table if not exists public.w2m_event_creations (
  id         bigserial primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);

-- The only query is "how many from this bucket since T", newest first.
create index if not exists w2m_event_creations_bucket_idx
  on public.w2m_event_creations (ip_hash, created_at desc);

-- Swept by the same query that reads it, so this only has to be fast enough to
-- find expired rows across every bucket at once.
create index if not exists w2m_event_creations_expiry_idx
  on public.w2m_event_creations (created_at);

alter table public.w2m_event_creations enable row level security;

-- No policies, matching the rest of the schema. anon and authenticated get
-- nothing; the Next.js server reaches it with the service role key.
