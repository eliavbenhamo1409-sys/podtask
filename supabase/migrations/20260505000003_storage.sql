-- Podtask: storage buckets + policies (spec section 9).
-- All buckets are private except `avatars` (which is publicly readable, owner-writable).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('assignment-files', 'assignment-files', false, 26214400, array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword','text/plain']),
  ('interview-audio',  'interview-audio',  false, null, null),
  ('transcripts',      'transcripts',      false, null, array['application/json','text/plain']),
  ('report-pdfs',      'report-pdfs',      false, null, array['application/pdf']),
  ('avatars',          'avatars',          true,  5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Helper: a user owns a path if it lives under .../submissions/<submissionId>/...
-- where the submission belongs to that user, or the avatar path matches their profile id.
-- For MVP we keep policies pragmatic: require the path to start with their auth.uid().

-- assignment-files: path begins with `submissions/<submissionId>/...` — we let the student
-- read/write only files for submissions they own.
create policy "assignment_files_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'assignment-files'
    and (
      (storage.foldername(name))[1] = 'submissions'
      and exists (
        select 1 from public.submissions s
        where s.id::text = (storage.foldername(name))[2]
          and s.student_id = auth.uid()
      )
    )
  );

create policy "assignment_files_owner_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = 'submissions'
    and exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.student_id = auth.uid()
    )
  );

create policy "assignment_files_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'assignment-files'
    and (storage.foldername(name))[1] = 'submissions'
    and exists (
      select 1 from public.submissions s
      where s.id::text = (storage.foldername(name))[2]
        and s.student_id = auth.uid()
    )
  );

-- interview-audio: paths begin with `interviews/<interviewId>/...`
create policy "interview_audio_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'interview-audio'
    and (storage.foldername(name))[1] = 'interviews'
    and exists (
      select 1 from public.interviews i
      where i.id::text = (storage.foldername(name))[2]
        and i.student_id = auth.uid()
    )
  );

create policy "interview_audio_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'interview-audio'
    and (storage.foldername(name))[1] = 'interviews'
    and exists (
      select 1 from public.interviews i
      where i.id::text = (storage.foldername(name))[2]
        and i.student_id = auth.uid()
    )
  );

-- transcripts + report-pdfs: read-only for owner, writes go through service-role only.
create policy "transcripts_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'transcripts'
    and (storage.foldername(name))[1] = 'interviews'
    and exists (
      select 1 from public.interviews i
      where i.id::text = (storage.foldername(name))[2]
        and i.student_id = auth.uid()
    )
  );

create policy "report_pdfs_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'report-pdfs'
    and (storage.foldername(name))[1] = 'reports'
    and exists (
      select 1 from public.reports r
      where r.id::text = (storage.foldername(name))[2]
        and r.student_id = auth.uid()
    )
  );

-- avatars: public read, owner write at top-level path = auth.uid().
create policy "avatars_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

create policy "avatars_owner_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
