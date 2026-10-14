-- Podtask: grading queue scheduler (Supabase only: pg_cron + pg_net + Vault).
--
-- Every 10 s `private.grading_tick('tick')` checks for claimable jobs and,
-- only when there are some, POSTs to the `grading-worker` edge function
-- (service-role bearer from Vault), fanning out several requests when the
-- backlog is large. Every 5 min the reconciler runs first.
--
-- One-time setup by the owner (the migration cannot know the values):
--   select vault.create_secret('https://jxlrpewoqikpswxmtdma.supabase.co', 'project_url');
--   select vault.create_secret('<service_role_key>', 'service_role_key');
-- Until both secrets exist the tick is a no-op that reports
-- `vault_secrets_missing`; the worker can still be invoked by hand.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function private.grading_tick(p_mode text default 'tick')
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_url text;
  v_key text;
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
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    return jsonb_build_object('pending', v_pending, 'error', 'vault_secrets_missing', 'reconcile', v_reconcile);
  end if;

  v_fanout := least(8, ceil(v_pending::numeric / v_batch)::integer);
  for v_i in 1..v_fanout loop
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/grading-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('mode', 'tick', 'limit', v_batch, 'pending', v_pending, 'slot', v_i),
      timeout_milliseconds := 5000
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
