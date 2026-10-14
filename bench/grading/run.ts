/**
 * Grading benchmark runner.
 *
 *   node bench/grading/run.ts --provider mock --repeats 3
 *   OPENAI_API_KEY=sk-... node bench/grading/run.ts --provider openai --models gpt-4.1,gpt-4.1-mini --repeats 3 --budget-usd 3
 *   OPENAI_API_KEY=sk-... node bench/grading/run.ts --probe              # print the org's rate-limit headers, one tiny call
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
 *     node bench/grading/run.ts --provider openai --human bench/grading/dataset/human/ratings.jsonl
 *
 * Every case is graded through the REAL pipeline (`gradeInterview`) with an
 * in-memory store, so prompt, evidence verification, second pass and scoring
 * are exactly what production runs. Results land in `bench/results/`.
 *
 * Mock mode exercises the harness and the deterministic parts (markers,
 * policies, variance = 0 by construction); it says nothing about model
 * accuracy. The synthetic bands are policy expectations, not ground truth.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gradeInterview, type GradingStore, type NewRun, type PersistArgs, type StoredRun } from "../../supabase/functions/_shared/grading/pipeline.ts";
import { createMockProvider, createOpenAIProvider, type GradingProvider } from "../../supabase/functions/_shared/grading/provider.ts";
import { PROMPT_VERSION } from "../../supabase/functions/_shared/grading/prompt.ts";
import { RUBRIC_VERSION } from "../../supabase/functions/_shared/grading/rubric.ts";
import { SCORING_VERSION } from "../../supabase/functions/_shared/grading/score.ts";
import type { InterviewBundle, QuestionEvaluation, TranscriptRow } from "../../supabase/functions/_shared/grading/types.ts";
import { CASES, type BenchCase, type HumanRating } from "./dataset.ts";
import { flipRate, icc2_1, mae, mean, percentile, round, stddev } from "./metrics.ts";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(a.slice(2), next);
    i += 1;
  } else args.set(a.slice(2), "true");
}
const providerName = args.get("provider") ?? "mock";
const repeats = Number(args.get("repeats") ?? 3);
const models = (args.get("models") ?? (providerName === "mock" ? "mock" : "gpt-4.1,gpt-4.1-mini")).split(",").map((m) => m.trim()).filter(Boolean);
const caseFilter = args.get("cases")?.split(",").map((s) => s.trim());
const outDir = resolve(args.get("out") ?? "bench/results");
const budgetUsd = Number(args.get("budget-usd") ?? 2);
const yes = args.get("yes") === "true";
const probe = args.get("probe") === "true";
const humanPath = args.get("human");
const apiKey = process.env.OPENAI_API_KEY ?? "";

// ---------------------------------------------------------------------------
// Minimal in-memory store (same contract as the SQL RPCs)
// ---------------------------------------------------------------------------
class BenchStore implements GradingStore {
  runs: Array<StoredRun & { interviewId: string }> = [];
  persisted: PersistArgs[] = [];
  private bundle: InterviewBundle;
  constructor(bundle: InterviewBundle) {
    this.bundle = bundle;
  }
  loadBundle(id: string) {
    return Promise.resolve(id === this.bundle.interviewId ? this.bundle : null);
  }
  findReusableRun() {
    return Promise.resolve(null);
  }
  findResumableRun() {
    return Promise.resolve(null);
  }
  createRun(run: NewRun) {
    const runNo = this.runs.length + 1;
    const id = `bench-${runNo}`;
    this.runs.push({ id, runNo, status: "running", inputHash: run.inputHash, evaluations: [], result: null, narrative: null, interviewId: run.interviewId });
    return Promise.resolve({ id, runNo });
  }
  checkpoint() {
    return Promise.resolve();
  }
  persistResult(a: PersistArgs) {
    this.persisted.push(a);
    return Promise.resolve();
  }
  failRun() {
    return Promise.resolve();
  }
}

function bundleFor(c: BenchCase, runIndex: number): InterviewBundle {
  const interviewId = `bench-${c.id}-${runIndex}`.padEnd(36, "0").slice(0, 36);
  const rows: TranscriptRow[] = [];
  let t = Date.parse("2026-10-14T10:00:00Z");
  const push = (row: Omit<TranscriptRow, "id" | "created_at">) => {
    t += 5000;
    rows.push({ id: `m${rows.length + 1}`, created_at: new Date(t).toISOString(), ...row });
  };
  push({ speaker: "ai_host", message_type: "question", content: c.question.question, plan_question_id: "q1", metadata: {} });
  if (c.skipped) push({ speaker: "system", message_type: "system", content: "skipped_question:1", plan_question_id: "q1", metadata: {} });
  c.studentTurns.forEach((turn, i) => {
    if (i > 0 && c.hostFollowUps?.[i - 1]) {
      push({ speaker: "ai_host", message_type: "question", content: c.hostFollowUps[i - 1], plan_question_id: "q1", metadata: {} });
    }
    push({ speaker: "student", message_type: "answer", content: turn, plan_question_id: "q1", metadata: { source: "client" } });
  });
  return {
    interviewId,
    submissionId: "bench-submission",
    assignmentId: "bench-assignment",
    studentId: "bench-student",
    language: c.language,
    assignmentTitle: c.language === "he" ? "תמחור פחמן והשפעתו החלוקתית" : "Carbon pricing and its distributional effect",
    analysis: {
      summary: c.language === "he" ? "השוואה בין מס פחמן למערכת מסחר בפליטות ובחינת ההשפעה החלוקתית." : "A comparison of a carbon tax and cap-and-trade and their distributional effect.",
      mainArgument: c.language === "he" ? "מס פחמן עם החזר אחיד הוא פרוגרסיבי; מסחר ללא פיצוי רגרסיבי." : "A carbon tax with a uniform rebate is progressive; uncompensated cap-and-trade is regressive.",
      keyConcepts: [],
      claims: [],
    },
    plan: [{ id: "q1", index: 0, kind: c.kind, ...c.question }],
    messages: rows,
    chunks: c.chunks,
    technical: { disconnects: c.technicalIssue ? 1 : 0, resumes: 0, mintFailures: 0, technicalIssue: !!c.technicalIssue },
  };
}

interface CaseRun {
  caseId: string;
  model: string;
  run: number;
  score: number | null;
  scoreStatus: string;
  status: string;
  evidenceStatus: string;
  quotes: number;
  unverifiedQuotes: number;
  confidence: string;
  passes: number;
  secondPassReasons: string[];
  requiresHumanReview: boolean;
  lowCriteriaOk: boolean | null;
  inBand: boolean | null;
  bandError: number | null;
  statusMatch: boolean;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  rationale: string;
}

function evaluateCase(c: BenchCase, ev: QuestionEvaluation, scoreStatus: string): Pick<CaseRun, "inBand" | "bandError" | "statusMatch" | "lowCriteriaOk"> {
  const o = ev.outcome;
  const band = c.expected.scoreBand;
  const score = ev.coverage === "answered" ? o.questionScore : null;
  let inBand: boolean | null = null;
  let bandError: number | null = null;
  if (band) {
    if (score === null) {
      inBand = false;
      bandError = (band[0] + band[1]) / 2;
    } else {
      inBand = score >= band[0] && score <= band[1];
      bandError = score < band[0] ? band[0] - score : score > band[1] ? score - band[1] : 0;
    }
  } else {
    inBand = score === null;
    bandError = score === null ? 0 : score;
  }
  const observedStatus = ev.coverage === "answered" ? o.status : ev.coverage === "skipped" ? "skipped" : "no_answer";
  const statusMatch = observedStatus === c.expected.status || (c.expected.status === "unassessable" && scoreStatus === "excluded_unassessable");
  let lowCriteriaOk: boolean | null = null;
  if (c.expected.lowCriteria?.length && ev.coverage === "answered") {
    lowCriteriaOk = c.expected.lowCriteria.every((k) => (o.scores[k] ?? 0) <= 2);
  }
  return { inBand, bandError, statusMatch, lowCriteriaOk };
}

async function runCase(c: BenchCase, provider: GradingProvider, model: string, runIndex: number): Promise<CaseRun> {
  const bundle = bundleFor(c, runIndex);
  const store = new BenchStore(bundle);
  const started = Date.now();
  const r = await gradeInterview(store, bundle.interviewId, {
    provider,
    models: { evaluate: model, verify: model, narrative: model },
    params: { qaSampleRate: 0 },
    force: true,
    qaSalt: `${c.id}:${runIndex}`,
  });
  const ev = r.evaluations[0];
  const scoreStatus = r.final.questionScores[0].status;
  const usage = Object.values(r.usage).reduce(
    (acc, u) => ({ cost: acc.cost + u.estimatedCostUsd, inTok: acc.inTok + u.inputTokens, outTok: acc.outTok + u.outputTokens }),
    { cost: 0, inTok: 0, outTok: 0 },
  );
  const quotes = ev.outcome.verifiedEvidence.length;
  return {
    caseId: c.id,
    model,
    run: runIndex,
    score: ev.coverage === "answered" ? ev.outcome.questionScore : null,
    scoreStatus,
    status: ev.coverage === "answered" ? ev.outcome.status : ev.coverage,
    evidenceStatus: ev.outcome.evidenceStatus,
    quotes,
    unverifiedQuotes: ev.outcome.verifiedEvidence.filter((v) => !v.verified).length,
    confidence: ev.outcome.confidence,
    passes: ev.passes.length,
    secondPassReasons: ev.outcome.secondPassReasons,
    requiresHumanReview: r.final.requiresHumanReview,
    ...evaluateCase(c, ev, scoreStatus),
    latencyMs: Date.now() - started,
    costUsd: usage.cost,
    inputTokens: usage.inTok,
    outputTokens: usage.outTok,
    rationale: ev.outcome.rationale.slice(0, 300),
  };
}

interface ModelSummary {
  model: string;
  cases: number;
  runs: number;
  inBandRate: number;
  bandMae: number;
  statusMatchRate: number;
  lowCriteriaRate: number | null;
  invalidEvidenceRate: number;
  noEvidenceRate: number;
  humanReviewRate: number;
  secondPassRate: number;
  repeatStddevMean: number;
  repeatIcc: number | null;
  flipRate50: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  costPerEvaluationUsd: number;
  costPerInterviewUsd: number;
  tokensPerEvaluation: { input: number; output: number };
}

function summarise(model: string, runs: CaseRun[], cases: BenchCase[]): ModelSummary {
  const banded = runs.filter((r) => r.inBand !== null);
  const lowC = runs.filter((r) => r.lowCriteriaOk !== null);
  const withQuotes = runs.filter((r) => r.quotes > 0);
  const answered = runs.filter((r) => r.score !== null);
  const perCase = new Map<string, number[]>();
  for (const r of runs) {
    if (r.score === null) continue;
    perCase.set(r.caseId, [...(perCase.get(r.caseId) ?? []), r.score]);
  }
  const repeatSeries = [...perCase.values()].filter((xs) => xs.length === repeats && repeats > 1);
  const totalCost = runs.reduce((s, r) => s + r.costUsd, 0);
  return {
    model,
    cases: cases.length,
    runs: runs.length,
    inBandRate: round(mean(banded.map((r) => (r.inBand ? 1 : 0))), 3),
    bandMae: round(mean(banded.map((r) => r.bandError ?? 0)), 2),
    statusMatchRate: round(mean(runs.map((r) => (r.statusMatch ? 1 : 0))), 3),
    lowCriteriaRate: lowC.length ? round(mean(lowC.map((r) => (r.lowCriteriaOk ? 1 : 0))), 3) : null,
    invalidEvidenceRate: withQuotes.length ? round(withQuotes.reduce((s, r) => s + r.unverifiedQuotes, 0) / withQuotes.reduce((s, r) => s + r.quotes, 0), 3) : 0,
    noEvidenceRate: answered.length ? round(mean(answered.map((r) => (r.quotes === 0 ? 1 : 0))), 3) : 0,
    humanReviewRate: round(mean(runs.map((r) => (r.requiresHumanReview ? 1 : 0))), 3),
    secondPassRate: answered.length ? round(mean(answered.map((r) => (r.passes > 1 ? 1 : 0))), 3) : 0,
    repeatStddevMean: round(mean(repeatSeries.map(stddev)), 2),
    repeatIcc: repeatSeries.length >= 2 ? round(icc2_1(repeatSeries), 3) : null,
    flipRate50: round(flipRate(repeatSeries, 50), 3),
    latencyP50Ms: Math.round(percentile(runs.map((r) => r.latencyMs), 50)),
    latencyP95Ms: Math.round(percentile(runs.map((r) => r.latencyMs), 95)),
    costPerEvaluationUsd: round(answered.length ? totalCost / answered.length : 0, 5),
    costPerInterviewUsd: round((answered.length ? totalCost / answered.length : 0) * 5 + 0.01, 4),
    tokensPerEvaluation: {
      input: Math.round(mean(answered.map((r) => r.inputTokens)) || 0),
      output: Math.round(mean(answered.map((r) => r.outputTokens)) || 0),
    },
  };
}

function markdown(summaries: ModelSummary[], runs: CaseRun[], meta: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# Grading benchmark (${meta.provider}, rubric ${RUBRIC_VERSION}, prompt ${PROMPT_VERSION}, scoring ${SCORING_VERSION})`);
  lines.push("");
  lines.push(`Date: ${meta.date}. Cases: ${meta.cases}. Repeats: ${meta.repeats}. ${meta.provider === "mock" ? "MOCK provider: harness check only, not an accuracy result." : ""}`);
  lines.push("");
  lines.push("| model | in-band | band MAE | status match | low-criteria ok | invalid evidence | no evidence | human review | 2nd pass | repeat sd | ICC | flip@50 | p50 ms | p95 ms | $/eval | $/interview |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of summaries) {
    lines.push(
      `| ${s.model} | ${s.inBandRate} | ${s.bandMae} | ${s.statusMatchRate} | ${s.lowCriteriaRate ?? "n/a"} | ${s.invalidEvidenceRate} | ${s.noEvidenceRate} | ${s.humanReviewRate} | ${s.secondPassRate} | ${s.repeatStddevMean} | ${s.repeatIcc ?? "n/a"} | ${s.flipRate50} | ${s.latencyP50Ms} | ${s.latencyP95Ms} | ${s.costPerEvaluationUsd} | ${s.costPerInterviewUsd} |`,
    );
  }
  lines.push("");
  lines.push("## Per case (first run of each model)");
  lines.push("");
  lines.push("| case | model | score | status | expected | in band | evidence | passes | review |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of runs.filter((r) => r.run === 0)) {
    const c = CASES.find((x) => x.id === r.caseId)!;
    const exp = c.expected.scoreBand ? `${c.expected.scoreBand[0]}-${c.expected.scoreBand[1]} ${c.expected.status}` : c.expected.status;
    lines.push(`| ${r.caseId} | ${r.model} | ${r.score ?? "n/a"} | ${r.status} | ${exp} | ${r.inBand === null ? "n/a" : r.inBand ? "yes" : "NO"} | ${r.evidenceStatus} (${r.quotes - r.unverifiedQuotes}/${r.quotes}) | ${r.passes}${r.secondPassReasons.length ? ` (${r.secondPassReasons.join(",")})` : ""} | ${r.requiresHumanReview ? "yes" : ""} |`);
  }
  return lines.join("\n") + "\n";
}

async function probeRateLimits(): Promise<void> {
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --probe");
  const provider = createOpenAIProvider({ apiKey, maxRetries: 0 });
  for (const model of models) {
    const res = await provider.call<{ ok: boolean }>({
      operation: "evaluate",
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: "Return {\"ok\": true}." }] }],
      schemaName: "probe",
      schema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
      temperature: 0,
      maxOutputTokens: 20,
    });
    console.log(JSON.stringify({ model: res.model, latencyMs: res.latencyMs, usage: res.usage, rateLimit: res.rateLimit }, null, 2));
  }
}

async function runHuman(path: string): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --human");
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --human");
  const { createClient } = await import("@supabase/supabase-js");
  const { createSupabaseStore } = await import("../../supabase/functions/_shared/grading/store-supabase.ts");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const ratings: HumanRating[] = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const byInterview = new Map<string, HumanRating[]>();
  for (const r of ratings) byInterview.set(r.interviewId, [...(byInterview.get(r.interviewId) ?? []), r]);
  const provider = createOpenAIProvider({ apiKey });
  const out: Array<{ interviewId: string; questionId: string; model: number | null; human: number; raters: number }> = [];
  for (const model of models) {
    const pairs: number[][] = [];
    for (const [interviewId, rs] of byInterview) {
      const store = createSupabaseStore(sb);
      const bundle = await store.loadBundle(interviewId);
      if (!bundle) continue;
      const mem = new BenchStore(bundle);
      const result = await gradeInterview(mem, interviewId, { provider, models: { evaluate: model, verify: model, narrative: model }, params: { qaSampleRate: 0 }, force: true });
      const byQ = new Map<string, number[]>();
      for (const r of rs) byQ.set(r.questionId, [...(byQ.get(r.questionId) ?? []), r.score]);
      for (const [qid, humanScores] of byQ) {
        const ev = result.evaluations.find((e) => e.questionId === qid);
        const m = ev?.outcome.questionScore ?? null;
        const h = mean(humanScores);
        out.push({ interviewId, questionId: qid, model: m, human: h, raters: humanScores.length });
        if (m !== null) pairs.push([m, h]);
      }
    }
    const summary = {
      model,
      questions: pairs.length,
      mae: round(mae(pairs.map((p) => p[0]), pairs.map((p) => p[1])), 2),
      icc: pairs.length >= 2 ? round(icc2_1(pairs), 3) : null,
      passFailAgreement: round(mean(pairs.map((p) => (p[0] >= 50 === p[1] >= 50 ? 1 : 0))), 3),
    };
    console.log(JSON.stringify(summary, null, 2));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, `${new Date().toISOString().slice(0, 10)}-human-${model}.json`), JSON.stringify({ summary, rows: out }, null, 2));
  }
}

async function main(): Promise<void> {
  if (probe) return await probeRateLimits();
  if (humanPath) return await runHuman(humanPath);

  const cases = caseFilter ? CASES.filter((c) => caseFilter.includes(c.id)) : CASES;
  let provider: GradingProvider;
  if (providerName === "mock") {
    provider = createMockProvider({ delayMs: Number(args.get("mock-delay-ms") ?? 0) });
  } else {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for --provider openai");
    // Rough pre-flight: ~2.5k input + 0.5k output tokens per evaluation, second passes included, narrative extra.
    const estimate = cases.length * repeats * models.length * 0.025;
    if (estimate > budgetUsd && !yes) {
      throw new Error(`estimated cost $${estimate.toFixed(2)} exceeds --budget-usd ${budgetUsd}; pass --yes to run anyway`);
    }
    provider = createOpenAIProvider({ apiKey });
  }

  const runs: CaseRun[] = [];
  for (const model of models) {
    for (let i = 0; i < repeats; i++) {
      for (const c of cases) {
        const r = await runCase(c, provider, model, i);
        runs.push(r);
        process.stderr.write(`${model} run ${i + 1}/${repeats} ${c.id}: score=${r.score ?? "n/a"} status=${r.status} inBand=${r.inBand} passes=${r.passes} ${r.latencyMs}ms\n`);
      }
    }
  }
  const summaries = models.map((m) => summarise(m, runs.filter((r) => r.model === m), cases));
  const meta = { date: new Date().toISOString(), provider: providerName, cases: cases.length, repeats, models, versions: { RUBRIC_VERSION, PROMPT_VERSION, SCORING_VERSION } };
  mkdirSync(outDir, { recursive: true });
  const stamp = `${meta.date.slice(0, 10)}-${providerName}`;
  writeFileSync(resolve(outDir, `${stamp}.json`), JSON.stringify({ meta, summaries, runs }, null, 2));
  const md = markdown(summaries, runs, meta);
  writeFileSync(resolve(outDir, `${stamp}.md`), md);
  console.log(md);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
