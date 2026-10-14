-- Podtask: integrity foundation, part 2 (lockdown). Apply AFTER the web
-- deploy that stops using the student's direct writes (commit "feat:
-- integrity system + lecturer dashboard").
--
--   1. interview_messages: no direct student insert; only the
--      save-interview-message Edge Function (service role) writes rows.
--   2. interview_plans: students read the plan only once the interview is
--      over (the outline RPC serves the room and the lobby before that).
--   3. interviews: a student may only change `language`, and only before the
--      interview starts. Status, timestamps and metadata are server-owned
--      (interview-control / complete-interview).
--   4. submissions: a student may only set the file columns, and only while
--      the submission is still `uploaded`; status is pipeline-owned.

-- ===== 1. Transcript writes ================================================
drop policy if exists "interview_message_owner_insert" on public.interview_messages;

-- ===== 2. Plan visibility ===================================================
drop policy if exists "interview_plan_owner_select" on public.interview_plans;
create policy "interview_plan_owner_select_completed"
  on public.interview_plans for select
  to authenticated
  using (
    interview_id in (
      select id from public.interviews
      where student_id = auth.uid()
        and status in ('completed', 'failed', 'cancelled')
    )
  );

-- ===== 3. Interview updates =================================================
drop policy if exists "interview_owner_update" on public.interviews;
create policy "interview_owner_update_language"
  on public.interviews for update
  to authenticated
  using (student_id = auth.uid() and status in ('created', 'ready'))
  with check (student_id = auth.uid() and status in ('created', 'ready'));

create or replace function private.guard_interview_student_update()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     or current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status
       or new.current_state is distinct from old.current_state
       or new.started_at is distinct from old.started_at
       or new.completed_at is distinct from old.completed_at
       or new.duration_seconds is distinct from old.duration_seconds
       or new.metadata is distinct from old.metadata
       or new.student_id is distinct from old.student_id
       or new.submission_id is distinct from old.submission_id
       or new.assignment_id is distinct from old.assignment_id
       or new.audio_path is distinct from old.audio_path
       or new.transcript_path is distinct from old.transcript_path then
      raise exception 'interview_update_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_interview_student_update on public.interviews;
create trigger guard_interview_student_update
  before update on public.interviews
  for each row execute function private.guard_interview_student_update();

-- ===== 4. Submission updates ===============================================
drop policy if exists "submission_student_update" on public.submissions;
create policy "submission_student_update_file"
  on public.submissions for update
  to authenticated
  using (student_id = auth.uid() and status = 'uploaded')
  with check (student_id = auth.uid() and status = 'uploaded');

drop policy if exists "submission_student_insert" on public.submissions;
create policy "submission_student_insert"
  on public.submissions for insert
  to authenticated
  with check (
    student_id = auth.uid()
    and status = 'uploaded'
    and exists (
      select 1
      from public.assignments a
      where a.id = submissions.assignment_id
        and a.status = 'published'
        and private.is_course_member(a.course_id)
    )
  );

create or replace function private.guard_submission_student_update()
returns trigger
language plpgsql
set search_path = public, private
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     or current_user in ('authenticated', 'anon') then
    if new.status is distinct from old.status
       or new.failure_reason is distinct from old.failure_reason
       or new.student_id is distinct from old.student_id
       or new.assignment_id is distinct from old.assignment_id
       or new.submitted_at is distinct from old.submitted_at then
      raise exception 'submission_update_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_submission_student_update on public.submissions;
create trigger guard_submission_student_update
  before update on public.submissions
  for each row execute function private.guard_submission_student_update();
