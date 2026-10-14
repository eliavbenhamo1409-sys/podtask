-- Integrity Event Engine (tab monitoring + camera proctoring), 2026-10-16.
--
-- 1. Client event ids: every telemetry row carries a UUID chosen by the
--    browser (or generated here for older clients). Interval events are sent
--    twice under the same id (open, then close) and retried batches are
--    re-sent verbatim, so (interview_id, event_id) is unique and the handler
--    upserts with "ignore duplicates" + a targeted update of ended_at.
-- 2. `client_seq` orders events inside a batch; `confidence` (0..1) is only
--    set for detector-based kinds when it means something.
-- 3. `created_at` is the server-received time (the spec's serverReceivedAt).
-- 4. Retention: `purge_interview_integrity_events(interval)` deletes rows
--    older than the given retention. It is NOT scheduled here; an institution
--    wires it to pg_cron once its policy is decided (see ARCHITECTURE.md §8).

alter table public.interview_integrity_events
  add column if not exists event_id uuid not null default gen_random_uuid(),
  add column if not exists client_seq integer,
  add column if not exists confidence real
    check (confidence is null or (confidence >= 0 and confidence <= 1));

comment on column public.interview_integrity_events.event_id is
  'Client-chosen UUID; the same id is sent again to close an interval. Unique per interview.';
comment on column public.interview_integrity_events.created_at is
  'Server-received time (serverReceivedAt). started_at / ended_at are client clocks.';
comment on column public.interview_integrity_events.source is
  'client = browser telemetry (can be disabled or forged by the student), server = server fact, host = the AI host.';

create unique index if not exists interview_integrity_events_event_uidx
  on public.interview_integrity_events (interview_id, event_id);
create index if not exists interview_integrity_events_kind_idx
  on public.interview_integrity_events (interview_id, kind);

-- Retention policy hook (not scheduled). Service role / SQL only.
create or replace function public.purge_interview_integrity_events(
  p_retention interval default interval '365 days'
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.interview_integrity_events
   where created_at < now() - p_retention;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.purge_interview_integrity_events(interval) from public;
revoke all on function public.purge_interview_integrity_events(interval) from anon;
revoke all on function public.purge_interview_integrity_events(interval) from authenticated;
comment on function public.purge_interview_integrity_events(interval) is
  'Deletes integrity telemetry older than the retention. Wire to pg_cron per institutional policy; never exposed to PostgREST roles.';
