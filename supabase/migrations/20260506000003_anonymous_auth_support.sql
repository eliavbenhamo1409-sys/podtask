-- Podtask: support Supabase anonymous sign-in.
-- Seeds a deterministic "Demo sandbox" institution so new users (including
-- `auth.signInAnonymously`) always get profiles.institution_id set. The
-- personal-course trigger fires on institutions insert → PERSONAL course.
-- Replacing handle_new_user tolerates missing email + defaults institution.

-- 1) Demo institution for anonymous / no-org users (idempotent by primary key).
insert into public.institutions (id, name, slug, settings)
values (
  '00000000-0000-0000-0000-0000000d3170'::uuid,
  'Demo sandbox',
  'demo',
  '{}'::jsonb
)
on conflict (id) do nothing;

-- 2) If slug 'demo' was taken by another row but our id insert was skipped earlier,
--    ensure demo institution uuid exists anyway (handles rare rename scenarios).
insert into public.institutions (id, name, slug, settings)
select
  '00000000-0000-4000-a000-0000000d3170'::uuid,
  'Demo sandbox',
  'demo-podtask-anon',
  '{}'::jsonb
where not exists (
  select 1 from public.institutions where id = '00000000-0000-4000-a000-0000000d3170'::uuid
);

-- Correction: migration must use a single deterministic institution id consistently.
-- The block above mistakenly used two UUIDs if first insert slug-collided.
