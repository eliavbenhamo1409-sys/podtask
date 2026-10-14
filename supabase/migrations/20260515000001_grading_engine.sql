-- Podtask: grading engine v2 (additive, backward compatible).
--
--   1. grading_config   one row of feature flags (queue on/off, worker batch).
--   2. grading_jobs     durable queue: one job per interview, atomic claim with
--                       leases (FOR UPDATE SKIP LOCKED), exponential backoff,
--                       dead-letter after max_attempts.
--   3. grading_runs     immutable snapshot of every grading run (versions,
--                       model, params, input hash, evaluations, computed score,
--                       narrative, usage). A re-grade is a NEW run; the report
--                       points at the current one.
--   4. answer_evaluations / reports: provenance columns (nullable, so the
--                       deployed functions keep working until they are replaced).
--   5. ai_capacity      global concurrency gate shared by every edge function
--                       and worker (never an in-memory counter).
--   6. RPCs             claim / lease / fail / requeue / reconcile / persist.
--   7. trigger          outbox: an interview that becomes `completed` is
--                       queued in the same transaction, so a completed
--                       interview can never fail to be queued.
--   8. grading_status() student + lecturer readable status of the job.
--   9. indexes + the reports owner policy initplan fix.
--
-- Safe to apply before the matching edge-function deploy: the trigger only
-- queues when `grading_config.queue_enabled` is true (default true), jobs
-- simply wait until a worker exists, and `reconcile_grading` only looks at
-- interviews completed after `grading_config.reconcile_since`.

-- ===== helpers ==============================================================
create schema if not exists private;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===== 1. config ============================================================
create table if not exists public.grading_config (
  id integer primary key check (id = 1),
  queue_enabled boolean not null default true,
  -- Interviews completed before this moment are never picked up by the
  -- reconciler (they were graded by the previous engine).
  reconcile_since timestamptz not null default now(),
  worker_batch integer not null default 2 check (worker_batch between 1 and 10),
  lease_seconds integer not null default 180 check (lease_seconds between 30 and 900),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  -- Overrides for the engine (models / params); empty = code defaults.
  engine jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.grading_config (id) values (1) on conflict (id) do nothing;
alter table public.grading_config enable row level security;

-- ===== 2. jobs ==============================================================
create table if not exists public.grading_jobs (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'dead')),
  stage text not null default 'queued',
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_after timestamptz not null default now(),
  leased_by text,
  lease_until timestamptz,
  options jsonb not null default '{}'::jsonb,
  last_error text,
  grading_run_id uuid,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (interview_id)
);
create index if not exists grading_jobs_claim_idx
  on public.grading_jobs (priority, run_after) where status in ('queued', 'failed');
create index if not exists grading_jobs_running_idx
  on public.grading_jobs (lease_until) where status = 'running';
create index if not exists grading_jobs_submission_idx on public.grading_jobs (submission_id);
drop trigger if exists grading_jobs_touch on public.grading_jobs;
create trigger grading_jobs_touch before update on public.grading_jobs
  for each row execute function private.touch_updated_at();
alter table public.grading_jobs enable row level security;

-- ===== 3. runs ==============================================================
create table if not exists public.grading_runs (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  submission_id uuid not null references public.submissions(id) on delete cascade,
  job_id uuid references public.grading_jobs(id) on delete set null,
  run_no integer not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'superseded')),
  rubric_version text not null,
  prompt_version text not null,
  scoring_version text not null,
  provider text not null default 'openai',
  models jsonb not null default '{}'::jsonb,
  params jsonb not null default '{}'::jsonb,
  input_hash text not null,
  reused_from_run_id uuid references public.grading_runs(id) on delete set null,
  evaluations jsonb not null default '[]'::jsonb,
  result jsonb,
  narrative jsonb,
  usage jsonb,
  timings jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (interview_id, run_no)
);
create index if not exists grading_runs_lookup_idx
  on public.grading_runs (interview_id, input_hash, status);
create index if not exists grading_runs_submission_idx on public.grading_runs (submission_id);
create index if not exists grading_runs_job_idx on public.grading_runs (job_id);
alter table public.grading_runs enable row level security;
drop policy if exists "grading_run_lecturer_select" on public.grading_runs;
create policy "grading_run_lecturer_select"
  on public.grading_runs for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

alter table public.grading_jobs
  drop constraint if exists grading_jobs_grading_run_id_fkey;
alter table public.grading_jobs
  add constraint grading_jobs_grading_run_id_fkey
  foreign key (grading_run_id) references public.grading_runs(id) on delete set null;

-- ===== 4. provenance columns ===============================================
alter table public.answer_evaluations
  add column if not exists grading_run_id uuid references public.grading_runs(id) on delete set null,
  add column if not exists question_score numeric(5,1),
  add column if not exists answer_status text,
  add column if not exists evidence_status text,
  add column if not exists confidence text,
  add column if not exists pass_count integer not null default 1,
  add column if not exists verified_evidence jsonb not null default '[]'::jsonb,
  add column if not exists rubric_version text,
  add column if not exists prompt_version text,
  add column if not exists scoring_version text;
create index if not exists answer_evaluations_question_idx
  on public.answer_evaluations (interview_id, question_id);
create index if not exists answer_evaluations_run_idx
  on public.answer_evaluations (grading_run_id);

alter table public.reports
  add column if not exists grading_run_id uuid references public.grading_runs(id) on delete set null;
create index if not exists reports_interview_idx on public.reports (interview_id);
create index if not exists reports_run_idx on public.reports (grading_run_id);

-- ===== 5. capacity gate =====================================================
create table if not exists public.ai_capacity (
  pool text primary key,
  max_concurrent integer not null check (max_concurrent >= 0),
  description text,
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_slot_leases (
  pool text not null references public.ai_capacity(pool) on delete cascade,
  holder text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (pool, holder)
);
create index if not exists ai_slot_leases_expiry_idx on public.ai_slot_leases (pool, expires_at);
alter table public.ai_capacity enable row level security;
alter table public.ai_slot_leases enable row level security;

insert into public.ai_capacity (pool, max_concurrent, description) values
  ('realtime', 12, 'Live voice sessions. OpenAI Build tier (200k TPM for gpt-realtime) fits ~12 interviews; raise only after verifying the org tier.'),
  ('prepare', 8, 'prepare-submission model calls (parse / analyze / plan).'),
  ('evaluate', 10, 'Per-question evaluation calls (grading pass 1).'),
  ('verify', 4, 'Second-pass verification calls.'),
  ('narrative', 6, 'Report narrative calls.')
on conflict (pool) do nothing;

create or replace function public.acquire_ai_slot(
  p_pool text,
  p_holder text,
  p_ttl_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_count integer;
  v_next timestamptz;
  v_ttl interval := make_interval(secs => greatest(1, coalesce(p_ttl_seconds, 180)));
begin
  select max_concurrent into v_max from public.ai_capacity where pool = p_pool for update;
  if not found then
    return jsonb_build_object('ok', true, 'pool', p_pool, 'unlimited', true);
  end if;

  delete from public.ai_slot_leases where pool = p_pool and expires_at < now();

  update public.ai_slot_leases
  set expires_at = now() + v_ttl
  where pool = p_pool and holder = p_holder;
  if found then
    return jsonb_build_object('ok', true, 'pool', p_pool, 'renewed', true);
  end if;

  select count(*) into v_count from public.ai_slot_leases where pool = p_pool;
  if v_count >= v_max then
    select min(expires_at) into v_next from public.ai_slot_leases where pool = p_pool;
    return jsonb_build_object(
      'ok', false,
      'pool', p_pool,
      'in_flight', v_count,
      'max', v_max,
      'retry_after_seconds',
        greatest(1, least(60, ceil(extract(epoch from (coalesce(v_next, now() + interval '5 seconds') - now())))::integer))
    );
  end if;

  insert into public.ai_slot_leases (pool, holder, expires_at)
  values (p_pool, p_holder, now() + v_ttl);
  return jsonb_build_object('ok', true, 'pool', p_pool, 'in_flight', v_count + 1, 'max', v_max);
end;
$$;

create or replace function public.release_ai_slot(p_pool text, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_slot_leases where pool = p_pool and holder = p_holder;
  return found;
end;
$$;

create or replace function public.expire_ai_slots()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  delete from public.ai_slot_leases where expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ===== 6. job + run RPCs ====================================================
create or replace function public.claim_grading_jobs(
  p_worker text,
  p_limit integer default 1,
  p_interview_id uuid default null,
  p_lease_seconds integer default null
)
returns setof public.grading_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease interval;
begin
  select make_interval(secs => coalesce(p_lease_seconds, c.lease_seconds, 180))
  into v_lease
  from public.grading_config c where c.id = 1;
  if v_lease is null then v_lease := make_interval(secs => coalesce(p_lease_seconds, 180)); end if;

  return query
  update public.grading_jobs j
  set status = 'running',
      leased_by = p_worker,
      lease_until = now() + v_lease,
      attempts = j.attempts + 1,
      started_at = coalesce(j.started_at, now()),
      stage = 'claimed',
      updated_at = now()
  where j.id in (
    select c.id
    from public.grading_jobs c
    where (p_interview_id is null or c.interview_id = p_interview_id)
      and c.attempts < c.max_attempts
      and (
        (c.status in ('queued', 'failed') and c.run_after <= now())
        or (c.status = 'running' and c.lease_until < now())
      )
    order by c.priority asc, c.run_after asc
    limit greatest(1, coalesce(p_limit, 1))
    for update skip locked
  )
  returning j.*;
end;
$$;

create or replace function public.extend_grading_lease(p_job_id uuid, p_worker text, p_seconds integer default 180)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.grading_jobs
  set lease_until = now() + make_interval(secs => greatest(30, p_seconds))
  where id = p_job_id and leased_by = p_worker and status = 'running';
  return found;
end;
$$;

create or replace function public.set_grading_stage(p_job_id uuid, p_worker text, p_stage text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.grading_jobs
  set stage = left(coalesce(p_stage, 'running'), 60)
  where id = p_job_id and leased_by = p_worker and status = 'running';
  return found;
end;
$$;

-- Releases a job after a failed attempt. Exponential backoff with jitter
-- (15s, 30s, 60s, ... capped at 10 min) unless the caller passes the
-- provider's Retry-After. `p_dead` gives up immediately (permanent errors).
create or replace function public.fail_grading_job(
  p_job_id uuid,
  p_worker text,
  p_error text,
  p_retry_after_seconds integer default null,
  p_dead boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.grading_jobs;
  v_status text;
  v_delay numeric;
begin
  select * into v_job from public.grading_jobs where id = p_job_id for update;
  if not found or v_job.leased_by is distinct from p_worker or v_job.status <> 'running' then
    return null;
  end if;
  if p_dead or v_job.attempts >= v_job.max_attempts then
    v_status := 'dead';
  else
    v_status := 'failed';
  end if;
  v_delay := coalesce(
    p_retry_after_seconds::numeric,
    least(600, 15 * power(2, greatest(0, v_job.attempts - 1))) * (1 + random() * 0.5)
  );
  update public.grading_jobs
  set status = v_status,
      stage = case when v_status = 'dead' then 'dead' else 'retry_wait' end,
      last_error = left(coalesce(p_error, 'unknown'), 2000),
      leased_by = null,
      lease_until = null,
      run_after = now() + make_interval(secs => v_delay),
      finished_at = case when v_status = 'dead' then now() else null end
  where id = p_job_id;
  return v_status;
end;
$$;

-- Queue (or re-queue) grading for an interview. A running job is left alone.
create or replace function public.requeue_grading(
  p_interview_id uuid,
  p_options jsonb default '{}'::jsonb,
  p_priority integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission uuid;
  v_job public.grading_jobs;
  v_max integer;
begin
  select submission_id into v_submission from public.interviews where id = p_interview_id;
  if not found then
    raise exception 'interview_not_found' using errcode = 'P0002';
  end if;
  select max_attempts into v_max from public.grading_config where id = 1;

  insert into public.grading_jobs (interview_id, submission_id, options, priority, max_attempts)
  values (p_interview_id, v_submission, coalesce(p_options, '{}'::jsonb), coalesce(p_priority, 100), coalesce(v_max, 5))
  on conflict (interview_id) do update
    set status = case when public.grading_jobs.status = 'running' then 'running' else 'queued' end,
        stage = case when public.grading_jobs.status = 'running' then public.grading_jobs.stage else 'queued' end,
        run_after = case when public.grading_jobs.status = 'running' then public.grading_jobs.run_after else now() end,
        attempts = case when public.grading_jobs.status = 'running' then public.grading_jobs.attempts else 0 end,
        options = coalesce(p_options, '{}'::jsonb),
        priority = coalesce(p_priority, public.grading_jobs.priority),
        last_error = case when public.grading_jobs.status = 'running' then public.grading_jobs.last_error else null end,
        finished_at = case when public.grading_jobs.status = 'running' then public.grading_jobs.finished_at else null end
  returning * into v_job;

  return jsonb_build_object('job_id', v_job.id, 'status', v_job.status, 'requeued', v_job.status = 'queued');
end;
$$;

-- Periodic consistency pass (cron): queue completed interviews that have no
-- job, give up on exhausted jobs, re-queue "done" jobs whose report is
-- missing, drop expired capacity leases.
create or replace function public.reconcile_grading(p_min_age_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_enabled boolean;
  v_enqueued integer := 0;
  v_dead integer := 0;
  v_requeued integer := 0;
  v_expired_leases integer := 0;
  v_expired_slots integer := 0;
  v_max integer;
begin
  select reconcile_since, queue_enabled, max_attempts into v_since, v_enabled, v_max
  from public.grading_config where id = 1;
  if not coalesce(v_enabled, true) then
    return jsonb_build_object('enabled', false);
  end if;

  insert into public.grading_jobs (interview_id, submission_id, options, max_attempts)
  select i.id, i.submission_id, jsonb_build_object('source', 'reconcile'), coalesce(v_max, 5)
  from public.interviews i
  where i.status = 'completed'
    and i.completed_at >= coalesce(v_since, now())
    and i.completed_at < now() - make_interval(secs => greatest(0, p_min_age_seconds))
    and not exists (select 1 from public.grading_jobs j where j.interview_id = i.id)
  on conflict (interview_id) do nothing;
  get diagnostics v_enqueued = row_count;

  update public.grading_jobs
  set status = 'dead', stage = 'dead', finished_at = now()
  where status = 'failed' and attempts >= max_attempts;
  get diagnostics v_dead = row_count;

  select count(*) into v_expired_leases
  from public.grading_jobs where status = 'running' and lease_until < now();

  update public.grading_jobs j
  set status = 'queued', stage = 'queued', run_after = now(), attempts = 0,
      finished_at = null, last_error = null,
      options = j.options || jsonb_build_object('source', 'reconcile_missing_report')
  from public.submissions s
  where s.id = j.submission_id
    and j.status = 'done'
    and j.finished_at < now() - make_interval(secs => greatest(0, p_min_age_seconds))
    and (
      s.status <> 'report_ready'
      or not exists (select 1 from public.reports r where r.interview_id = j.interview_id and r.status = 'ready')
    );
  get diagnostics v_requeued = row_count;

  v_expired_slots := public.expire_ai_slots();

  return jsonb_build_object(
    'enqueued', v_enqueued,
    'dead', v_dead,
    'expired_leases', v_expired_leases,
    'requeued_missing_report', v_requeued,
    'expired_slots', v_expired_slots
  );
end;
$$;

create or replace function public.create_grading_run(
  p_interview_id uuid,
  p_submission_id uuid,
  p_job_id uuid,
  p_input_hash text,
  p_versions jsonb,
  p_models jsonb,
  p_params jsonb,
  p_provider text default 'openai'
)
returns public.grading_runs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.grading_runs;
  v_no integer;
begin
  perform pg_advisory_xact_lock(hashtext('grading_run:' || p_interview_id::text));
  select coalesce(max(run_no), 0) + 1 into v_no
  from public.grading_runs where interview_id = p_interview_id;

  -- Any other run still "running" for this interview belongs to a worker
  -- that lost its lease: it must not overwrite this run's result later.
  update public.grading_runs
  set status = 'superseded', finished_at = now()
  where interview_id = p_interview_id and status = 'running';

  insert into public.grading_runs (
    interview_id, submission_id, job_id, run_no, status,
    rubric_version, prompt_version, scoring_version,
    provider, models, params, input_hash
  ) values (
    p_interview_id, p_submission_id, p_job_id, v_no, 'running',
    coalesce(p_versions->>'rubricVersion', 'v1'),
    coalesce(p_versions->>'promptVersion', 'v1'),
    coalesce(p_versions->>'scoringVersion', 'v1'),
    coalesce(p_provider, 'openai'), coalesce(p_models, '{}'::jsonb), coalesce(p_params, '{}'::jsonb), p_input_hash
  )
  returning * into v_run;

  if p_job_id is not null then
    update public.grading_jobs set grading_run_id = v_run.id, stage = 'evaluating' where id = p_job_id;
  end if;
  return v_run;
end;
$$;

create or replace function public.checkpoint_grading_run(p_run_id uuid, p_evaluations jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.grading_runs
  set evaluations = coalesce(p_evaluations, '[]'::jsonb)
  where id = p_run_id and status = 'running';
  return found;
end;
$$;

create or replace function public.fail_grading_run(p_run_id uuid, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.grading_runs
  set status = 'failed', error = left(coalesce(p_error, 'unknown'), 2000), finished_at = now()
  where id = p_run_id and status = 'running';
  return found;
end;
$$;

-- The ONE transaction that publishes a grading result: run -> succeeded,
-- answer_evaluations replaced, report upserted, submission report_ready,
-- job done. Idempotent: replaying the same run is a no-op rewrite of the
-- same values; a superseded run is refused.
create or replace function public.persist_grading_result(
  p_run_id uuid,
  p_job_id uuid,
  p_worker text,
  p_run jsonb,
  p_evaluations jsonb,
  p_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.grading_runs;
  v_report_id uuid;
begin
  select * into v_run from public.grading_runs where id = p_run_id for update;
  if not found then
    raise exception 'grading_run_not_found' using errcode = 'P0002';
  end if;
  if v_run.status = 'superseded' then
    return jsonb_build_object('ok', false, 'reason', 'superseded');
  end if;

  update public.grading_runs
  set status = 'succeeded',
      result = p_run->'result',
      narrative = p_run->'narrative',
      evaluations = coalesce(p_run->'evaluations', evaluations),
      usage = p_run->'usage',
      timings = p_run->'timings',
      reused_from_run_id = nullif(p_run->>'reused_from_run_id', '')::uuid,
      error = null,
      finished_at = now()
  where id = p_run_id;

  delete from public.answer_evaluations where interview_id = v_run.interview_id;
  insert into public.answer_evaluations (
    interview_id, message_id, question_id, model, understanding_level,
    clarity_score, conceptual_score, reasoning_score, consistency_score,
    evidence, gaps, recommended_next_action, recommended_followup, raw_output,
    grading_run_id, question_score, answer_status, evidence_status, confidence,
    pass_count, verified_evidence, rubric_version, prompt_version, scoring_version
  )
  select
    v_run.interview_id,
    r.message_id, r.question_id, coalesce(r.model, 'unknown'), r.understanding_level,
    r.clarity_score, r.conceptual_score, r.reasoning_score, r.consistency_score,
    coalesce(r.evidence, '[]'::jsonb), coalesce(r.gaps, '[]'::jsonb), null, null, coalesce(r.raw_output, '{}'::jsonb),
    p_run_id, r.question_score, r.answer_status, r.evidence_status, r.confidence,
    coalesce(r.pass_count, 1), coalesce(r.verified_evidence, '[]'::jsonb),
    r.rubric_version, r.prompt_version, r.scoring_version
  from jsonb_to_recordset(coalesce(p_evaluations, '[]'::jsonb)) as r(
    message_id uuid, question_id text, model text, understanding_level public.understanding_level,
    clarity_score numeric, conceptual_score numeric, reasoning_score numeric, consistency_score numeric,
    evidence jsonb, gaps jsonb, raw_output jsonb,
    question_score numeric, answer_status text, evidence_status text, confidence text,
    pass_count integer, verified_evidence jsonb, rubric_version text, prompt_version text, scoring_version text
  );

  insert into public.reports (
    submission_id, interview_id, student_id, assignment_id,
    overall_level, summary, rubric_result, gaps, evidence, recommendations,
    pdf_path, status, grading_run_id
  ) values (
    v_run.submission_id,
    v_run.interview_id,
    (p_report->>'student_id')::uuid,
    (p_report->>'assignment_id')::uuid,
    (p_report->>'overall_level')::public.understanding_level,
    p_report->>'summary',
    p_report->'rubric_result',
    coalesce(p_report->'gaps', '[]'::jsonb),
    coalesce(p_report->'evidence', '[]'::jsonb),
    coalesce(p_report->'recommendations', '[]'::jsonb),
    null,
    'ready'::public.report_status,
    p_run_id
  )
  on conflict (submission_id) do update
    set interview_id = excluded.interview_id,
        student_id = excluded.student_id,
        assignment_id = excluded.assignment_id,
        overall_level = excluded.overall_level,
        summary = excluded.summary,
        rubric_result = excluded.rubric_result,
        gaps = excluded.gaps,
        evidence = excluded.evidence,
        recommendations = excluded.recommendations,
        status = 'ready'::public.report_status,
        grading_run_id = excluded.grading_run_id,
        updated_at = now()
  returning id into v_report_id;

  update public.submissions
  set status = 'report_ready'
  where id = v_run.submission_id
    and status in ('interview_completed', 'report_ready');

  if p_job_id is not null then
    update public.grading_jobs
    set status = 'done', stage = 'done', finished_at = now(),
        leased_by = null, lease_until = null, grading_run_id = p_run_id, last_error = null
    where id = p_job_id
      and (leased_by is null or p_worker is null or leased_by = p_worker);
  end if;

  insert into public.system_events (actor_id, entity_type, entity_id, event_type, payload)
  values (
    null, 'report', v_report_id, 'report.generated',
    jsonb_build_object(
      'engine', 'v2',
      'grading_run_id', p_run_id,
      'overall_score', p_report->'rubric_result'->'overall_score',
      'overall_level', p_report->>'overall_level',
      'requires_human_review', p_report->'rubric_result'->'requires_human_review',
      'reused_from_run_id', p_run->>'reused_from_run_id'
    )
  );

  return jsonb_build_object('ok', true, 'report_id', v_report_id, 'run_id', p_run_id);
end;
$$;

-- ===== 7. outbox trigger ====================================================
create or replace function private.enqueue_grading_on_complete()
returns trigger
language plpgsql
set search_path = public, private
as $$
declare
  v_enabled boolean;
  v_max integer;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select queue_enabled, max_attempts into v_enabled, v_max from public.grading_config where id = 1;
    if coalesce(v_enabled, true) then
      insert into public.grading_jobs (interview_id, submission_id, options, max_attempts)
      values (new.id, new.submission_id, jsonb_build_object('source', 'trigger'), coalesce(v_max, 5))
      on conflict (interview_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_grading_on_complete on public.interviews;
create trigger enqueue_grading_on_complete
  after update of status on public.interviews
  for each row execute function private.enqueue_grading_on_complete();

-- ===== 8. grading_status (student / lecturer) ==============================
create or replace function private.grading_error_code(p_error text)
returns text
language sql
immutable
as $$
  select case
    when p_error is null then null
    else left(regexp_replace(split_part(p_error, ':', 1), '[^a-zA-Z0-9_.-]', '', 'g'), 60)
  end;
$$;

create or replace function public.grading_status(p_interview_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_student uuid;
  v_job jsonb;
  v_report jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select student_id into v_student from public.interviews where id = p_interview_id;
  if not found then
    return null;
  end if;
  if v_student <> v_uid and not private.is_interview_lecturer(p_interview_id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'status', j.status,
    'stage', j.stage,
    'attempts', j.attempts,
    'max_attempts', j.max_attempts,
    'run_after', j.run_after,
    'error_code', private.grading_error_code(j.last_error),
    'updated_at', j.updated_at
  ) into v_job
  from public.grading_jobs j where j.interview_id = p_interview_id;

  select jsonb_build_object('status', r.status, 'grading_run_id', r.grading_run_id, 'updated_at', r.updated_at)
  into v_report
  from public.reports r where r.interview_id = p_interview_id;

  return jsonb_build_object('job', v_job, 'report', v_report);
end;
$$;

-- ===== 9. indexes + policy initplan ========================================
-- create-realtime-session counts mints per interview in a time window.
create index if not exists system_events_entity_event_time_idx
  on public.system_events (entity_type, entity_id, event_type, created_at);

drop policy if exists "report_owner_select" on public.reports;
create policy "report_owner_select"
  on public.reports for select
  to authenticated
  using (student_id = (select auth.uid()));

-- ===== grants ===============================================================
revoke all on function public.acquire_ai_slot(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_ai_slot(text, text) from public, anon, authenticated;
revoke all on function public.expire_ai_slots() from public, anon, authenticated;
revoke all on function public.claim_grading_jobs(text, integer, uuid, integer) from public, anon, authenticated;
revoke all on function public.extend_grading_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.set_grading_stage(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fail_grading_job(uuid, text, text, integer, boolean) from public, anon, authenticated;
revoke all on function public.requeue_grading(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.reconcile_grading(integer) from public, anon, authenticated;
revoke all on function public.create_grading_run(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.checkpoint_grading_run(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_grading_run(uuid, text) from public, anon, authenticated;
revoke all on function public.persist_grading_result(uuid, uuid, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.acquire_ai_slot(text, text, integer) to service_role;
grant execute on function public.release_ai_slot(text, text) to service_role;
grant execute on function public.expire_ai_slots() to service_role;
grant execute on function public.claim_grading_jobs(text, integer, uuid, integer) to service_role;
grant execute on function public.extend_grading_lease(uuid, text, integer) to service_role;
grant execute on function public.set_grading_stage(uuid, text, text) to service_role;
grant execute on function public.fail_grading_job(uuid, text, text, integer, boolean) to service_role;
grant execute on function public.requeue_grading(uuid, jsonb, integer) to service_role;
grant execute on function public.reconcile_grading(integer) to service_role;
grant execute on function public.create_grading_run(uuid, uuid, uuid, text, jsonb, jsonb, jsonb, text) to service_role;
grant execute on function public.checkpoint_grading_run(uuid, jsonb) to service_role;
grant execute on function public.fail_grading_run(uuid, text) to service_role;
grant execute on function public.persist_grading_result(uuid, uuid, text, jsonb, jsonb, jsonb) to service_role;

revoke all on function public.grading_status(uuid) from public, anon;
grant execute on function public.grading_status(uuid) to authenticated, service_role;
