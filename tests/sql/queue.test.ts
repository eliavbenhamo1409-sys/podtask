import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { completeInterview, createDb, one, rpc, sampleEvaluationRows, sampleReport, seedInterview } from "./helpers.ts";

let db: PGlite;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db.close();
});

test("migration applies on a clean schema and seeds config + capacity pools", async () => {
  const cfg = await one<{ queue_enabled: boolean; worker_batch: number }>(db, "select queue_enabled, worker_batch from public.grading_config where id = 1");
  assert.equal(cfg.queue_enabled, true);
  const pools = await db.query<{ pool: string; max_concurrent: number }>("select pool, max_concurrent from public.ai_capacity order by pool");
  assert.deepEqual(
    pools.rows.map((p) => p.pool),
    ["evaluate", "narrative", "prepare", "realtime", "verify"],
  );
});

test("outbox trigger: completing an interview queues exactly one job, idempotently", async () => {
  const seed = await seedInterview(db);
  assert.equal((await db.query("select 1 from public.grading_jobs where interview_id = $1", [seed.interviewId])).rows.length, 0);
  await completeInterview(db, seed.interviewId);
  const job = await one<{ status: string; options: { source: string } }>(db, "select status, options from public.grading_jobs where interview_id = $1", [seed.interviewId]);
  assert.equal(job.status, "queued");
  assert.equal(job.options.source, "trigger");
  // A second status write (e.g. the same update replayed) does not add a job.
  await db.query("update public.interviews set status = 'completed' where id = $1", [seed.interviewId]);
  assert.equal((await db.query("select 1 from public.grading_jobs where interview_id = $1", [seed.interviewId])).rows.length, 1);
});

test("outbox trigger respects grading_config.queue_enabled", async () => {
  await db.query("update public.grading_config set queue_enabled = false where id = 1");
  const seed = await seedInterview(db);
  await completeInterview(db, seed.interviewId);
  assert.equal((await db.query("select 1 from public.grading_jobs where interview_id = $1", [seed.interviewId])).rows.length, 0);
  await db.query("update public.grading_config set queue_enabled = true where id = 1");
  // The reconciler picks it up (completed after reconcile_since, older than min age 0).
  const r = await rpc<{ enqueued: number }>(db, "public.reconcile_grading", { p_min_age_seconds: 0 });
  assert.equal(r.enqueued, 1);
});

test("claim: a job is handed to one worker only; a second claim gets nothing until the lease expires", async () => {
  const seed = await seedInterview(db);
  await completeInterview(db, seed.interviewId);
  const first = await db.query<{ id: string; status: string; attempts: number; leased_by: string }>(
    "select id, status, attempts, leased_by from public.claim_grading_jobs($1, 5, $2, 60)",
    ["w1", seed.interviewId],
  );
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].status, "running");
  assert.equal(first.rows[0].attempts, 1);
  assert.equal(first.rows[0].leased_by, "w1");

  const second = await db.query("select id from public.claim_grading_jobs($1, 5, $2, 60)", ["w2", seed.interviewId]);
  assert.equal(second.rows.length, 0, "a running job with a live lease is not re-claimed");

  // Expire the lease (worker crashed): the job becomes claimable again.
  await db.query("update public.grading_jobs set lease_until = now() - interval '1 second' where id = $1", [first.rows[0].id]);
  const third = await db.query<{ leased_by: string; attempts: number }>("select leased_by, attempts from public.claim_grading_jobs($1, 5, $2, 60)", ["w2", seed.interviewId]);
  assert.equal(third.rows.length, 1);
  assert.equal(third.rows[0].leased_by, "w2");
  assert.equal(third.rows[0].attempts, 2);

  // The old worker can no longer extend or fail the job.
  assert.equal(await rpc(db, "public.extend_grading_lease", { p_job_id: first.rows[0].id, p_worker: "w1", p_seconds: 60 }), false);
  assert.equal(await rpc(db, "public.fail_grading_job", { p_job_id: first.rows[0].id, p_worker: "w1", p_error: "late", p_retry_after_seconds: null, p_dead: false }), null);
});

test("fail: exponential backoff, Retry-After override, dead letter at max_attempts", async () => {
  const seed = await seedInterview(db);
  await completeInterview(db, seed.interviewId);
  await db.query("update public.grading_jobs set max_attempts = 3 where interview_id = $1", [seed.interviewId]);

  const claim = async (w: string) => (await db.query<{ id: string }>("select id from public.claim_grading_jobs($1, 1, $2, 60)", [w, seed.interviewId])).rows[0];
  const j1 = await claim("w1");
  assert.ok(j1);
  const s1 = await rpc<string>(db, "public.fail_grading_job", { p_job_id: j1.id, p_worker: "w1", p_error: "openai_responses_500: boom", p_retry_after_seconds: null, p_dead: false });
  assert.equal(s1, "failed");
  const row1 = await one<{ status: string; run_after: Date; last_error: string; leased_by: string | null }>(db, "select status, run_after, last_error, leased_by from public.grading_jobs where id = $1", [j1.id]);
  assert.equal(row1.leased_by, null);
  const delay1 = (row1.run_after.getTime() - Date.now()) / 1000;
  assert.ok(delay1 >= 14 && delay1 <= 23, `first backoff ~15s with jitter, got ${delay1}`);

  // Not claimable before run_after.
  assert.equal((await db.query("select id from public.claim_grading_jobs($1, 1, $2, 60)", ["w1", seed.interviewId])).rows.length, 0);
  await db.query("update public.grading_jobs set run_after = now() where id = $1", [j1.id]);

  const j2 = await claim("w1");
  assert.ok(j2);
  const s2 = await rpc<string>(db, "public.fail_grading_job", { p_job_id: j2.id, p_worker: "w1", p_error: "openai_responses_429", p_retry_after_seconds: 45, p_dead: false });
  assert.equal(s2, "failed");
  const row2 = await one<{ run_after: Date }>(db, "select run_after from public.grading_jobs where id = $1", [j2.id]);
  const delay2 = (row2.run_after.getTime() - Date.now()) / 1000;
  assert.ok(delay2 >= 44 && delay2 <= 46, `Retry-After honoured, got ${delay2}`);
  await db.query("update public.grading_jobs set run_after = now() where id = $1", [j2.id]);

  const j3 = await claim("w1");
  assert.ok(j3);
  const s3 = await rpc<string>(db, "public.fail_grading_job", { p_job_id: j3.id, p_worker: "w1", p_error: "boom", p_retry_after_seconds: null, p_dead: false });
  assert.equal(s3, "dead", "third failure with max_attempts=3 is the dead letter");
  assert.equal((await db.query("select id from public.claim_grading_jobs($1, 1, $2, 60)", ["w1", seed.interviewId])).rows.length, 0);

  // requeue resets a dead job for a manual retry.
  const rq = await rpc<{ requeued: boolean; status: string }>(db, "public.requeue_grading", { p_interview_id: seed.interviewId, p_options: { source: "manual" }, p_priority: 50 });
  assert.equal(rq.requeued, true);
  const row4 = await one<{ status: string; attempts: number; priority: number }>(db, "select status, attempts, priority from public.grading_jobs where interview_id = $1", [seed.interviewId]);
  assert.deepEqual(row4, { status: "queued", attempts: 0, priority: 50 });
});

test("persist_grading_result is atomic and idempotent; a superseded run is refused", async () => {
  const seed = await seedInterview(db);
  await completeInterview(db, seed.interviewId);
  const job = (await db.query<{ id: string }>("select id from public.claim_grading_jobs($1, 1, $2, 60)", ["w1", seed.interviewId])).rows[0];
  const run = await one<{ id: string; run_no: number }>(
    db,
    "select id, run_no from public.create_grading_run($1, $2, $3, 'hash-a', '{\"rubricVersion\":\"v1\"}', '{}', '{}', 'mock')",
    [seed.interviewId, seed.submissionId, job.id],
  );
  assert.equal(run.run_no, 1);
  assert.equal((await one<{ stage: string }>(db, "select stage from public.grading_jobs where id = $1", [job.id])).stage, "evaluating");

  await rpc(db, "public.checkpoint_grading_run", { p_run_id: run.id, p_evaluations: [{ questionId: "q1" }] });

  const res = await rpc<{ ok: boolean; report_id: string }>(db, "public.persist_grading_result", {
    p_run_id: run.id,
    p_job_id: job.id,
    p_worker: "w1",
    p_run: { result: { overallScore: 72 }, narrative: { summary: "s" }, evaluations: [{ questionId: "q1" }], usage: {}, timings: {} },
    p_evaluations: sampleEvaluationRows(seed, run.id),
    p_report: sampleReport(seed, run.id, 72),
  });
  assert.equal(res.ok, true);

  const state = await one<{ job: string; run: string; sub: string; rep: string; evals: number; events: number }>(
    db,
    `select (select status from public.grading_jobs where id = $1) as job,
            (select status from public.grading_runs where id = $2) as run,
            (select status from public.submissions where id = $3) as sub,
            (select status from public.reports where interview_id = $4) as rep,
            (select count(*)::int from public.answer_evaluations where interview_id = $4) as evals,
            (select count(*)::int from public.system_events where event_type = 'report.generated' and payload->>'grading_run_id' = $2::text) as events`,
    [job.id, run.id, seed.submissionId, seed.interviewId],
  );
  assert.deepEqual(state, { job: "done", run: "succeeded", sub: "report_ready", rep: "ready", evals: 1, events: 1 });

  // Replaying the same result (redelivered job) rewrites the same values: still one report, one evaluation row.
  const again = await rpc<{ ok: boolean }>(db, "public.persist_grading_result", {
    p_run_id: run.id,
    p_job_id: job.id,
    p_worker: "w1",
    p_run: { result: { overallScore: 72 }, narrative: { summary: "s" }, evaluations: [{ questionId: "q1" }], usage: {}, timings: {} },
    p_evaluations: sampleEvaluationRows(seed, run.id),
    p_report: sampleReport(seed, run.id, 72),
  });
  assert.equal(again.ok, true);
  assert.equal((await db.query("select 1 from public.reports where interview_id = $1", [seed.interviewId])).rows.length, 1);
  assert.equal((await db.query("select 1 from public.answer_evaluations where interview_id = $1", [seed.interviewId])).rows.length, 1);

  // A re-grade is a NEW run; the old one stays as history and the report moves to the new run.
  const rq = await rpc<{ job_id: string }>(db, "public.requeue_grading", { p_interview_id: seed.interviewId, p_options: { force: true }, p_priority: 100 });
  const job2 = (await db.query<{ id: string }>("select id from public.claim_grading_jobs($1, 1, $2, 60)", ["w2", seed.interviewId])).rows[0];
  assert.equal(job2.id, rq.job_id);
  const run2 = await one<{ id: string; run_no: number }>(
    db,
    "select id, run_no from public.create_grading_run($1, $2, $3, 'hash-b', '{}', '{}', '{}', 'mock')",
    [seed.interviewId, seed.submissionId, job2.id],
  );
  assert.equal(run2.run_no, 2);
  await rpc(db, "public.persist_grading_result", {
    p_run_id: run2.id,
    p_job_id: job2.id,
    p_worker: "w2",
    p_run: { result: { overallScore: 80 }, narrative: { summary: "s2" }, evaluations: [], usage: {}, timings: {} },
    p_evaluations: sampleEvaluationRows(seed, run2.id),
    p_report: sampleReport(seed, run2.id, 80),
  });
  const rep = await one<{ grading_run_id: string; score: number }>(db, "select grading_run_id, (rubric_result->>'overall_score')::int as score from public.reports where interview_id = $1", [seed.interviewId]);
  assert.deepEqual(rep, { grading_run_id: run2.id, score: 80 });
  const runs = await db.query<{ run_no: number; status: string }>("select run_no, status from public.grading_runs where interview_id = $1 order by run_no", [seed.interviewId]);
  assert.deepEqual(runs.rows, [{ run_no: 1, status: "succeeded" }, { run_no: 2, status: "succeeded" }]);

  // A run that is still "running" when a newer run is created is superseded and can no longer publish.
  const job3 = (await db.query<{ id: string }>("select id from public.claim_grading_jobs($1, 1, $2, 60) ", ["w3", seed.interviewId])).rows;
  assert.equal(job3.length, 0, "done job is not claimable");
  await rpc(db, "public.requeue_grading", { p_interview_id: seed.interviewId, p_options: {}, p_priority: 100 });
  const jobA = (await db.query<{ id: string }>("select id from public.claim_grading_jobs($1, 1, $2, 60)", ["wa", seed.interviewId])).rows[0];
  const runA = await one<{ id: string }>(db, "select id from public.create_grading_run($1, $2, $3, 'hash-c', '{}', '{}', '{}', 'mock')", [seed.interviewId, seed.submissionId, jobA.id]);
  const runB = await one<{ id: string }>(db, "select id from public.create_grading_run($1, $2, $3, 'hash-c', '{}', '{}', '{}', 'mock')", [seed.interviewId, seed.submissionId, jobA.id]);
  assert.equal((await one<{ status: string }>(db, "select status from public.grading_runs where id = $1", [runA.id])).status, "superseded");
  const refused = await rpc<{ ok: boolean; reason: string }>(db, "public.persist_grading_result", {
    p_run_id: runA.id,
    p_job_id: jobA.id,
    p_worker: "wa",
    p_run: { result: {}, narrative: {}, evaluations: [], usage: {}, timings: {} },
    p_evaluations: [],
    p_report: sampleReport(seed, runA.id, 10),
  });
  assert.deepEqual(refused, { ok: false, reason: "superseded" });
  assert.equal((await one<{ s: number }>(db, "select (rubric_result->>'overall_score')::int as s from public.reports where interview_id = $1", [seed.interviewId])).s, 80, "the refused run did not touch the report");
  await rpc(db, "public.persist_grading_result", {
    p_run_id: runB.id,
    p_job_id: jobA.id,
    p_worker: "wa",
    p_run: { result: {}, narrative: {}, evaluations: [], usage: {}, timings: {} },
    p_evaluations: [],
    p_report: sampleReport(seed, runB.id, 81),
  });
  assert.equal((await one<{ s: number }>(db, "select (rubric_result->>'overall_score')::int as s from public.reports where interview_id = $1", [seed.interviewId])).s, 81);
});

test("reconcile: completed interviews without a job are queued; done jobs with a missing report are re-queued; old interviews are ignored", async () => {
  // Older than reconcile_since: never touched.
  const old = await seedInterview(db);
  await db.query("update public.grading_config set queue_enabled = false where id = 1");
  await completeInterview(db, old.interviewId);
  await db.query("update public.interviews set completed_at = now() - interval '10 days' where id = $1", [old.interviewId]);
  await db.query("update public.grading_config set queue_enabled = true, reconcile_since = now() - interval '1 day' where id = 1");

  const r1 = await rpc<{ enqueued: number }>(db, "public.reconcile_grading", { p_min_age_seconds: 0 });
  assert.equal(r1.enqueued, 0);

  // Recent, job lost somehow (deleted): reconciled.
  const fresh = await seedInterview(db);
  await completeInterview(db, fresh.interviewId);
  await db.query("delete from public.grading_jobs where interview_id = $1", [fresh.interviewId]);
  const r2 = await rpc<{ enqueued: number }>(db, "public.reconcile_grading", { p_min_age_seconds: 0 });
  assert.equal(r2.enqueued, 1);
  assert.equal((await one<{ src: string }>(db, "select options->>'source' as src from public.grading_jobs where interview_id = $1", [fresh.interviewId])).src, "reconcile");

  // A "done" job whose report vanished is re-queued.
  await db.query("update public.grading_jobs set status = 'done', finished_at = now() - interval '1 hour' where interview_id = $1", [fresh.interviewId]);
  const r3 = await rpc<{ requeued_missing_report: number }>(db, "public.reconcile_grading", { p_min_age_seconds: 0 });
  assert.equal(r3.requeued_missing_report, 1);
  assert.equal((await one<{ status: string }>(db, "select status from public.grading_jobs where interview_id = $1", [fresh.interviewId])).status, "queued");
});

test("grading_status: owner and lecturer can read, strangers cannot, errors are reduced to a code", async () => {
  const seed = await seedInterview(db);
  await completeInterview(db, seed.interviewId);
  await db.query("update public.grading_jobs set status = 'failed', attempts = 2, last_error = 'openai_responses_429: {\"error\": \"rate limited\"}' where interview_id = $1", [seed.interviewId]);

  await db.query(`select set_config('test.uid', '${seed.studentId}', false)`);
  const own = await rpc<{ job: { status: string; error_code: string; attempts: number }; report: unknown }>(db, "public.grading_status", { p_interview_id: seed.interviewId });
  assert.equal(own.job.status, "failed");
  assert.equal(own.job.attempts, 2);
  assert.equal(own.job.error_code, "openai_responses_429");
  assert.equal(own.report, null);

  await db.query("select set_config('test.uid', gen_random_uuid()::text, false)");
  await assert.rejects(() => rpc(db, "public.grading_status", { p_interview_id: seed.interviewId }), /forbidden/);
  await db.query("select set_config('test.lecturer', 'true', false)");
  const asLecturer = await rpc<{ job: { status: string } }>(db, "public.grading_status", { p_interview_id: seed.interviewId });
  assert.equal(asLecturer.job.status, "failed");
  await db.query("select set_config('test.lecturer', 'false', false)");
  await db.query("select set_config('test.uid', '', false)");
});
