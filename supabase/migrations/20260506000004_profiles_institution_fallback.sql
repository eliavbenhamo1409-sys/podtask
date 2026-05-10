-- Fix no_institution_for_user: backfill profiles and make create_personal_assignment
-- resilient when institution_id was never set (pre-anon migration users, edge cases).

-- Same demo sandbox id as anonymous_auth_support migration.
-- Idempotent institution row so FK from profiles.course_members chains stay valid.

insert into public.institutions (id, name, slug, settings)
values (
  '00000000-0000-4000-a000-0000000d3170'::uuid,
  'Demo sandbox',
  'podtask-demo-sandbox',
  '{}'::jsonb
)
on conflict (id) do nothing;

-- One-time patch for any profile missing an institution (real + anonymous users).
update public.profiles
set institution_id = '00000000-0000-4000-a000-0000000d3170'::uuid,
    updated_at = now()
where institution_id is null;

-- Ensure Personal course enrollment for patched users (not always fired by triggers).
insert into public.course_members (course_id, user_id, role)
select c.id, p.id, 'student'::public.course_role
from public.profiles p
join public.courses c
  on c.institution_id = '00000000-0000-4000-a000-0000000d3170'::uuid
 and c.code = 'PERSONAL'
where p.institution_id = '00000000-0000-4000-a000-0000000d3170'::uuid
on conflict do nothing;

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
  v_demo uuid := '00000000-0000-4000-a000-0000000d3170'::uuid;
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
  from public.profiles
  where id = v_user_id;

  if not found then
    raise exception 'no_profile_for_user';
  end if;

  -- Default to demo sandbox; persist so dashboards / RLS stay consistent.
  if v_institution_id is null then
    v_institution_id := v_demo;
    update public.profiles
    set institution_id = v_demo,
        updated_at = now()
    where id = v_user_id and institution_id is null;
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
