/**
 * Deterministic scoring. Pure functions only: the same `ScoreInput` always
 * yields the same `FinalScore`, with no model involved.
 *
 *   question score   weighted mean of the APPLICABLE criteria for the
 *                    question's kind, scaled to 0-100
 *   dimension score  for each of the four report dimensions, the mean over
 *                    assessed questions of the weighted mean of that
 *                    dimension's criteria (0-5); a question whose kind has no
 *                    applicable criterion in a dimension does not contribute
 *   overall          weighted mean of question scores (weight 1 each);
 *                    skipped = 0; unanswered = 0 unless the interview shows
 *                    technical trouble, in which case the question is excluded
 *                    and the report is flagged for a human
 *   level            thresholds in `rubric.ts` (unchanged UI mapping)
 *
 * Policies, stated once so they are auditable:
 *   - a skipped question costs exactly its share, never twice (it is not
 *     also counted as "missing evidence");
 *   - a replaced question is scored like any other, with no penalty;
 *   - a question the model declares `unassessable` carries no weight;
 *   - when nothing carries weight the overall is 0, confidence `none`, and
 *     the report requires human review rather than pretending to grade.
 */
import {
  CRITERION_DIMENSION,
  KIND_WEIGHTS,
  RUBRIC_VERSION,
  levelForScore,
} from "./rubric.ts";
import type {
  Confidence,
  Criterion,
  Dimension,
  FinalScore,
  Level,
  QuestionKind,
  QuestionScoreStatus,
  ScoreInput,
  ScoreQuestionInput,
} from "./types.ts";
import { DIMENSIONS } from "./types.ts";

export const SCORING_VERSION = "v1";

/** Coverage below this share of the plan is not enough for an automatic grade. */
export const MIN_COVERAGE_FOR_AUTO_GRADE = 0.6;

function clamp5(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 0-100 from the applicable criteria present in `scores`; null when none is present. */
export function questionScoreFromCriteria(
  kind: QuestionKind,
  scores: Partial<Record<Criterion, number>>,
): number | null {
  const weights = KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.concept;
  let num = 0;
  let den = 0;
  for (const c of Object.keys(weights) as Criterion[]) {
    const w = weights[c];
    if (w <= 0) continue;
    const s = clamp5(scores[c]);
    if (s === null) continue;
    num += w * s;
    den += w * 5;
  }
  if (den === 0) return null;
  return round1((num / den) * 100);
}

/** Per-dimension 0-5 for one question (only dimensions with an applicable, present criterion). */
export function dimensionScoresForQuestion(
  kind: QuestionKind,
  scores: Partial<Record<Criterion, number>>,
): Partial<Record<Dimension, number>> {
  const weights = KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.concept;
  const num: Partial<Record<Dimension, number>> = {};
  const den: Partial<Record<Dimension, number>> = {};
  for (const c of Object.keys(weights) as Criterion[]) {
    const w = weights[c];
    if (w <= 0) continue;
    const s = clamp5(scores[c]);
    if (s === null) continue;
    const d = CRITERION_DIMENSION[c];
    num[d] = (num[d] ?? 0) + w * s;
    den[d] = (den[d] ?? 0) + w;
  }
  const out: Partial<Record<Dimension, number>> = {};
  for (const d of DIMENSIONS) {
    if ((den[d] ?? 0) > 0) out[d] = (num[d] ?? 0) / den[d]!;
  }
  return out;
}

/** Which dimensions a kind can contribute to at all (used for skipped questions, which contribute 0). */
function applicableDimensions(kind: QuestionKind): Dimension[] {
  const weights = KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.concept;
  const set = new Set<Dimension>();
  for (const c of Object.keys(weights) as Criterion[]) if (weights[c] > 0) set.add(CRITERION_DIMENSION[c]);
  return DIMENSIONS.filter((d) => set.has(d));
}

interface QuestionLine {
  q: ScoreQuestionInput;
  status: QuestionScoreStatus;
  score: number | null;
  weight: number;
  dims: Partial<Record<Dimension, number>>;
}

function classify(q: ScoreQuestionInput, technicalIssue: boolean): QuestionLine {
  if (q.coverage === "skipped") {
    const dims: Partial<Record<Dimension, number>> = {};
    for (const d of applicableDimensions(q.kind)) dims[d] = 0;
    return { q, status: "skipped", score: 0, weight: 1, dims };
  }
  if (q.coverage === "no_answer") {
    if (technicalIssue) return { q, status: "excluded_technical", score: null, weight: 0, dims: {} };
    const dims: Partial<Record<Dimension, number>> = {};
    for (const d of applicableDimensions(q.kind)) dims[d] = 0;
    return { q, status: "no_answer", score: 0, weight: 1, dims };
  }
  if (q.answerStatus === "unassessable") {
    return { q, status: "excluded_unassessable", score: null, weight: 0, dims: {} };
  }
  const score = questionScoreFromCriteria(q.kind, q.scores);
  if (score === null) return { q, status: "excluded_unassessable", score: null, weight: 0, dims: {} };
  return { q, status: "scored", score, weight: 1, dims: dimensionScoresForQuestion(q.kind, q.scores) };
}

export function calculateFinalScore(input: ScoreInput, rubricVersion: string = RUBRIC_VERSION): FinalScore {
  const lines = input.questions.map((q) => classify(q, input.technicalIssue));
  const planned = lines.length;

  let num = 0;
  let den = 0;
  for (const l of lines) {
    if (l.weight <= 0 || l.score === null) continue;
    num += l.weight * l.score;
    den += l.weight;
  }
  const overall = den > 0 ? Math.round(num / den) : 0;
  const assessed = lines.filter((l) => l.weight > 0).length;
  const coverage = planned > 0 ? Math.round((assessed / planned) * 1000) / 1000 : 0;

  const dimensions: Record<Dimension, number | null> = {
    conceptual: null,
    reasoning: null,
    evidence: null,
    communication: null,
  };
  const dimensionFallbacks: Dimension[] = [];
  for (const d of DIMENSIONS) {
    let sum = 0;
    let n = 0;
    for (const l of lines) {
      if (l.weight <= 0) continue;
      const v = l.dims[d];
      if (typeof v !== "number") continue;
      sum += v;
      n += 1;
    }
    if (n > 0) dimensions[d] = round1(sum / n);
    else if (den > 0) dimensionFallbacks.push(d);
  }

  const reviewReasons: string[] = [];
  const answeredCount = lines.filter((l) => l.q.coverage === "answered").length;
  if (den === 0) reviewReasons.push("no_assessable_answers");
  else if (answeredCount === 0) reviewReasons.push("no_captured_answers");
  if (planned > 0 && den > 0 && coverage < MIN_COVERAGE_FOR_AUTO_GRADE) reviewReasons.push("low_coverage");
  if (lines.some((l) => l.status === "excluded_technical")) reviewReasons.push("technical_exclusions");
  if (lines.some((l) => l.q.requiresHumanReview)) reviewReasons.push("pass_disagreement");

  let confidence: Confidence | "none";
  if (den === 0 || answeredCount === 0) confidence = "none";
  else if (
    reviewReasons.length > 0 ||
    lines.some((l) => l.status === "scored" && l.q.confidence === "low")
  ) {
    confidence = "low";
  } else if (
    lines.some(
      (l) =>
        l.status === "scored" &&
        (l.q.confidence === "medium" || (l.q.evidenceStatus !== "verified" && (l.score ?? 0) >= 40)),
    )
  ) {
    confidence = "medium";
  } else confidence = "high";

  return {
    rubricVersion,
    scoringVersion: SCORING_VERSION,
    overallScore: overall,
    overallLevel: levelForScore(overall),
    dimensions,
    questionScores: lines.map((l) => ({
      questionId: l.q.questionId,
      ordinal: l.q.ordinal,
      kind: l.q.kind,
      score: l.score,
      weight: l.weight,
      status: l.status,
      level: l.score === null ? null : levelForScore(l.score),
    })),
    plannedQuestions: planned,
    assessedQuestions: assessed,
    coverage,
    skippedQuestions: lines.filter((l) => l.status === "skipped").map((l) => l.q.ordinal),
    replacedQuestions: lines.filter((l) => l.q.replaced).map((l) => l.q.ordinal),
    excludedQuestions: lines.filter((l) => l.weight === 0).map((l) => l.q.ordinal),
    requiresHumanReview: reviewReasons.length > 0,
    reviewReasons,
    confidence,
    dimensionFallbacks,
  };
}

/**
 * True when moving ONE question's score by ±delta would change the overall
 * level. Used to decide which questions deserve an independent second pass.
 */
export function isBoundarySensitive(input: ScoreInput, questionId: string, delta: number): boolean {
  const base = calculateFinalScore(input);
  const line = base.questionScores.find((q) => q.questionId === questionId);
  if (!line || line.weight <= 0 || line.score === null) return false;
  const totalWeight = base.questionScores.reduce((s, q) => s + q.weight, 0);
  if (totalWeight <= 0) return false;
  const baseSum = base.questionScores.reduce((s, q) => s + (q.score ?? 0) * q.weight, 0);
  for (const sign of [-1, 1]) {
    const moved = Math.max(0, Math.min(100, line.score + sign * delta));
    const overall = Math.round((baseSum - line.score * line.weight + moved * line.weight) / totalWeight);
    if (levelForScore(overall) !== base.overallLevel) return true;
  }
  return false;
}

export function levelForQuestionScore(score: number | null): Level | null {
  return score === null ? null : levelForScore(score);
}
