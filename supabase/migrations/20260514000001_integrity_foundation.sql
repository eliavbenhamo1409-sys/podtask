-- Podtask: integrity foundation, part 1 (additive, safe to apply before the
-- matching web deploy).
--
--   1. profiles: a signed-in user can never change their own role / institution.
--   2. lecturer RBAC helpers (private schema, SECURITY DEFINER).
--   3. lecturer read policies on the student pipeline tables, plus
--      insert/update on assignments in courses they lecture.
--   4. integrity tables: telemetry events, flags, consents, lecturer reviews.
--      Written by Edge Functions (service role) only; lecturers read them.
--   5. interview_outline(): the planned questions WITHOUT their text until
--      the interview is over (lecturers always see the text).
--   6. lecturer RPCs: create a course, enrol students by e-mail.
--   7. idempotent transcript writes (client_id unique per interview).
--
-- Part 2 (20260514000002_integrity_lockdown.sql) removes the student's direct
-- writes and is applied right after the web deploy that stops using them.

-- ===== 1. Role guard ========================================================
create or replace function private.guard_profile_self_update()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  -- PostgREST requests run as `authenticated` / `anon`; service-role calls
  -- and SQL run by the owner do not. Only the former are restricted.
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     or current_user in ('authenticated', 'anon') then
    if new.role is distinct from old.role then
      raise exception 'profile_role_change_forbidden' using errcode = '42501';
    end if;
    if new.institution_id is distinct from old.institution_id then
      raise exception 'profile_institution_change_forbidden' using errcode = '42501';
    end if;
    if new.id is distinct from old.id or new.email is distinct from old.email then
      raise exception 'profile_identity_change_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_self_update on public.profiles;
create trigger guard_profile_self_update
  before update on public.profiles
  for each row execute function private.guard_profile_self_update();

-- ===== 2. Lecturer helpers ==================================================
create or replace function private.is_staff(target_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target_user_id and p.role in ('lecturer', 'admin')
  );
$$;
revoke all on function private.is_staff(uuid) from public, anon, authenticated;
grant execute on function private.is_staff(uuid) to authenticated, service_role;

-- A lecturer of a course = staff profile + lecturer/ta membership of the
-- course. An admin is a lecturer of every course in their institution.
create or replace function private.is_course_lecturer(
  target_course_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1
    from public.course_members cm
    join public.profiles p on p.id = cm.user_id
    where cm.course_id = target_course_id
      and cm.user_id = target_user_id
      and cm.role in ('lecturer', 'ta')
      and p.role in ('lecturer', 'admin')
  ) or exists (
    select 1
    from public.profiles p
    join public.courses c on c.institution_id = p.institution_id
    where p.id = target_user_id and p.role = 'admin' and c.id = target_course_id
  );
$$;
revoke all on function private.is_course_lecturer(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_course_lecturer(uuid, uuid) to authenticated, service_role;

create or replace function private.is_assignment_lecturer(
  target_assignment_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.assignments a
    where a.id = target_assignment_id
      and private.is_course_lecturer(a.course_id, target_user_id)
  );
$$;
revoke all on function private.is_assignment_lecturer(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_assignment_lecturer(uuid, uuid) to authenticated, service_role;

create or replace function private.is_submission_lecturer(
  target_submission_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.submissions s
    where s.id = target_submission_id
      and private.is_assignment_lecturer(s.assignment_id, target_user_id)
  );
$$;
revoke all on function private.is_submission_lecturer(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_submission_lecturer(uuid, uuid) to authenticated, service_role;

create or replace function private.is_interview_lecturer(
  target_interview_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1 from public.interviews i
    where i.id = target_interview_id
      and private.is_assignment_lecturer(i.assignment_id, target_user_id)
  );
$$;
revoke all on function private.is_interview_lecturer(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_interview_lecturer(uuid, uuid) to authenticated, service_role;

-- Can the caller (a lecturer) see this profile? Only students enrolled in a
-- course the caller lectures. Runs outside RLS so the profiles policy below
-- does not recurse through course_members policies.
create or replace function private.lecturer_can_view_profile(
  target_profile_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select private.is_staff(target_user_id) and exists (
    select 1
    from public.course_members student
    join public.course_members me on me.course_id = student.course_id
    where student.user_id = target_profile_id
      and me.user_id = target_user_id
      and me.role in ('lecturer', 'ta')
  );
$$;
revoke all on function private.lecturer_can_view_profile(uuid, uuid) from public, anon, authenticated;
grant execute on function private.lecturer_can_view_profile(uuid, uuid) to authenticated, service_role;

-- ===== 3. Lecturer policies =================================================
drop policy if exists "course_lecturer_select" on public.courses;
create policy "course_lecturer_select"
  on public.courses for select
  to authenticated
  using (private.is_course_lecturer(id));

drop policy if exists "course_member_lecturer_select" on public.course_members;
create policy "course_member_lecturer_select"
  on public.course_members for select
  to authenticated
  using (private.is_course_lecturer(course_id));

drop policy if exists "course_member_lecturer_delete" on public.course_members;
create policy "course_member_lecturer_delete"
  on public.course_members for delete
  to authenticated
  using (role = 'student' and private.is_course_lecturer(course_id));

drop policy if exists "profile_lecturer_select" on public.profiles;
create policy "profile_lecturer_select"
  on public.profiles for select
  to authenticated
  using (private.lecturer_can_view_profile(id));

drop policy if exists "assignment_lecturer_select" on public.assignments;
create policy "assignment_lecturer_select"
  on public.assignments for select
  to authenticated
  using (private.is_course_lecturer(course_id));

drop policy if exists "assignment_lecturer_insert" on public.assignments;
create policy "assignment_lecturer_insert"
  on public.assignments for insert
  to authenticated
  with check (private.is_course_lecturer(course_id));

drop policy if exists "assignment_lecturer_update" on public.assignments;
create policy "assignment_lecturer_update"
  on public.assignments for update
  to authenticated
  using (private.is_course_lecturer(course_id))
  with check (private.is_course_lecturer(course_id));

drop policy if exists "submission_lecturer_select" on public.submissions;
create policy "submission_lecturer_select"
  on public.submissions for select
  to authenticated
  using (private.is_assignment_lecturer(assignment_id));

drop policy if exists "document_analysis_lecturer_select" on public.document_analyses;
create policy "document_analysis_lecturer_select"
  on public.document_analyses for select
  to authenticated
  using (private.is_submission_lecturer(submission_id));

drop policy if exists "interview_lecturer_select" on public.interviews;
create policy "interview_lecturer_select"
  on public.interviews for select
  to authenticated
  using (private.is_assignment_lecturer(assignment_id));

drop policy if exists "interview_plan_lecturer_select" on public.interview_plans;
create policy "interview_plan_lecturer_select"
  on public.interview_plans for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

drop policy if exists "interview_message_lecturer_select" on public.interview_messages;
create policy "interview_message_lecturer_select"
  on public.interview_messages for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

drop policy if exists "answer_evaluation_lecturer_select" on public.answer_evaluations;
create policy "answer_evaluation_lecturer_select"
  on public.answer_evaluations for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

drop policy if exists "report_lecturer_select" on public.reports;
create policy "report_lecturer_select"
  on public.reports for select
  to authenticated
  using (private.is_assignment_lecturer(assignment_id));

drop policy if exists "system_event_lecturer_select" on public.system_events;
create policy "system_event_lecturer_select"
  on public.system_events for select
  to authenticated
  using (
    entity_id is not null and (
      (entity_type = 'interview' and private.is_interview_lecturer(entity_id))
      or (entity_type = 'submission' and private.is_submission_lecturer(entity_id))
    )
  );

-- ===== 4. Integrity tables ==================================================
-- Client-reported telemetry (tab switches, camera, nudges, disconnects) and
-- server-side events (resumes, session checks). `source` says which.
create table if not exists public.interview_integrity_events (
  id uuid primary key default extensions.uuid_generate_v4(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  plan_question_id text,
  kind text not null,
  source text not null default 'client' check (source in ('client', 'server', 'host')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists interview_integrity_events_interview_idx
  on public.interview_integrity_events(interview_id, started_at);
alter table public.interview_integrity_events enable row level security;

drop policy if exists "integrity_event_lecturer_select" on public.interview_integrity_events;
create policy "integrity_event_lecturer_select"
  on public.interview_integrity_events for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

-- Review items: raised by the host (flag_answer tool) or by server-side
-- analysis after the interview. Evidence, never a verdict.
create table if not exists public.interview_flags (
  id uuid primary key default extensions.uuid_generate_v4(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  plan_question_id text,
  message_id uuid references public.interview_messages(id) on delete set null,
  category text not null,
  description text not null,
  quote text,
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null default 'low' check (confidence in ('low', 'medium', 'high')),
  limitations text,
  needs_human_review boolean not null default true,
  source text not null check (source in ('host_tool', 'server_overlap', 'server_timing', 'server_session', 'evaluator')),
  created_at timestamptz not null default now()
);
create index if not exists interview_flags_interview_idx
  on public.interview_flags(interview_id, created_at);
alter table public.interview_flags enable row level security;

drop policy if exists "interview_flag_lecturer_select" on public.interview_flags;
create policy "interview_flag_lecturer_select"
  on public.interview_flags for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

-- The student's acknowledgement of the integrity notice, recorded server-side.
create table if not exists public.interview_consents (
  id uuid primary key default extensions.uuid_generate_v4(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  version text not null,
  locale text not null default 'he',
  user_agent text,
  accepted_at timestamptz not null default now(),
  unique (interview_id, version)
);
alter table public.interview_consents enable row level security;

drop policy if exists "interview_consent_owner_select" on public.interview_consents;
create policy "interview_consent_owner_select"
  on public.interview_consents for select
  to authenticated
  using (student_id = auth.uid());

drop policy if exists "interview_consent_lecturer_select" on public.interview_consents;
create policy "interview_consent_lecturer_select"
  on public.interview_consents for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

-- The lecturer's review state for one interview.
create table if not exists public.interview_reviews (
  interview_id uuid primary key references public.interviews(id) on delete cascade,
  reviewer_id uuid references public.profiles(id) on delete set null,
  status text not null default 'unreviewed'
    check (status in ('unreviewed', 'reviewed', 'needs_clarification', 'closed_no_finding')),
  follow_up_requested boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.interview_reviews enable row level security;

drop trigger if exists interview_reviews_set_updated_at on public.interview_reviews;
create trigger interview_reviews_set_updated_at
  before update on public.interview_reviews
  for each row execute procedure moddatetime(updated_at);

drop policy if exists "interview_review_lecturer_select" on public.interview_reviews;
create policy "interview_review_lecturer_select"
  on public.interview_reviews for select
  to authenticated
  using (private.is_interview_lecturer(interview_id));

drop policy if exists "interview_review_lecturer_insert" on public.interview_reviews;
create policy "interview_review_lecturer_insert"
  on public.interview_reviews for insert
  to authenticated
  with check (reviewer_id = auth.uid() and private.is_interview_lecturer(interview_id));

drop policy if exists "interview_review_lecturer_update" on public.interview_reviews;
create policy "interview_review_lecturer_update"
  on public.interview_reviews for update
  to authenticated
  using (private.is_interview_lecturer(interview_id))
  with check (reviewer_id = auth.uid() and private.is_interview_lecturer(interview_id));

-- ===== 5. interview_outline =================================================
-- The planned questions for the room and the lobby: ids, topics and timing,
-- never the question text while the interview can still be taken. The
-- lecturer and the finished interview get the text.
create or replace function public.interview_outline(p_interview_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_student uuid;
  v_status public.interview_status;
  v_plan jsonb;
  v_reveal boolean;
  v_questions jsonb;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select i.student_id, i.status into v_student, v_status
  from public.interviews i
  where i.id = p_interview_id;
  if not found then
    return null;
  end if;

  if v_student <> v_uid and not private.is_interview_lecturer(p_interview_id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.plan into v_plan
  from public.interview_plans p
  where p.interview_id = p_interview_id;
  if v_plan is null then
    return jsonb_build_object('questions', '[]'::jsonb, 'revealed', false);
  end if;

  v_reveal := v_status in ('completed', 'failed', 'cancelled')
    or private.is_interview_lecturer(p_interview_id, v_uid);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', q->>'id',
        'topic', q->>'topic',
        'kind', q->>'kind',
        'question', case when v_reveal then q->>'question' else null end,
        'recommended_seconds', coalesce((q->>'recommended_seconds')::int, 75)
      )
      order by ord
    ),
    '[]'::jsonb
  )
  into v_questions
  from jsonb_array_elements(coalesce(v_plan->'questions', '[]'::jsonb))
    with ordinality as t(q, ord);

  return jsonb_build_object('questions', v_questions, 'revealed', v_reveal);
end;
$$;
revoke all on function public.interview_outline(uuid) from public, anon;
grant execute on function public.interview_outline(uuid) to authenticated, service_role;

-- ===== 6. Lecturer RPCs =====================================================
create or replace function public.lecturer_create_course(
  p_name text,
  p_code text,
  p_semester text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_profile record;
  v_course_id uuid;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select id, role, institution_id, full_name, email into v_profile
  from public.profiles where id = v_uid;
  if not found or v_profile.role not in ('lecturer', 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_profile.institution_id is null then
    raise exception 'no_institution_for_user';
  end if;
  if v_name is null or v_code is null then
    raise exception 'invalid_course';
  end if;
  if upper(v_code) = 'PERSONAL' then
    raise exception 'reserved_course_code';
  end if;

  insert into public.courses (institution_id, name, code, semester, lecturer_name)
  values (
    v_profile.institution_id,
    v_name,
    v_code,
    nullif(btrim(coalesce(p_semester, '')), ''),
    coalesce(v_profile.full_name, v_profile.email)
  )
  returning id into v_course_id;

  insert into public.course_members (course_id, user_id, role)
  values (v_course_id, v_uid, 'lecturer')
  on conflict do nothing;

  return v_course_id;
end;
$$;
revoke all on function public.lecturer_create_course(text, text, text) from public, anon;
grant execute on function public.lecturer_create_course(text, text, text) to authenticated;

-- Enrol existing student accounts by e-mail. Returns which were added and
-- which have no account yet (the lecturer tells them to sign up first).
create or replace function public.lecturer_add_course_members(
  p_course_id uuid,
  p_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_norm text;
  v_profile_id uuid;
  v_added text[] := '{}';
  v_missing text[] := '{}';
  v_already text[] := '{}';
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not private.is_course_lecturer(p_course_id, v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_emails is null or array_length(p_emails, 1) is null then
    return jsonb_build_object('added', '[]'::jsonb, 'missing', '[]'::jsonb, 'already', '[]'::jsonb);
  end if;
  if array_length(p_emails, 1) > 200 then
    raise exception 'too_many_emails';
  end if;

  foreach v_email in array p_emails loop
    v_norm := lower(btrim(coalesce(v_email, '')));
    if v_norm = '' then
      continue;
    end if;
    select p.id into v_profile_id
    from public.profiles p
    where lower(p.email) = v_norm and p.role = 'student'
    limit 1;
    if v_profile_id is null then
      v_missing := array_append(v_missing, v_norm);
      continue;
    end if;
    if exists (
      select 1 from public.course_members cm
      where cm.course_id = p_course_id and cm.user_id = v_profile_id and cm.role = 'student'
    ) then
      v_already := array_append(v_already, v_norm);
      continue;
    end if;
    insert into public.course_members (course_id, user_id, role)
    values (p_course_id, v_profile_id, 'student')
    on conflict do nothing;
    v_added := array_append(v_added, v_norm);
  end loop;

  return jsonb_build_object(
    'added', to_jsonb(v_added),
    'missing', to_jsonb(v_missing),
    'already', to_jsonb(v_already)
  );
end;
$$;
revoke all on function public.lecturer_add_course_members(uuid, text[]) from public, anon;
grant execute on function public.lecturer_add_course_members(uuid, text[]) to authenticated;

-- ===== 7. Idempotent transcript writes =====================================
-- The room sends every final transcript twice (two Realtime events carry the
-- same turn). A client-side turn id in metadata makes the second insert a
-- no-op instead of a duplicate answer.
create unique index if not exists interview_messages_client_id_uidx
  on public.interview_messages (interview_id, (metadata->>'client_id'))
  where metadata ? 'client_id';
