-- Allow a student to read their own report row so the /complete page can
-- render the final score, strengths, weaknesses, and recommendations.
-- Lecturer-facing fields (rubric_result, etc.) are returned via the same
-- row; we keep separate lecturer policies for write access in a later phase.

create policy "report_owner_select"
  on public.reports for select
  to authenticated
  using (student_id = auth.uid());
