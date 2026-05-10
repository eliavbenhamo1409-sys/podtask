-- Podtask: per-institution "Personal" course so that self-initiated
-- uploads (the "I want to interview myself" flow) produce real
-- assignment / submission UUIDs instead of synthetic in-memory ids.
--
-- Strategy:
--   * Each institution gets exactly one course with code 'PERSONAL'.
--   * On profile creation / update, the student is auto-enrolled in the
--     personal course of their institution.
--   * `public.create_personal_assignment(title, language)` returns the new
--     assignment id; SECURITY DEFINER so RLS doesn't block the insert.

-- 1) Personal course for every existing institution.
insert into public.courses (institution_id, name, code, semester, lecturer_name)
select
  i.id,
  'Personal',
  'PERSONAL',
  'ongoing',
  'Self-directed'
from public.institutions i
where not exists (
  select 1 from public.courses c
  where c.institution_id = i.id and c.code = 'PERSONAL'
)
on conflict do nothing;

-- 2) Trigger that creates a Personal course whenever a new institution is
-- inserted, so the property holds going forward.
create or replace function private.ensure_personal_course()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.courses (institution_id, name, code, semester, lecturer_name)
  values (new.id, 'Personal', 'PERSONAL', 'ongoing', 'Self-directed')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_personal_course on public.institutions;
create trigger ensure_personal_course
  after insert on public.institutions
  for each row execute function private.ensure_personal_course();

-- 3) Auto-enroll the student in their institution's Personal course.
create or replace function private.ensure_personal_membership()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  personal_course_id uuid;
begin
  if new.institution_id is null then
    return new;
  end if;

  select c.id into personal_course_id
  from public.courses c
  where c.institution_id = new.institution_id
    and c.code = 'PERSONAL'
  limit 1;

  if personal_course_id is null then
    return new;
  end if;

  insert into public.course_members (course_id, user_id, role)
  values (personal_course_id, new.id, 'student')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists ensure_personal_membership_insert on public.profiles;
create trigger ensure_personal_membership_insert
  after insert on public.profiles
  for each row execute function private.ensure_personal_membership();

drop trigger if exists ensure_personal_membership_update on public.profiles;
create trigger ensure_personal_membership_update
  after update of institution_id on public.profiles
  for each row execute function private.ensure_personal_membership();

-- Backfill memberships for any existing profile.
insert into public.course_members (course_id, user_id, role)
select c.id, p.id, 'student'
from public.profiles p
join public.courses c
  on c.institution_id = p.institution_id and c.code = 'PERSONAL'
on conflict do nothing;

-- 4) RPC: create a published "personal" assignment for the calling user.
-- Returns the assignment id; the student is already enrolled (above) so
-- the existing submissions RLS policy will accept submissions against it.
create or replace function public.create_personal_assignment(
  p_title text,
  p_language text default 'he'
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_user_id uuid := auth.uid();
  v_institution_id uuid;
  v_course_id uuid;
  v_assignment_id uuid;
  v_lang text := coalesce(nullif(p_language, ''), 'he');
  v_title text := coalesce(nullif(btrim(p_title), ''),
                           case when v_lang = 'he' then 'משימה יזומה' else 'Personal task' end);
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  select institution_id into v_institution_id
  from public.profiles where id = v_user_id;
  if v_institution_id is null then
    raise exception 'no_institution_for_user';
  end if;

  select id into v_course_id
  from public.courses
  where institution_id = v_institution_id and code = 'PERSONAL'
  limit 1;
  if v_course_id is null then
    raise exception 'personal_course_missing';
  end if;

  insert into public.course_members (course_id, user_id, role)
  values (v_course_id, v_user_id, 'student')
  on conflict do nothing;

  insert into public.assignments (
    course_id, title, description, instructions, status, language, interview_duration_minutes
  ) values (
    v_course_id,
    v_title,
    null,
    null,
    'published',
    v_lang,
    12
  )
  returning id into v_assignment_id;

  return v_assignment_id;
end;
$$;

revoke all on function public.create_personal_assignment(text, text) from public, anon;
grant execute on function public.create_personal_assignment(text, text) to authenticated;
