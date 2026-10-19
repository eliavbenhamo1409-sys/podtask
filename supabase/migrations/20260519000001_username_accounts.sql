-- Podtask: username accounts, created by an admin (no self sign-up).
--
-- Every student and lecturer gets a username and a password from an admin.
-- Supabase Auth still signs in by e-mail, so each account carries a synthetic
-- auth e-mail `<username>@users.podtask.app` that the login screen derives
-- from the username (lib/auth/username.ts). Nothing is ever sent there.
--
--   1. profiles.username: unique, lower-case, validated format.
--   2. guard_profile_self_update also freezes the username.
--   3. public.admin_create_account(): service role / SQL only. Creates a
--      confirmed auth user + identity, then sets the profile (username, name,
--      role, institution) and the course memberships, in one transaction.
--   4. public.admin_set_password(): service role / SQL only.
--   5. lecturer_add_course_members() accepts usernames as well as e-mails.
--
-- Callers: scripts/create-account.ts (service role key), or the SQL editor.

-- ===== 1. profiles.username ================================================
alter table public.profiles add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$');

create unique index if not exists profiles_username_key on public.profiles (username);

-- ===== 2. Role guard: the username is identity too =========================
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
    if new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.username is distinct from old.username then
      raise exception 'profile_identity_change_forbidden' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ===== 3. Account creation =================================================
-- A readable random password (no 0/O, 1/l/I), ~69 bits.
create or replace function private.random_password(p_length int default 12)
returns text
language sql
volatile
set search_path = public, private, extensions
as $$
  select string_agg(
    substr(a.alphabet, 1 + (get_byte(b.bytes, i) % length(a.alphabet)), 1),
    ''
    order by i
  )
  from (select 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'::text as alphabet) a,
       (select extensions.gen_random_bytes(p_length) as bytes) b,
       generate_series(0, p_length - 1) as i;
$$;
revoke all on function private.random_password(int) from public, anon, authenticated;

-- Returns {user_id, username, role, institution_id, courses, generated_password}.
-- generated_password is set only when p_password is null; it is returned
-- once and stored nowhere (auth keeps a bcrypt hash).
create or replace function public.admin_create_account(
  p_username text,
  p_full_name text,
  p_role public.app_role default 'student',
  p_password text default null,
  p_institution_id uuid default null,
  p_courses text[] default '{}',
  p_locale text default 'he'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_locale text := coalesce(nullif(btrim(p_locale), ''), 'he');
  v_inst uuid := coalesce(p_institution_id, '00000000-0000-4000-a000-0000000d3170'::uuid);
  v_email text;
  v_password text := p_password;
  v_generated text;
  v_uid uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_course text;
  v_course_row public.courses%rowtype;
  v_matches int;
  v_courses jsonb := '[]'::jsonb;
begin
  if v_username !~ '^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$' then
    raise exception 'invalid_username'
      using errcode = '22023',
            hint = '3-32 characters: a-z, 0-9, dot, underscore, hyphen; starts and ends with a letter or digit.';
  end if;
  if p_role is null or p_role not in ('student', 'lecturer') then
    raise exception 'invalid_role' using errcode = '22023', hint = 'student or lecturer';
  end if;
  if v_full_name = '' or length(v_full_name) > 120 then
    raise exception 'invalid_full_name' using errcode = '22023';
  end if;
  if v_locale not in ('he', 'en') then
    raise exception 'invalid_locale' using errcode = '22023', hint = 'he or en';
  end if;
  if not exists (select 1 from public.institutions where id = v_inst) then
    raise exception 'unknown_institution' using errcode = '22023';
  end if;

  v_email := v_username || '@users.podtask.app';
  if exists (select 1 from public.profiles where username = v_username)
     or exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  if v_password is null then
    v_generated := private.random_password(12);
    v_password := v_generated;
  end if;
  -- bcrypt reads at most 72 bytes.
  if length(v_password) < 8 or octet_length(v_password) > 72 then
    raise exception 'invalid_password' using errcode = '22023', hint = '8-72 characters';
  end if;

  -- Same shape GoTrue writes for an admin-created, confirmed e-mail user.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, confirmation_token, recovery_token,
    email_change_token_new, email_change,
    raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000'::uuid, v_uid, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
    v_now, '', '', '', '',
    jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'username', v_username),
    jsonb_build_object(
      'full_name', v_full_name,
      'locale', v_locale,
      'institution_id', v_inst::text,
      'username', v_username
    ),
    v_now, v_now
  );

  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    v_uid::text, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email', null, v_now, v_now
  );

  -- public.handle_new_user created the profile (student, this institution).
  update public.profiles
  set username = v_username,
      full_name = v_full_name,
      role = p_role,
      institution_id = v_inst,
      locale = v_locale
  where id = v_uid;
  if not found then
    raise exception 'profile_not_created';
  end if;

  -- Courses by id or by code within the institution. Lecturers become
  -- course lecturers (private.is_course_lecturer), students are enrolled.
  foreach v_course in array coalesce(p_courses, '{}'::text[]) loop
    v_course := btrim(coalesce(v_course, ''));
    continue when v_course = '';
    if v_course ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into v_course_row from public.courses where id = v_course::uuid;
      v_matches := case when found then 1 else 0 end;
    else
      select count(*) into v_matches
      from public.courses where institution_id = v_inst and lower(code) = lower(v_course);
      select * into v_course_row
      from public.courses where institution_id = v_inst and lower(code) = lower(v_course)
      limit 1;
    end if;
    if v_matches = 0 then
      raise exception 'unknown_course: %', v_course using errcode = '22023';
    elsif v_matches > 1 then
      raise exception 'ambiguous_course_code: %', v_course using errcode = '22023', hint = 'Pass the course id instead.';
    end if;
    if v_course_row.code = 'PERSONAL' then
      raise exception 'personal_course_not_allowed: %', v_course using errcode = '22023';
    end if;
    if v_course_row.institution_id <> v_inst then
      raise exception 'course_in_other_institution: %', v_course using errcode = '22023';
    end if;

    insert into public.course_members (course_id, user_id, role)
    values (
      v_course_row.id, v_uid,
      case when p_role = 'lecturer' then 'lecturer'::public.course_role else 'student'::public.course_role end
    )
    on conflict do nothing;
    v_courses := v_courses || jsonb_build_object(
      'id', v_course_row.id, 'code', v_course_row.code, 'name', v_course_row.name
    );
  end loop;

  return jsonb_build_object(
    'user_id', v_uid,
    'username', v_username,
    'role', p_role,
    'institution_id', v_inst,
    'courses', v_courses,
    'generated_password', v_generated
  );
end;
$$;
revoke all on function public.admin_create_account(text, text, public.app_role, text, uuid, text[], text)
  from public, anon, authenticated;
grant execute on function public.admin_create_account(text, text, public.app_role, text, uuid, text[], text)
  to service_role;

-- ===== 4. Password reset ===================================================
create or replace function public.admin_set_password(
  p_username text,
  p_password text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_uid uuid;
  v_password text := p_password;
  v_generated text;
begin
  select id into v_uid from public.profiles where username = v_username;
  if v_uid is null then
    raise exception 'unknown_username' using errcode = '22023';
  end if;
  if v_password is null then
    v_generated := private.random_password(12);
    v_password := v_generated;
  end if;
  if length(v_password) < 8 or octet_length(v_password) > 72 then
    raise exception 'invalid_password' using errcode = '22023', hint = '8-72 characters';
  end if;
  update auth.users
  set encrypted_password = extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
      updated_at = now()
  where id = v_uid;
  return jsonb_build_object('username', v_username, 'generated_password', v_generated);
end;
$$;
revoke all on function public.admin_set_password(text, text) from public, anon, authenticated;
grant execute on function public.admin_set_password(text, text) to service_role;

-- ===== 5. Enrol by username or e-mail ======================================
-- Same contract as before (p_emails keeps its name so the client call does
-- not change); an entry without "@" is matched against profiles.username.
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
    v_profile_id := null;
    if position('@' in v_norm) > 0 then
      select p.id into v_profile_id
      from public.profiles p
      where lower(p.email) = v_norm and p.role = 'student'
      limit 1;
    else
      select p.id into v_profile_id
      from public.profiles p
      where p.username = v_norm and p.role = 'student'
      limit 1;
    end if;
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
