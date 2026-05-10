-- Podtask: initial schema (sections 8.1-8.17 of the spec).
-- Creates extensions, enums, all 17 tables, FKs, indexes, and updated_at triggers.

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector";
create extension if not exists "pg_trgm";
create extension if not exists "moddatetime";

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ===== Enums =====
create type public.app_role as enum ('student', 'lecturer', 'admin');

create type public.course_role as enum ('student', 'lecturer', 'ta');

create type public.assignment_status as enum ('draft', 'published', 'closed', 'archived');

create type public.student_assignment_status as enum (
  'not_started',
  'upload_required',
  'processing',
  'ready_for_interview',
  'mic_test_required',
  'interview_in_progress',
  'completed',
  'failed'
);

create type public.submission_status as enum (
  'uploaded',
  'parsing',
  'parsed',
  'analyzing',
  'analysis_ready',
  'interview_ready',
  'interview_completed',
  'report_ready',
  'failed'
);

create type public.interview_status as enum (
  'created',
  'ready',
  'starting',
  'in_progress',
  'paused',
  'completed',
  'failed',
  'cancelled'
);

create type public.interview_runtime_state as enum (
  'idle',
  'connecting',
  'host_intro',
  'ai_speaking',
  'student_turn',
  'student_recording',
  'transcribing',
  'evaluating_answer',
  'followup',
  'closing',
  'completed',
  'failed'
);

create type public.parse_provider as enum ('mistral_ocr', 'llamaparse', 'manual_text');

create type public.interview_speaker as enum ('ai_host', 'student', 'system');

create type public.interview_message_type as enum (
  'question',
  'answer',
  'followup',
  'system',
  'summary'
);

create type public.understanding_level as enum ('low', 'medium', 'medium_high', 'high');

create type public.report_status as enum ('draft', 'ready', 'reviewed', 'flagged');

create type public.ai_operation as enum (
  'parse_document',
  'embed_chunks',
  'analyze_assignment',
  'generate_interview_plan',
  'realtime_voice',
  'evaluate_answer',
  'generate_report'
);

-- ===== 8.2 institutions =====
create table public.institutions (
  id uuid primary key default extensions.uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger institutions_set_updated_at
  before update on public.institutions
  for each row execute procedure moddatetime(updated_at);

-- ===== 8.1 profiles =====
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'student',
  institution_id uuid references public.institutions(id) on delete set null,
  avatar_url text,
  locale text not null default 'he',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_institution_idx on public.profiles(institution_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute procedure moddatetime(updated_at);

-- handle_new_user: copy auth.users → profiles on signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, locale)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'student',
    coalesce(new.raw_user_meta_data->>'locale', 'he')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ===== 8.3 courses =====
create table public.courses (
  id uuid primary key default extensions.uuid_generate_v4(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  name text not null,
  code text not null,
  semester text,
  lecturer_name text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index courses_institution_idx on public.courses(institution_id);

create trigger courses_set_updated_at
  before update on public.courses
  for each row execute procedure moddatetime(updated_at);

-- ===== 8.4 course_members =====
create table public.course_members (
  id uuid primary key default extensions.uuid_generate_v4(),
  course_id uuid not null references public.courses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.course_role not null default 'student',
  created_at timestamptz not null default now(),
  unique (course_id, user_id, role)
);

create index course_members_user_idx on public.course_members(user_id);
create index course_members_course_idx on public.course_members(course_id);

-- ===== 8.5 assignments =====
create table public.assignments (
  id uuid primary key default extensions.uuid_generate_v4(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  description text,
  instructions text,
  due_at timestamptz,
  status public.assignment_status not null default 'draft',
  language text not null default 'he',
  interview_duration_minutes integer not null default 12,
  allow_audio_storage boolean not null default true,
  allow_transcript_visible_to_student boolean not null default false,
  require_microphone_test boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assignments_course_status_idx
  on public.assignments(course_id, status);

create trigger assignments_set_updated_at
  before update on public.assignments
  for each row execute procedure moddatetime(updated_at);

-- ===== 8.6 submissions =====
create table public.submissions (
  id uuid primary key default extensions.uuid_generate_v4(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  file_path text,
  original_filename text,
  mime_type text,
  file_size_bytes bigint,
  status public.submission_status not null default 'uploaded',
  failure_reason text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create index submissions_student_idx on public.submissions(student_id);
create index submissions_assignment_idx on public.submissions(assignment_id);
create index submissions_status_idx on public.submissions(status);

create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute procedure moddatetime(updated_at);

-- ===== 8.7 document_parses =====
create table public.document_parses (
  id uuid primary key default extensions.uuid_generate_v4(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  provider public.parse_provider not null,
  markdown text,
  page_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index document_parses_submission_idx on public.document_parses(submission_id);

-- ===== 8.8 document_chunks =====
create table public.document_chunks (
  id uuid primary key default extensions.uuid_generate_v4(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  chunk_index integer not null,
  page_start integer,
  page_end integer,
  heading text,
  content text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (submission_id, chunk_index)
);

create index document_chunks_submission_idx on public.document_chunks(submission_id);
-- vector ANN index added later once chunks exist.

-- ===== 8.9 document_analyses =====
create table public.document_analyses (
  id uuid primary key default extensions.uuid_generate_v4(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  model text not null,
  summary text,
  main_argument text,
  key_concepts jsonb not null default '[]'::jsonb,
  claims jsonb not null default '[]'::jsonb,
  methodology jsonb,
  weak_points jsonb not null default '[]'::jsonb,
  complex_sections jsonb not null default '[]'::jsonb,
  interview_targets jsonb not null default '[]'::jsonb,
  raw_output jsonb,
  created_at timestamptz not null default now()
);

create index document_analyses_submission_idx on public.document_analyses(submission_id);

-- ===== 8.10 interviews =====
create table public.interviews (
  id uuid primary key default extensions.uuid_generate_v4(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status public.interview_status not null default 'created',
  language text not null default 'he',
  current_state public.interview_runtime_state not null default 'idle',
  started_at timestamptz,
  completed_at timestamptz,
  duration_seconds integer,
  audio_path text,
  transcript_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index interviews_student_idx on public.interviews(student_id);
create index interviews_submission_idx on public.interviews(submission_id);
create index interviews_status_idx on public.interviews(status);

create trigger interviews_set_updated_at
  before update on public.interviews
  for each row execute procedure moddatetime(updated_at);

-- ===== 8.11 interview_plans =====
create table public.interview_plans (
  id uuid primary key default extensions.uuid_generate_v4(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  model text not null,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  unique (interview_id)
);

-- ===== 8.12 interview_messages =====
create table public.interview_messages (
  id uuid primary key default extensions.uuid_generate_v4(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  speaker public.interview_speaker not null,
  message_type public.interview_message_type not null,
  content text,
  audio_path text,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index interview_messages_interview_idx
  on public.interview_messages(interview_id, created_at);

-- ===== 8.13 answer_evaluations =====
create table public.answer_evaluations (
  id uuid primary key default extensions.uuid_generate_v4(),
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

create index answer_evaluations_interview_idx
  on public.answer_evaluations(interview_id);

-- ===== 8.14 reports =====
create table public.reports (
  id uuid primary key default extensions.uuid_generate_v4(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  interview_id uuid not null references public.interviews(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
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

create index reports_student_idx on public.reports(student_id);

create trigger reports_set_updated_at
  before update on public.reports
  for each row execute procedure moddatetime(updated_at);

-- ===== 8.15 system_events =====
create table public.system_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index system_events_entity_idx on public.system_events(entity_type, entity_id);
create index system_events_event_idx on public.system_events(event_type);

-- ===== 8.16 ai_usage_logs =====
create table public.ai_usage_logs (
  id uuid primary key default extensions.uuid_generate_v4(),
  institution_id uuid references public.institutions(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  entity_type text,
  entity_id uuid,
  provider text not null,
  model text not null,
  operation public.ai_operation not null,
  input_tokens integer,
  output_tokens integer,
  audio_seconds integer,
  estimated_cost_usd numeric(10,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ai_usage_logs_user_idx on public.ai_usage_logs(user_id);
create index ai_usage_logs_institution_idx on public.ai_usage_logs(institution_id);

-- ===== 8.17 rate_limit_events =====
create table public.rate_limit_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  user_id uuid references public.profiles(id) on delete cascade,
  key text not null,
  count integer not null default 1,
  window_start timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index rate_limit_events_user_key_idx on public.rate_limit_events(user_id, key);
