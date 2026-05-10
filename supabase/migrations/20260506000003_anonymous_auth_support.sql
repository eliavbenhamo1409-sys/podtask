-- Podtask: support Supabase anonymous sign-in.
-- Seeds a deterministic "Demo sandbox" institution so profiles always have
-- institution_id (required by create_personal_assignment). New institutions
-- trigger private.ensure_personal_course → PERSONAL course row.
--
-- Enable in Supabase Dashboard: Authentication → Anonymous sign-ins.

-- Deterministic demo institution (idempotent).
insert into public.institutions (id, name, slug, settings)
values (
  '00000000-0000-4000-a000-0000000d3170'::uuid,
  'Demo sandbox',
  'podtask-demo-sandbox',
  '{}'::jsonb
)
on conflict (id) do nothing;

-- handle_new_user: tolerate null/empty email (anonymous), default institution.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demo uuid := '00000000-0000-4000-a000-0000000d3170'::uuid;
begin
  insert into public.profiles (id, email, full_name, role, locale, institution_id)
  values (
    new.id,
    coalesce(
      nullif(trim(new.email), ''),
      'anon-' || new.id::text || '@guest.podtask.local'
    ),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      case
        when new.email is null or trim(coalesce(new.email, '')) = ''
        then 'Guest visitor'
        else trim(new.email)
      end
    ),
    'student',
    coalesce(nullif(trim(new.raw_user_meta_data->>'locale'), ''), 'he'),
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'institution_id'), '')::uuid,
      v_demo
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
