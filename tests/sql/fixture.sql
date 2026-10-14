-- Minimal stand-in for the production schema, enough for the grading
-- migration to apply inside pglite (no Supabase roles / extensions there).
-- Only the tables and columns the migration and its RPCs touch.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create schema if not exists auth;
create schema if not exists private;
create schema if not exists extensions;

-- auth.uid() / auth.role() read a per-session setting so tests can act as a user.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('test.role', true), ''), 'service_role');
$$;

create or replace function private.is_interview_lecturer(target_interview_id uuid, target_user_id uuid default auth.uid())
returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('test.lecturer', true), ''), 'false')::boolean;
$$;

create type public.submission_status as enum (
  'uploaded','parsing','parsed','analyzing','analysis_ready','interview_ready','interview_completed','report_ready','failed');
create type public.interview_status as enum (
  'created','ready','starting','in_progress','paused','completed','failed','cancelled');
create type public.interview_speaker as enum ('ai_host','student','system');
create type public.interview_message_type as enum ('question','answer','followup','system','summary');
create type public.understanding_level as enum ('low','medium','medium_high','high');
create type public.report_status as enum ('draft','ready','reviewed','flagged');

create table public.profiles (id uuid primary key, email text);
create table public.assignments (id uuid primary key, title text, language text default 'he');
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id),
  student_id uuid not null references public.profiles(id),
  status public.submission_status not null default 'uploaded',
  updated_at timestamptz not null default now()
);
create table public.interviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id),
  student_id uuid not null references public.profiles(id),
  status public.interview_status not null default 'created',
  language text not null default 'he',
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create table public.interview_messages (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  speaker public.interview_speaker not null,
  message_type public.interview_message_type not null,
  content text,
  plan_question_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.answer_evaluations (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  message_id uuid references public.interview_messages(id) on delete set null,
  question_id text,
  model text not null,
  understanding_level public.understanding_level,
  clarity_score numeric(4,2),
  conceptual_score numeric(4,2),
  reasoning_score numeric(4,2),
  consistency_score numeric(4,2),
  evidence jsonb,
  gaps jsonb,
  recommended_next_action text,
  recommended_followup text,
  raw_output jsonb,
  created_at timestamptz not null default now()
);
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  student_id uuid not null references public.profiles(id),
  assignment_id uuid not null references public.assignments(id),
  overall_level public.understanding_level,
  summary text,
  rubric_result jsonb,
  gaps jsonb,
  evidence jsonb,
  recommendations jsonb,
  pdf_path text,
  status public.report_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id)
);
alter table public.reports enable row level security;
create policy "report_owner_select" on public.reports for select to authenticated using (student_id = auth.uid());
create table public.system_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
