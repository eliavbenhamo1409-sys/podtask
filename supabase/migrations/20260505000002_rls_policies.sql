-- Podtask: RLS policies (spec section 10).
-- Student is the only authenticated role today; lecturer/admin policies are deferred.

-- private.is_course_member: O(1) check used by assignments + courses policies.
create or replace function private.is_course_member(target_course_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
security definer
stable
set search_path = public, private
as $$
  select exists (
    select 1
    from public.course_members cm
    where cm.course_id = target_course_id
      and cm.user_id = target_user_id
  );
$$;

revoke all on function private.is_course_member(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_course_member(uuid, uuid) to authenticated, service_role;

-- Enable RLS on every public table.
alter table public.institutions enable row level security;
alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.course_members enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.document_parses enable row level security;
alter table public.document_chunks enable row level security;
alter table public.document_analyses enable row level security;
alter table public.interviews enable row level security;
alter table public.interview_plans enable row level security;
alter table public.interview_messages enable row level security;
alter table public.answer_evaluations enable row level security;
alter table public.reports enable row level security;
alter table public.system_events enable row level security;
alter table public.ai_usage_logs enable row level security;
alter table public.rate_limit_events enable row level security;

-- ===== Profiles =====
create policy "profile_self_select"
  on public.profiles for select
  to authenticated
  using (id = auth.uid());

create policy "profile_self_update"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ===== Institutions =====
-- Student can read their own institution.
create policy "institution_member_select"
  on public.institutions for select
  to authenticated
  using (
    id in (select institution_id from public.profiles where id = auth.uid())
  );

-- ===== Courses =====
create policy "course_member_select"
  on public.courses for select
  to authenticated
  using (private.is_course_member(id));

-- ===== Course members =====
create policy "course_member_self_select"
  on public.course_members for select
  to authenticated
  using (user_id = auth.uid());

-- ===== Assignments =====
-- Students see only `published` assignments in courses they belong to.
create policy "assignment_student_select"
  on public.assignments for select
  to authenticated
  using (
    status = 'published'
    and private.is_course_member(course_id)
  );

-- ===== Submissions =====
create policy "submission_student_select"
  on public.submissions for select
  to authenticated
  using (student_id = auth.uid());

create policy "submission_student_insert"
  on public.submissions for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and exists (
      select 1
      from public.assignments a
      where a.id = submissions.assignment_id
        and a.status = 'published'
        and private.is_course_member(a.course_id)
    )
  );

create policy "submission_student_update"
  on public.submissions for update
  to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ===== Document parses / chunks / analyses =====
create policy "document_parse_owner_select"
  on public.document_parses for select
  to authenticated
  using (
    submission_id in (select id from public.submissions where student_id = auth.uid())
  );

create policy "document_chunk_owner_select"
  on public.document_chunks for select
  to authenticated
  using (
    submission_id in (select id from public.submissions where student_id = auth.uid())
  );

create policy "document_analysis_owner_select"
  on public.document_analyses for select
  to authenticated
  using (
    submission_id in (select id from public.submissions where student_id = auth.uid())
  );

-- ===== Interviews =====
create policy "interview_owner_select"
  on public.interviews for select
  to authenticated
  using (student_id = auth.uid());

create policy "interview_owner_update"
  on public.interviews for update
  to authenticated
  using (student_id = auth.uid())
  with check (student_id = auth.uid());

-- ===== Interview plans =====
create policy "interview_plan_owner_select"
  on public.interview_plans for select
  to authenticated
  using (
    interview_id in (select id from public.interviews where student_id = auth.uid())
  );

-- ===== Interview messages =====
create policy "interview_message_owner_select"
  on public.interview_messages for select
  to authenticated
  using (
    interview_id in (select id from public.interviews where student_id = auth.uid())
  );

create policy "interview_message_owner_insert"
  on public.interview_messages for insert
  to authenticated
  with check (
    interview_id in (select id from public.interviews where student_id = auth.uid())
  );

-- ===== Answer evaluations =====
-- Student-visible only via lecturer policies later; for now no authenticated SELECT.
-- (No policy ⇒ no rows.)

-- ===== Reports =====
-- Spec: "Student does not see lecturer reports by default" — no policy.

-- ===== System tables =====
-- system_events / ai_usage_logs / rate_limit_events have NO authenticated policies.
-- They are written and read by Edge Functions using the service-role key only.
