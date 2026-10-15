-- Podtask: grading queue scheduler (Supabase only: pg_cron + pg_net + Vault).
--
-- Every 10 s `private.grading_tick('tick')` checks for claimable jobs and,
-- only when there are some, POSTs to the `grading-worker` edge function,
-- fanning out several requests when the backlog is large (the `worker`
-- capacity pool bounds how many actually run). Every 5 min the reconciler
-- runs first.
--
-- Authentication: the worker accepts either the exact service-role key
-- (the kick from complete-interview) or the `x-grading-token` header, a
-- random token generated HERE and kept in Vault (`grading_worker_token`);
-- the worker checks it through `check_grading_worker_token`. The token never
-- leaves the database except in the request to the worker.
--
-- One-time setup by the owner / deployer (the URL is project specific):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- Until it exists the tick is a no-op that reports `vault_secrets_missing`.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Worker token: created once, never overwritten.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'grading_worker_token') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'grading_worker_token',
      'Shared secret between pg_cron (grading_tick) and the grading-worker edge function.'
    );
  end if;
end;
$$;

create or replace function public.check_grading_worker_token(p_token text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_secret text;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'grading_worker_token';
  return v_secret is not null and v_secret = p_token;
end;
$$;
revoke all on function public.check_grading_worker_token(text) from public, anon, authenticated;
grant execute on function public.check_grading_worker_token(text) to service_role;

create or replace function private.grading_tick(p_mode text default 'tick')
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_url text;
  v_token text;
  v_pending integer;
  v_batch integer;
  v_fanout integer;
  v_reconcile jsonb := null;
  v_i integer;
begin
  if p_mode = 'reconcile' then
    v_reconcile := public.reconcile_grading(120);
  end if;

  select count(*) into v_pending
  from public.grading_jobs
  where (status in ('queued', 'failed') and run_after <= now() and attempts < max_attempts)
     or (status = 'running' and lease_until < now());
  if v_pending = 0 then
    return jsonb_build_object('pending', 0, 'reconcile', v_reconcile);
  end if;

  select worker_batch into v_batch from public.grading_config where id = 1;
  v_batch := greatest(1, coalesce(v_batch, 2));

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'grading_worker_token';
  if v_url is null or v_token is null then
    return jsonb_build_object('pending', v_pending, 'error', 'vault_secrets_missing', 'reconcile', v_reconcile);
  end if;

  v_fanout := least(8, ceil(v_pending::numeric / v_batch)::integer);
  for v_i in 1..v_fanout loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/grading-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-grading-token', v_token
      ),
      body := jsonb_build_object('mode', 'tick', 'limit', v_batch, 'pending', v_pending, 'slot', v_i),
      timeout_milliseconds := 15000
    );
  end loop;

  return jsonb_build_object('pending', v_pending, 'fanout', v_fanout, 'reconcile', v_reconcile);
end;
$$;

revoke all on function private.grading_tick(text) from public, anon, authenticated;

-- Idempotent scheduling: unschedule first so re-applying never duplicates jobs.
do $$
declare
  v_id bigint;
begin
  for v_id in select jobid from cron.job where jobname in ('grading-worker-tick', 'grading-reconcile') loop
    perform cron.unschedule(v_id);
  end loop;
end;
$$;

select cron.schedule('grading-worker-tick', '10 seconds', $$select private.grading_tick('tick')$$);
select cron.schedule('grading-reconcile', '*/5 * * * *', $$select private.grading_tick('reconcile')$$);
