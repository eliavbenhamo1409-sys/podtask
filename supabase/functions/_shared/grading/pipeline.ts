/**
 * The grading pipeline: one interview in, one persisted grading run out.
 *
 *   1. load the bundle (plan, transcript, analysis, chunks, technical signals)
 *   2. build per-question material and the input hash
 *   3. reuse a succeeded run with the same hash + versions + models
 *      (reproducibility: same input, same stored result, no model call)
 *      or resume a run that was interrupted mid-way (checkpointed evaluations)
 *   4. evaluate every answered question (pass 1), verify evidence, score
 *   5. selective, independent second pass; material disagreement -> human review
 *   6. compute the final score (pure), write the narrative (explains only)
 *   7. persist atomically through the store
 *
 * The pipeline knows nothing about Supabase or Deno: it talks to a
 * `GradingStore`, a `GradingProvider` and a `ConcurrencyGate`.
 */
import { selectPassages, type SelectedPassage } from "./context.ts";
import { estimateCostUsd } from "./cost.ts";
import { verifyEvidence } from "./evidence.ts";
import { fnv1a, hashInput } from "./hash.ts";
import {
  EVALUATION_SCHEMA,
  NARRATIVE_SCHEMA,
  PROMPT_VERSION,
  buildEvaluationMessages,
  buildNarrativeMessages,
  fallbackNarrative,
} from "./prompt.ts";
import type { GradingProvider, ProviderResponse } from "./provider.ts";
import { ProviderError } from "./provider.ts";
import { RUBRIC_VERSION, applicableCriteria, levelForScore } from "./rubric.ts";
import { buildAnswerEvaluationRows, buildReportRow, type AnswerEvaluationRow, type ReportRow } from "./rows.ts";
import {
  SCORING_VERSION,
  calculateFinalScore,
  isBoundarySensitive,
  questionScoreFromCriteria,
} from "./score.ts";
import { buildMaterial, type TranscriptMaterial } from "./transcript.ts";
import type {
  Confidence,
  Criterion,
  EvidenceStatus,
  FinalScore,
  GradingModels,
  GradingParams,
  GradingVersions,
  InterviewBundle,
  ModelEvaluation,
  Narrative,
  PassResult,
  QuestionEvaluation,
  QuestionMaterial,
  QuestionOutcome,
  ScoreInput,
  StageUsage,
  Usage,
} from "./types.ts";

export const DEFAULT_MODELS: GradingModels = {
  evaluate: "gpt-4.1",
  verify: "gpt-4.1",
  narrative: "gpt-4.1-mini",
};

export const DEFAULT_PARAMS: GradingParams = {
  temperature: 0,
  boundaryDelta: 10,
  disagreementThreshold: 20,
  qaSampleRate: 0.1,
};

export const VERSIONS: GradingVersions = {
  rubricVersion: RUBRIC_VERSION,
  promptVersion: PROMPT_VERSION,
  scoringVersion: SCORING_VERSION,
};

export type Pool = "evaluate" | "verify" | "narrative";

export interface ConcurrencyGate {
  acquire(pool: Pool, holder: string, ttlSeconds: number): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>;
  release(pool: Pool, holder: string): Promise<void>;
}

export const noopGate: ConcurrencyGate = {
  acquire: () => Promise.resolve({ ok: true }),
  release: () => Promise.resolve(),
};

export class CapacityError extends Error {
  retryAfterSeconds: number;
  constructor(pool: string, retryAfterSeconds: number) {
    super(`capacity_unavailable:${pool}`);
    this.name = "CapacityError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface StoredRun {
  id: string;
  runNo: number;
  status: string;
  inputHash: string;
  evaluations: QuestionEvaluation[];
  result: FinalScore | null;
  narrative: Narrative | null;
}

export interface NewRun {
  interviewId: string;
  submissionId: string;
  jobId: string | null;
  inputHash: string;
  versions: GradingVersions;
  models: GradingModels;
  params: GradingParams;
  provider: string;
  reusedFromRunId: string | null;
}

export interface PersistArgs {
  runId: string;
  models: GradingModels;
  interviewId: string;
  submissionId: string;
  jobId: string | null;
  inputHash: string;
  final: FinalScore;
  evaluations: QuestionEvaluation[];
  narrative: Narrative;
  narrativeSource: "model" | "fallback";
  usage: Record<string, StageUsage>;
  timings: { startedAt: string; finishedAt: string; totalMs: number };
  reusedFromRunId: string | null;
  answerEvaluationRows: AnswerEvaluationRow[];
  reportRow: ReportRow;
}

export interface GradingStore {
  loadBundle(interviewId: string): Promise<InterviewBundle | null>;
  /** A succeeded run with identical hash/versions/models (any job). */
  findReusableRun(interviewId: string, inputHash: string): Promise<StoredRun | null>;
  /** A run still marked running with the same hash (interrupted worker), to resume from. */
  findResumableRun(interviewId: string, inputHash: string): Promise<StoredRun | null>;
  createRun(run: NewRun): Promise<{ id: string; runNo: number }>;
  checkpoint(runId: string, evaluations: QuestionEvaluation[]): Promise<void>;
  persistResult(args: PersistArgs): Promise<void>;
  failRun(runId: string, error: string): Promise<void>;
}

export interface PipelineOptions {
  provider: GradingProvider;
  gate?: ConcurrencyGate;
  models?: Partial<GradingModels>;
  params?: Partial<GradingParams>;
  jobId?: string | null;
  /** Ignore a reusable run and grade again (manual re-run). */
  force?: boolean;
  /** Give up waiting for a capacity slot after this long. */
  maxSlotWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, data?: Record<string, unknown>) => void;
  /** Deterministic sampling salt for the QA second pass (defaults to the interview id). */
  qaSalt?: string;
}

export interface PipelineResult {
  runId: string;
  runNo: number;
  reused: boolean;
  inputHash: string;
  final: FinalScore;
  evaluations: QuestionEvaluation[];
  narrative: Narrative;
  narrativeSource: "model" | "fallback";
  usage: Record<string, StageUsage>;
  totalMs: number;
  reportRow: ReportRow;
}

function emptyUsage(): StageUsage {
  return { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };
}

function addUsage(stage: StageUsage, res: ProviderResponse<unknown>, model: string): void {
  stage.calls += 1;
  stage.latencyMs += res.latencyMs;
  stage.retries = (stage.retries ?? 0) + Math.max(0, res.attempts - 1);
  if (res.rateLimit) stage.rateLimit = res.rateLimit;
  if (res.usage) {
    stage.inputTokens += res.usage.inputTokens;
    stage.outputTokens += res.usage.outputTokens;
    stage.estimatedCostUsd += estimateCostUsd(model, res.usage);
  }
}

function sanitizeEvaluation(raw: unknown): ModelEvaluation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const scoresRaw = (r.scores ?? {}) as Record<string, unknown>;
  const scores = {} as Record<Criterion, number>;
  for (const c of ["relevance", "accuracy", "explanation", "consistency", "process", "application"] as Criterion[]) {
    const v = scoresRaw[c];
    scores[c] = typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(5, Math.round(v))) : 0;
  }
  const list = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, max) : [];
  const statusSet = new Set(["correct", "partially_correct", "vague", "incorrect", "missing", "unassessable"]);
  const confSet = new Set(["high", "medium", "low"]);
  const evidence = Array.isArray(r.evidence)
    ? r.evidence
        .filter((e): e is { quote: string; criterion: Criterion } => !!e && typeof (e as { quote?: unknown }).quote === "string")
        .map((e) => ({ quote: e.quote.trim(), criterion: (scores[e.criterion] !== undefined ? e.criterion : "accuracy") as Criterion }))
        .filter((e) => e.quote.length > 0)
        .slice(0, 6)
    : [];
  return {
    answer_status: statusSet.has(r.answer_status as string) ? (r.answer_status as ModelEvaluation["answer_status"]) : "vague",
    scores,
    correct_facts: list(r.correct_facts, 6),
    errors: list(r.errors, 6),
    missing_points: list(r.missing_points, 6),
    evidence,
    rationale: typeof r.rationale === "string" ? r.rationale.trim().slice(0, 1500) : "",
    confidence: confSet.has(r.confidence as string) ? (r.confidence as Confidence) : "low",
    uncertainty_reasons: list(r.uncertainty_reasons, 5),
  };
}

function applicableScores(material: QuestionMaterial, ev: ModelEvaluation): Partial<Record<Criterion, number>> {
  const out: Partial<Record<Criterion, number>> = {};
  for (const c of applicableCriteria(material.question.kind)) out[c] = ev.scores[c];
  return out;
}

function evidenceStatusOf(pass: PassResult): EvidenceStatus {
  if (pass.evidence.length === 0) return "missing";
  return pass.evidence.some((e) => e.verified) ? "verified" : "unverified";
}

function outcomeFromPass(material: QuestionMaterial, pass: PassResult): QuestionOutcome {
  return {
    status: pass.evaluation.answer_status,
    scores: pass.evaluation.answer_status === "unassessable" ? {} : applicableScores(material, pass.evaluation),
    questionScore: pass.questionScore,
    level: pass.questionScore === null ? null : levelForScore(pass.questionScore),
    evidenceStatus: evidenceStatusOf(pass),
    confidence: pass.evaluation.confidence,
    secondPassReasons: [],
    disagreement: null,
    requiresHumanReview: false,
    provisional: false,
    correctFacts: pass.evaluation.correct_facts,
    errors: pass.evaluation.errors,
    missingPoints: pass.evaluation.missing_points,
    rationale: pass.evaluation.rationale,
    verifiedEvidence: pass.evidence,
  };
}

function noModelOutcome(coverage: "skipped" | "no_answer"): QuestionOutcome {
  return {
    status: "missing",
    scores: {},
    questionScore: coverage === "skipped" ? 0 : null,
    level: coverage === "skipped" ? "low" : null,
    evidenceStatus: "missing",
    confidence: "high",
    secondPassReasons: [],
    disagreement: null,
    requiresHumanReview: false,
    provisional: false,
    correctFacts: [],
    errors: [],
    missingPoints: [],
    rationale: coverage === "skipped" ? "The student chose to skip this question." : "No answer was captured for this question.",
    verifiedEvidence: [],
  };
}

const CONSERVATIVE_STATUS_ORDER = ["unassessable", "missing", "incorrect", "vague", "partially_correct", "correct"] as const;

function combinePasses(material: QuestionMaterial, p1: PassResult, p2: PassResult, threshold: number, reasons: string[]): QuestionOutcome {
  const base = outcomeFromPass(material, p1);
  const s1 = p1.questionScore;
  const s2 = p2.questionScore;
  const disagreement = s1 !== null && s2 !== null ? Math.round(Math.abs(s1 - s2) * 10) / 10 : null;
  const unionEvidence = [...p1.evidence, ...p2.evidence.filter((e) => !p1.evidence.some((x) => x.quote === e.quote))];
  const minConf = (a: Confidence, b: Confidence): Confidence => {
    const order: Confidence[] = ["low", "medium", "high"];
    return order[Math.min(order.indexOf(a), order.indexOf(b))];
  };
  if (disagreement !== null && disagreement <= threshold && p1.evaluation.answer_status !== "unassessable" && p2.evaluation.answer_status !== "unassessable") {
    const scores: Partial<Record<Criterion, number>> = {};
    for (const c of applicableCriteria(material.question.kind)) {
      scores[c] = Math.round(((p1.evaluation.scores[c] + p2.evaluation.scores[c]) / 2) * 10) / 10;
    }
    const questionScore = questionScoreFromCriteria(material.question.kind, scores);
    const status =
      CONSERVATIVE_STATUS_ORDER.indexOf(p1.evaluation.answer_status) <= CONSERVATIVE_STATUS_ORDER.indexOf(p2.evaluation.answer_status)
        ? p1.evaluation.answer_status
        : p2.evaluation.answer_status;
    return {
      ...base,
      status,
      scores,
      questionScore,
      level: questionScore === null ? null : levelForScore(questionScore),
      evidenceStatus: unionEvidence.length === 0 ? "missing" : unionEvidence.some((e) => e.verified) ? "verified" : "unverified",
      confidence: minConf(p1.evaluation.confidence, p2.evaluation.confidence),
      secondPassReasons: reasons,
      disagreement,
      errors: [...new Set([...p1.evaluation.errors, ...p2.evaluation.errors])].slice(0, 6),
      missingPoints: [...new Set([...p1.evaluation.missing_points, ...p2.evaluation.missing_points])].slice(0, 6),
      verifiedEvidence: unionEvidence,
    };
  }
  // Material disagreement (or one pass could not assess): keep pass 1 as a
  // provisional value, never average, and hand the question to a human.
  return {
    ...base,
    secondPassReasons: reasons,
    disagreement,
    requiresHumanReview: true,
    provisional: true,
    confidence: "low",
    verifiedEvidence: unionEvidence,
  };
}

function toScoreInput(evaluations: QuestionEvaluation[], technicalIssue: boolean): ScoreInput {
  return {
    technicalIssue,
    questions: evaluations.map((e) => ({
      questionId: e.questionId,
      ordinal: e.ordinal,
      kind: e.kind,
      coverage: e.coverage,
      replaced: e.replaced,
      answerStatus: e.coverage === "answered" ? e.outcome.status : null,
      scores: e.outcome.scores,
      evidenceStatus: e.outcome.evidenceStatus,
      confidence: e.coverage === "answered" ? e.outcome.confidence : null,
      disagreement: e.outcome.disagreement,
      requiresHumanReview: e.outcome.requiresHumanReview,
    })),
  };
}

export async function gradeInterview(store: GradingStore, interviewId: string, opts: PipelineOptions): Promise<PipelineResult> {
  const startedAt = new Date();
  const models: GradingModels = { ...DEFAULT_MODELS, ...(opts.models ?? {}) };
  const params: GradingParams = { ...DEFAULT_PARAMS, ...(opts.params ?? {}) };
  const gate = opts.gate ?? noopGate;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const maxSlotWait = opts.maxSlotWaitMs ?? 120_000;
  const usage: Record<string, StageUsage> = { evaluate: emptyUsage(), verify: emptyUsage(), narrative: emptyUsage() };

  const bundle = await store.loadBundle(interviewId);
  if (!bundle) throw new Error("interview_not_found");

  const material: TranscriptMaterial = buildMaterial(bundle.plan, bundle.messages);
  const passagesByQ = new Map<string, SelectedPassage[]>();
  for (const m of material.questions) passagesByQ.set(m.question.id, selectPassages(m.question, bundle.chunks));

  const inputHash = await hashInput({
    versions: VERSIONS,
    models,
    params,
    provider: opts.provider.name,
    language: bundle.language,
    assignmentTitle: bundle.assignmentTitle,
    analysis: bundle.analysis,
    technical: bundle.technical,
    questions: material.questions.map((m) => ({
      question: m.question,
      coverage: m.coverage,
      replaced: m.replaced,
      discarded: m.discardedTurns,
      student: m.studentTurns.map((t) => ({ id: t.messageId, text: t.content })),
      host: m.hostTurns.map((t) => t.content),
      passages: passagesByQ.get(m.question.id) ?? [],
    })),
  });

  if (!opts.force) {
    const reusable = await store.findReusableRun(interviewId, inputHash);
    if (reusable && reusable.result && reusable.narrative) {
      log("run.reused", { runId: reusable.id });
      const rows = buildAnswerEvaluationRows({ interviewId, runId: reusable.id, models, versions: VERSIONS, evaluations: reusable.evaluations, final: reusable.result });
      const reportRow = buildReportRow({
        interviewId,
        submissionId: bundle.submissionId,
        studentId: bundle.studentId,
        assignmentId: bundle.assignmentId,
        runId: reusable.id,
        language: bundle.language,
        versions: VERSIONS,
        models,
        final: reusable.result,
        evaluations: reusable.evaluations,
        narrative: reusable.narrative,
        narrativeSource: "model",
      });
      const finishedAt = new Date();
      await store.persistResult({
        runId: reusable.id,
        models,
        interviewId,
        submissionId: bundle.submissionId,
        jobId: opts.jobId ?? null,
        inputHash,
        final: reusable.result,
        evaluations: reusable.evaluations,
        narrative: reusable.narrative,
        narrativeSource: "model",
        usage,
        timings: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), totalMs: finishedAt.getTime() - startedAt.getTime() },
        reusedFromRunId: reusable.id,
        answerEvaluationRows: rows,
        reportRow,
      });
      return {
        runId: reusable.id,
        runNo: reusable.runNo,
        reused: true,
        inputHash,
        final: reusable.result,
        evaluations: reusable.evaluations,
        narrative: reusable.narrative,
        narrativeSource: "model",
        usage,
        totalMs: finishedAt.getTime() - startedAt.getTime(),
        reportRow,
      };
    }
  }

  // Resume an interrupted run (same input) or open a new one.
  let runId: string;
  let runNo: number;
  const done = new Map<string, QuestionEvaluation>();
  const resumable = opts.force ? null : await store.findResumableRun(interviewId, inputHash);
  if (resumable) {
    runId = resumable.id;
    runNo = resumable.runNo;
    for (const e of resumable.evaluations) done.set(e.questionId, e);
    log("run.resumed", { runId, completed: done.size });
  } else {
    const created = await store.createRun({
      interviewId,
      submissionId: bundle.submissionId,
      jobId: opts.jobId ?? null,
      inputHash,
      versions: VERSIONS,
      models,
      params,
      provider: opts.provider.name,
      reusedFromRunId: null,
    });
    runId = created.id;
    runNo = created.runNo;
    log("run.created", { runId, runNo });
  }

  const withSlot = async <T>(pool: Pool, holder: string, fn: () => Promise<T>): Promise<T> => {
    const waitStart = Date.now();
    // A slot frees as soon as any in-flight call returns, so poll on a short
    // jittered backoff (0.4 s growing to 2 s) rather than on the lease TTL.
    for (let attempt = 0; ; attempt++) {
      const r = await gate.acquire(pool, holder, 180);
      if (r.ok) break;
      if (Date.now() - waitStart > maxSlotWait) throw new CapacityError(pool, r.retryAfterSeconds);
      await sleep(Math.min(2000, 400 * 1.5 ** attempt) * (0.75 + Math.random() * 0.5));
    }
    try {
      return await fn();
    } finally {
      await gate.release(pool, holder).catch(() => {});
    }
  };

  const runPass = async (m: QuestionMaterial, pass: 1 | 2): Promise<PassResult> => {
    const pool: Pool = pass === 1 ? "evaluate" : "verify";
    const model = pass === 1 ? models.evaluate : models.verify;
    const holder = `${runId}:${m.question.id}:${pass}`;
    const res = await withSlot(pool, holder, () =>
      opts.provider.call<ModelEvaluation>({
        operation: pass === 1 ? "evaluate" : "verify",
        model,
        input: buildEvaluationMessages({ bundle, material: m, passages: passagesByQ.get(m.question.id) ?? [] }),
        schemaName: "question_evaluation",
        schema: EVALUATION_SCHEMA as unknown as Record<string, unknown>,
        temperature: params.temperature,
        meta: { caseId: `${interviewId}:${m.question.id}`, material: m, pass },
      }),
    );
    addUsage(usage[pool], res, model);
    const evaluation = sanitizeEvaluation(res.parsed);
    const evidence = verifyEvidence(evaluation.evidence, m.studentTurns);
    const questionScore =
      evaluation.answer_status === "unassessable" ? null : questionScoreFromCriteria(m.question.kind, applicableScores(m, evaluation));
    return { pass, model: res.model, evaluation, evidence, questionScore, usage: res.usage, latencyMs: res.latencyMs, responseId: res.responseId };
  };

  try {
    // ---- pass 1 -----------------------------------------------------------
    const evaluations: QuestionEvaluation[] = new Array(material.questions.length);
    await Promise.all(
      material.questions.map(async (m, i) => {
        const existing = done.get(m.question.id);
        if (existing) {
          evaluations[i] = existing;
          return;
        }
        const base = {
          questionId: m.question.id,
          ordinal: m.question.index + 1,
          kind: m.question.kind,
          coverage: m.coverage,
          replaced: m.replaced,
          firstAnswerMessageId: m.studentTurns[0]?.messageId ?? null,
        };
        if (m.coverage !== "answered") {
          evaluations[i] = { ...base, passes: [], outcome: noModelOutcome(m.coverage) };
          return;
        }
        const p1 = await runPass(m, 1);
        evaluations[i] = { ...base, passes: [p1], outcome: outcomeFromPass(m, p1) };
        await store.checkpoint(runId, evaluations.filter(Boolean));
        log("question.evaluated", { questionId: m.question.id, score: p1.questionScore });
      }),
    );

    // ---- pass 2 (selective, independent) ----------------------------------
    const scoreInput = toScoreInput(evaluations, bundle.technical.technicalIssue);
    const qaSample = (fnv1a(`${opts.qaSalt ?? interviewId}:${VERSIONS.rubricVersion}`) % 1000) < Math.round(params.qaSampleRate * 1000);
    let qaUsed = false;
    const secondPassTargets: Array<{ index: number; reasons: string[] }> = [];
    evaluations.forEach((e, index) => {
      if (e.coverage !== "answered" || e.passes.length !== 1) return;
      const o = e.outcome;
      const reasons: string[] = [];
      if (o.status !== "unassessable" && o.evidenceStatus !== "verified" && (o.questionScore ?? 0) >= 40) reasons.push("unverified_evidence");
      if (o.confidence === "low") reasons.push("low_confidence");
      if (o.status === "correct" && o.errors.length > 0) reasons.push("status_errors_conflict");
      if (o.status === "incorrect" && (o.scores.accuracy ?? 0) >= 3) reasons.push("status_score_conflict");
      if (o.status === "missing" && (o.questionScore ?? 0) >= 30) reasons.push("status_score_conflict");
      if (o.status !== "unassessable" && isBoundarySensitive(scoreInput, e.questionId, params.boundaryDelta)) reasons.push("near_boundary");
      if (qaSample && !qaUsed && reasons.length === 0 && o.status !== "unassessable") {
        reasons.push("qa_sample");
        qaUsed = true;
      }
      if (reasons.length) secondPassTargets.push({ index, reasons });
    });
    await Promise.all(
      secondPassTargets.map(async ({ index, reasons }) => {
        const m = material.questions[index];
        const e = evaluations[index];
        const p2 = await runPass(m, 2);
        evaluations[index] = { ...e, passes: [e.passes[0], p2], outcome: combinePasses(m, e.passes[0], p2, params.disagreementThreshold, reasons) };
        log("question.verified", { questionId: m.question.id, reasons, disagreement: evaluations[index].outcome.disagreement });
      }),
    );
    if (secondPassTargets.length) await store.checkpoint(runId, evaluations);

    // ---- score + narrative -----------------------------------------------
    const final = calculateFinalScore(toScoreInput(evaluations, bundle.technical.technicalIssue));
    let narrative: Narrative;
    let narrativeSource: "model" | "fallback" = "fallback";
    if (final.assessedQuestions > 0 && final.confidence !== "none") {
      try {
        const res = await withSlot("narrative", `${runId}:narrative`, () =>
          opts.provider.call<Narrative>({
            operation: "narrative",
            model: models.narrative,
            input: buildNarrativeMessages({ bundle, final, evaluations }),
            schemaName: "interview_narrative",
            schema: NARRATIVE_SCHEMA as unknown as Record<string, unknown>,
            temperature: 0.2,
            meta: { caseId: `${interviewId}:narrative` },
          }),
        );
        addUsage(usage.narrative, res, models.narrative);
        narrative = sanitizeNarrative(res.parsed, bundle.language, final);
        narrativeSource = "model";
      } catch (err) {
        if (err instanceof CapacityError) throw err;
        if (err instanceof ProviderError && err.retryable) throw err;
        log("narrative.failed", { error: err instanceof Error ? err.message : String(err) });
        narrative = fallbackNarrative(bundle.language, final);
      }
    } else {
      narrative = fallbackNarrative(bundle.language, final);
    }

    const rows = buildAnswerEvaluationRows({ interviewId, runId, models, versions: VERSIONS, evaluations, final });
    const reportRow = buildReportRow({
      interviewId,
      submissionId: bundle.submissionId,
      studentId: bundle.studentId,
      assignmentId: bundle.assignmentId,
      runId,
      language: bundle.language,
      versions: VERSIONS,
      models,
      final,
      evaluations,
      narrative,
      narrativeSource,
    });
    const finishedAt = new Date();
    const totalMs = finishedAt.getTime() - startedAt.getTime();
    await store.persistResult({
      runId,
      models,
      interviewId,
      submissionId: bundle.submissionId,
      jobId: opts.jobId ?? null,
      inputHash,
      final,
      evaluations,
      narrative,
      narrativeSource,
      usage,
      timings: { startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), totalMs },
      reusedFromRunId: null,
      answerEvaluationRows: rows,
      reportRow,
    });
    log("run.succeeded", { runId, overall: final.overallScore, review: final.requiresHumanReview, totalMs });
    return { runId, runNo, reused: false, inputHash, final, evaluations, narrative, narrativeSource, usage, totalMs, reportRow };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A capacity wait is not a failure of this run: keep it resumable.
    if (!(err instanceof CapacityError)) await store.failRun(runId, message).catch(() => {});
    throw err;
  }
}

function sanitizeNarrative(raw: unknown, language: InterviewBundle["language"], final: FinalScore): Narrative {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown, max: number): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()).slice(0, max) : [];
  const fb = fallbackNarrative(language, final);
  const strengths = list(r.strengths, 6);
  const weaknesses = list(r.weaknesses, 6);
  const recommendations = list(r.recommendations, 5);
  return {
    summary: typeof r.summary === "string" && r.summary.trim() ? r.summary.trim().slice(0, 2000) : fb.summary,
    strengths: strengths.length ? strengths : fb.strengths,
    weaknesses: weaknesses.length ? weaknesses : fb.weaknesses,
    recommendations: recommendations.length ? recommendations : fb.recommendations,
  };
}

export { type Usage };
