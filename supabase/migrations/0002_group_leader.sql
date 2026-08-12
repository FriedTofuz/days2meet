alter table public.w2m_events
  add column if not exists admin_token_hash       text,
  add column if not exists leader_participant_id  uuid
    references public.w2m_participants(id) on delete set null;

-- on delete set null: when the leader removes their own response the event goes
-- leaderless rather than handing the role to someone who never asked for it.

-- One-time bridge for events that predate this migration. They have no admin
-- token, so their earliest participant is the only evidence of who created them.
-- Events made from here on establish their leader from the creator's admin
-- cookie instead, so this never needs to run again.
update public.w2m_events e
set leader_participant_id = (
  select p.id
  from public.w2m_participants p
  where p.event_id = e.id
  order by p.created_at, p.id
  limit 1
)
where e.admin_token_hash is null
  and e.leader_participant_id is null;
