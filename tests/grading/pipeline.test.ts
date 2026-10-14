import { test } from "node:test";
import assert from "node:assert/strict";
import { CapacityError, DEFAULT_PARAMS, gradeInterview, type ConcurrencyGate } from "../../supabase/functions/_shared/grading/pipeline.ts";
import { createMockProvider, type GradingProvider, type ProviderRequest } from "../../supabase/functions/_shared/grading/provider.ts";
import { MemoryStore } from "./memory-store.ts";
import { buildBundle } from "./fixtures.ts";

function counting(provider: GradingProvider): GradingProvider & { calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  return {
    name: provider.name,
    calls,
    call(req) {
      calls.push(req);
      return provider.call(req);
    },
  };
}

const IID = "11111111-1111-4111-8111-111111111111";
const noQa = { qaSampleRate: 0 };

test("full interview with the mock provider: 5 evaluations + 1 narrative, persisted atomically, no second pass needed", async () => {
  const store = new MemoryStore([buildBundle()]);
  const provider = counting(createMockProvider());
  const r = await gradeInterview(store, IID, { provider, jobId: "job-1", params: noQa });
  assert.equal(r.reused, false);
  assert.equal(r.runNo, 1);
  assert.equal(provider.calls.filter((c) => c.operation === "evaluate").length, 5);
  assert.equal(provider.calls.filter((c) => c.operation === "narrative").length, 1);
  assert.equal(r.final.plannedQuestions, 5);
  assert.equal(r.final.assessedQuestions, 5);
  assert.ok(r.final.overallScore > 60, `good answers score well: ${r.final.overallScore}`);
  assert.equal(r.final.requiresHumanReview, false);
  assert.equal(r.narrativeSource, "model");
  assert.equal(store.persisted.length, 1);
  assert.equal(store.runs[0].status, "succeeded");
  // Rows the SQL layer receives
  const p = store.persisted[0];
  assert.equal(p.answerEvaluationRows.length, 5);
  assert.equal(p.reportRow.status, "ready");
  assert.equal(p.reportRow.rubric_result.overall_score, r.final.overallScore);
  assert.equal(p.reportRow.rubric_result.engine, "v2");
  assert.ok(p.reportRow.evidence.length > 0, "verified quotes land in reports.evidence");
  assert.ok(p.answerEvaluationRows.every((row) => row.evidence_status === "verified"), "mock quotes are verbatim, so every question has verified evidence");
  assert.equal(p.usage.evaluate.calls, 5);
  assert.equal(p.usage.narrative.calls, 1);
});

test("reproducibility: the same input and versions reuse the stored run with zero model calls, and re-persist the same report", async () => {
  const store = new MemoryStore([buildBundle()]);
  const first = counting(createMockProvider());
  const r1 = await gradeInterview(store, IID, { provider: first, params: noQa });
  const second = counting(createMockProvider());
  const r2 = await gradeInterview(store, IID, { provider: second, params: noQa });
  assert.equal(second.calls.length, 0);
  assert.equal(r2.reused, true);
  assert.equal(r2.runId, r1.runId);
  assert.deepEqual(r2.final, r1.final);
  assert.equal(store.persisted.length, 2);
  assert.deepEqual(store.persisted[1].reportRow.rubric_result, store.persisted[0].reportRow.rubric_result);
  // A forced re-run is a new run with fresh calls.
  const third = counting(createMockProvider());
  const r3 = await gradeInterview(store, IID, { provider: third, params: noQa, force: true });
  assert.equal(r3.reused, false);
  assert.equal(r3.runNo, 2);
  assert.equal(third.calls.length, 6);
  // Changing the transcript changes the hash.
  store.bundles.set(IID, buildBundle({ answers: { q1: "משהו אחר לגמרי", q2: null, q3: null, q4: null, q5: null } }));
  const fourth = counting(createMockProvider());
  const r4 = await gradeInterview(store, IID, { provider: fourth, params: noQa });
  assert.notEqual(r4.inputHash, r1.inputHash);
  assert.equal(r4.reused, false);
});

test("skipped / replaced / unanswered questions follow the deterministic policy without model calls for the gaps", async () => {
  const store = new MemoryStore([buildBundle({ skipped: ["q2"], replaced: ["q4"], answers: { q5: null } })]);
  const provider = counting(createMockProvider());
  const r = await gradeInterview(store, IID, { provider, params: noQa });
  assert.equal(provider.calls.filter((c) => c.operation === "evaluate").length, 3, "q1, q3, q4 only");
  assert.deepEqual(r.final.skippedQuestions, [2]);
  assert.deepEqual(r.final.replacedQuestions, [4]);
  assert.equal(r.final.questionScores[1].status, "skipped");
  assert.equal(r.final.questionScores[4].status, "no_answer");
  assert.equal(r.final.questionScores[4].score, 0);
  assert.deepEqual(r.reportRow.rubric_result.skipped_questions, [2]);
  assert.deepEqual(r.reportRow.rubric_result.replaced_questions, [4]);
  const rows = store.persisted[0].answerEvaluationRows;
  assert.equal(rows[1].answer_status, "skipped");
  assert.equal(rows[4].answer_status, "no_answer");
});

test("technical trouble: unanswered questions are excluded, the report is flagged for a human, not scored as ignorance", async () => {
  const store = new MemoryStore([buildBundle({ answers: { q4: null, q5: null }, technicalIssue: true })]);
  const r = await gradeInterview(store, IID, { provider: createMockProvider(), params: noQa });
  assert.deepEqual(r.final.excludedQuestions, [4, 5]);
  assert.equal(r.final.assessedQuestions, 3);
  assert.ok(r.final.reviewReasons.includes("technical_exclusions"));
  assert.ok(!r.final.reviewReasons.includes("low_coverage"), "3/5 = 0.6 is exactly the coverage floor, which passes");
  assert.equal(r.final.coverage, 0.6);
});

test("no usable answers at all: no model calls, score 0, human review, deterministic fallback narrative in the interview language", async () => {
  const store = new MemoryStore([buildBundle({ answers: { q1: null, q2: null, q3: null, q4: null, q5: null } })]);
  const provider = counting(createMockProvider());
  const r = await gradeInterview(store, IID, { provider, params: noQa });
  assert.equal(provider.calls.length, 0);
  assert.equal(r.final.overallScore, 0);
  assert.equal(r.final.confidence, "none");
  assert.equal(r.final.requiresHumanReview, true);
  assert.equal(r.narrativeSource, "fallback");
  assert.match(r.narrative.summary, /המרצה/);
  assert.equal(r.reportRow.overall_level, "low");
});

test("second pass: a material disagreement keeps pass 1 as provisional and flags the question; a small one is averaged", async () => {
  // q2 pass 2 scores everything 0 => disagreement far above the threshold.
  const store = new MemoryStore([buildBundle()]);
  const provider = counting(
    createMockProvider({
      scenario: {
        [`${IID}:q2`]: { confidence: "low" },
        [`${IID}:q2:pass2`]: { scores: { relevance: 0, accuracy: 0, explanation: 0, consistency: 0, process: 0, application: 0 }, answer_status: "incorrect" },
        [`${IID}:q3`]: { confidence: "low" },
        [`${IID}:q3:pass2`]: { scores: { relevance: 4, accuracy: 4, explanation: 4, consistency: 4, process: 4, application: 0 } },
      },
    }),
  );
  const r = await gradeInterview(store, IID, { provider, params: noQa });
  const verifies = provider.calls.filter((c) => c.operation === "verify");
  assert.deepEqual(verifies.map((c) => c.meta?.material?.question.id).sort(), ["q2", "q3"]);
  const q2 = r.evaluations[1];
  assert.deepEqual(q2.outcome.secondPassReasons, ["low_confidence"]);
  assert.ok((q2.outcome.disagreement ?? 0) > DEFAULT_PARAMS.disagreementThreshold);
  assert.equal(q2.outcome.provisional, true);
  assert.equal(q2.outcome.requiresHumanReview, true);
  assert.equal(q2.outcome.questionScore, q2.passes[0].questionScore, "pass 1 kept, never averaged");
  const q3 = r.evaluations[2];
  assert.equal(q3.passes.length, 2);
  assert.equal(q3.outcome.provisional, false);
  assert.ok((q3.outcome.disagreement ?? 99) <= DEFAULT_PARAMS.disagreementThreshold);
  const mean = (q3.passes[0].evaluation.scores.accuracy + q3.passes[1].evaluation.scores.accuracy) / 2;
  assert.equal(q3.outcome.scores.accuracy, mean);
  assert.equal(r.final.requiresHumanReview, true);
  assert.ok(r.final.reviewReasons.includes("pass_disagreement"));
  assert.equal(r.reportRow.rubric_result.requires_human_review, true);
  assert.equal(store.persisted[0].answerEvaluationRows[1].pass_count, 2);
});

test("second pass triggers: unverified evidence with credit, status/score conflicts, near-boundary, QA sample", async () => {
  const store = new MemoryStore([buildBundle()]);
  const provider = counting(
    createMockProvider({
      scenario: {
        [`${IID}:q1`]: { evidence: [{ quote: "this sentence was never said by the student", criterion: "accuracy" }] },
        [`${IID}:q4`]: { answer_status: "correct", errors: ["a contradiction"] },
      },
    }),
  );
  const r = await gradeInterview(store, IID, { provider, params: { qaSampleRate: 1 } });
  const reasons = Object.fromEntries(r.evaluations.map((e) => [e.questionId, e.outcome.secondPassReasons]));
  assert.deepEqual(reasons.q1, ["unverified_evidence"]);
  assert.deepEqual(reasons.q4, ["status_errors_conflict"]);
  assert.ok(Object.values(reasons).some((rs) => rs.includes("qa_sample")), "with a 100% sample rate one clean question is re-checked for drift");
  assert.equal(r.evaluations[0].outcome.evidenceStatus, "verified", "the second pass supplied a verifiable quote, so the union is verified");
});

test("resume: an interrupted run continues from its checkpoint instead of re-evaluating", async () => {
  const store = new MemoryStore([buildBundle()]);
  const failing = createMockProvider({ failCaseIds: [`${IID}:q4`] });
  await assert.rejects(() => gradeInterview(store, IID, { provider: failing, params: noQa }), /mock_failure/);
  assert.equal(store.runs[0].status, "failed");
  assert.equal(store.failures.length, 1);
  assert.ok(store.runs[0].evaluations.length >= 1, "checkpoints kept the completed questions");
  // Simulate a lease-expired worker: the run is still "running" with 4 questions done.
  store.runs[0].status = "running";
  const resumed = counting(createMockProvider());
  const r = await gradeInterview(store, IID, { provider: resumed, params: noQa });
  assert.equal(r.runId, store.runs[0].id);
  assert.equal(resumed.calls.filter((c) => c.operation === "evaluate").length, 1, "only q4 is evaluated");
  assert.equal(store.runs[0].status, "succeeded");
});

test("capacity gate: waits and proceeds when a slot frees up; gives up with CapacityError (run stays resumable) when it never does", async () => {
  const store = new MemoryStore([buildBundle()]);
  let refusals = 0;
  const flaky: ConcurrencyGate = {
    acquire: async () => {
      if (refusals < 3) {
        refusals += 1;
        return { ok: false, retryAfterSeconds: 0 };
      }
      return { ok: true };
    },
    release: async () => {},
  };
  const r = await gradeInterview(store, IID, { provider: createMockProvider(), gate: flaky, params: noQa, sleep: () => Promise.resolve() });
  assert.equal(r.final.assessedQuestions, 5);
  assert.equal(refusals, 3);

  const store2 = new MemoryStore([buildBundle()]);
  const closed: ConcurrencyGate = { acquire: async () => ({ ok: false, retryAfterSeconds: 30 }), release: async () => {} };
  await assert.rejects(
    () => gradeInterview(store2, IID, { provider: createMockProvider(), gate: closed, params: noQa, maxSlotWaitMs: 1, sleep: () => Promise.resolve() }),
    (err: unknown) => err instanceof CapacityError && err.retryAfterSeconds === 30,
  );
  assert.equal(store2.runs[0].status, "running", "a capacity wait is not a failure of the run");
  assert.equal(store2.failures.length, 0);
});

test("a run that lost its lease to a newer run cannot publish", async () => {
  const store = new MemoryStore([buildBundle()]);
  const slow = createMockProvider({ delayMs: 5 });
  const p = gradeInterview(store, IID, { provider: slow, params: noQa });
  while (store.runs.length === 0) await new Promise((r) => setTimeout(r, 1));
  for (const run of store.runs) run.status = "superseded";
  await assert.rejects(p, /persist_refused:superseded/);
});
