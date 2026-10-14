import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFinalScore,
  dimensionScoresForQuestion,
  isBoundarySensitive,
  questionScoreFromCriteria,
} from "../../supabase/functions/_shared/grading/score.ts";
import { CRITERION_DIMENSION, KIND_WEIGHTS, applicableCriteria, levelForScore } from "../../supabase/functions/_shared/grading/rubric.ts";
import { CRITERIA, DIMENSIONS, QUESTION_KINDS, type ScoreInput, type ScoreQuestionInput } from "../../supabase/functions/_shared/grading/types.ts";

function q(overrides: Partial<ScoreQuestionInput> & { questionId: string; ordinal: number }): ScoreQuestionInput {
  return {
    kind: "concept",
    coverage: "answered",
    replaced: false,
    answerStatus: "correct",
    scores: { relevance: 5, accuracy: 5, explanation: 5, consistency: 5 },
    evidenceStatus: "verified",
    confidence: "high",
    disagreement: null,
    requiresHumanReview: false,
    ...overrides,
  };
}

test("rubric: every criterion maps to exactly one dimension, every kind has at least one applicable criterion", () => {
  const seen = new Map<string, number>();
  for (const c of CRITERIA) {
    const d = CRITERION_DIMENSION[c];
    assert.ok(DIMENSIONS.includes(d));
    seen.set(c, (seen.get(c) ?? 0) + 1);
  }
  for (const c of CRITERIA) assert.equal(seen.get(c), 1);
  for (const kind of QUESTION_KINDS) {
    assert.ok(applicableCriteria(kind).length >= 3, kind);
    for (const c of CRITERIA) assert.ok(KIND_WEIGHTS[kind][c] >= 0);
  }
  // Application is never judged for kinds that do not ask for it.
  for (const kind of ["opening", "concept", "evidence", "process", "detail"] as const) {
    assert.equal(KIND_WEIGHTS[kind].application, 0, kind);
  }
});

test("question score: weighted mean of applicable criteria, scaled to 0-100", () => {
  assert.equal(questionScoreFromCriteria("concept", { relevance: 5, accuracy: 5, explanation: 5, consistency: 5 }), 100);
  assert.equal(questionScoreFromCriteria("concept", { relevance: 0, accuracy: 0, explanation: 0, consistency: 0 }), 0);
  // concept weights: relevance 1, accuracy 2, explanation 2, consistency 1 => accuracy alone = 2*5 / (6*5)
  assert.equal(questionScoreFromCriteria("concept", { relevance: 0, accuracy: 5, explanation: 0, consistency: 0 }), 33.3);
  // non-applicable criteria are ignored even if present
  assert.equal(questionScoreFromCriteria("concept", { relevance: 5, accuracy: 5, explanation: 5, consistency: 5, application: 0, process: 0 }), 100);
  // nothing present => null (unassessable), never 0
  assert.equal(questionScoreFromCriteria("concept", {}), null);
  // out-of-range values are clamped
  assert.equal(questionScoreFromCriteria("detail", { relevance: 9, accuracy: 9, explanation: 9, consistency: 9 }), 100);
});

test("dimension scores: process feeds only the evidence dimension; application + consistency feed reasoning", () => {
  const dims = dimensionScoresForQuestion("process", { relevance: 4, accuracy: 4, explanation: 2, consistency: 3, process: 5 });
  assert.equal(dims.evidence, 5);
  assert.equal(dims.communication, 2);
  assert.equal(dims.reasoning, 3);
  assert.equal(dims.conceptual, 4);
  const counter = dimensionScoresForQuestion("counter", { relevance: 5, accuracy: 5, explanation: 5, consistency: 1, application: 5 });
  assert.equal(counter.evidence, undefined, "a counter question has no process criterion");
  // reasoning = (2.5*5 + 1*1) / 3.5
  assert.ok(Math.abs((counter.reasoning ?? 0) - 13.5 / 3.5) < 1e-9);
});

test("final score: five perfect answers = 100 / high, deterministic", () => {
  const input: ScoreInput = {
    technicalIssue: false,
    questions: [1, 2, 3, 4, 5].map((n) => q({ questionId: `q${n}`, ordinal: n })),
  };
  const a = calculateFinalScore(input);
  const b = calculateFinalScore(structuredClone(input));
  assert.deepEqual(a, b);
  assert.equal(a.overallScore, 100);
  assert.equal(a.overallLevel, "high");
  assert.equal(a.coverage, 1);
  assert.equal(a.requiresHumanReview, false);
  assert.equal(a.confidence, "high");
  assert.deepEqual(a.dimensions, { conceptual: 5, reasoning: 5, evidence: null, communication: 5 });
  assert.deepEqual(a.dimensionFallbacks, ["evidence"], "five concept questions never judge process, so evidence is n/a rather than invented");
});

test("skip policy: a skipped question costs exactly its share once; replaced carries no penalty", () => {
  const base = [1, 2, 3, 4, 5].map((n) => q({ questionId: `q${n}`, ordinal: n }));
  const skipped = calculateFinalScore({ technicalIssue: false, questions: base.map((x, i) => (i === 2 ? { ...x, coverage: "skipped", scores: {}, answerStatus: null } : x)) });
  assert.equal(skipped.overallScore, 80);
  assert.deepEqual(skipped.skippedQuestions, [3]);
  assert.equal(skipped.assessedQuestions, 5, "a skip is the student's choice: it counts as assessed");
  assert.equal(skipped.requiresHumanReview, false);
  assert.equal(skipped.dimensions.conceptual, 4, "the skip contributes 0 to the dimensions its kind would have judged");

  const replaced = calculateFinalScore({ technicalIssue: false, questions: base.map((x, i) => (i === 1 ? { ...x, replaced: true } : x)) });
  assert.equal(replaced.overallScore, 100);
  assert.deepEqual(replaced.replacedQuestions, [2]);
});

test("unanswered questions: 0 normally, excluded (and flagged) when the interview had technical trouble", () => {
  const base = [1, 2, 3, 4, 5].map((n) => q({ questionId: `q${n}`, ordinal: n }));
  const withGap = base.map((x, i) => (i === 4 ? { ...x, coverage: "no_answer" as const, scores: {}, answerStatus: null } : x));
  const normal = calculateFinalScore({ technicalIssue: false, questions: withGap });
  assert.equal(normal.overallScore, 80);
  assert.equal(normal.questionScores[4].status, "no_answer");
  assert.equal(normal.requiresHumanReview, false);

  const technical = calculateFinalScore({ technicalIssue: true, questions: withGap });
  assert.equal(technical.overallScore, 100, "the missing answer is not treated as missing knowledge");
  assert.equal(technical.questionScores[4].status, "excluded_technical");
  assert.deepEqual(technical.excludedQuestions, [5]);
  assert.equal(technical.coverage, 0.8);
  assert.deepEqual(technical.reviewReasons, ["technical_exclusions"]);
  assert.equal(technical.requiresHumanReview, true);
  assert.equal(technical.confidence, "low");
});

test("not enough data: unassessable answers carry no weight; low coverage or nothing assessed => human review", () => {
  const base = [1, 2, 3, 4, 5].map((n) => q({ questionId: `q${n}`, ordinal: n }));
  const twoLeft = calculateFinalScore({
    technicalIssue: false,
    questions: base.map((x, i) => (i < 3 ? { ...x, answerStatus: "unassessable", scores: {} } : x)),
  });
  assert.equal(twoLeft.assessedQuestions, 2);
  assert.equal(twoLeft.coverage, 0.4);
  assert.equal(twoLeft.overallScore, 100);
  assert.ok(twoLeft.reviewReasons.includes("low_coverage"));

  const nothing = calculateFinalScore({ technicalIssue: false, questions: base.map((x) => ({ ...x, answerStatus: "unassessable", scores: {} })) });
  assert.equal(nothing.overallScore, 0);
  assert.equal(nothing.overallLevel, "low");
  assert.equal(nothing.confidence, "none");
  assert.deepEqual(nothing.reviewReasons, ["no_assessable_answers"]);
  assert.deepEqual(nothing.dimensions, { conceptual: null, reasoning: null, evidence: null, communication: null });
});

test("level thresholds and boundary sensitivity", () => {
  assert.equal(levelForScore(49), "low");
  assert.equal(levelForScore(50), "medium");
  assert.equal(levelForScore(69), "medium");
  assert.equal(levelForScore(70), "medium_high");
  assert.equal(levelForScore(84), "medium_high");
  assert.equal(levelForScore(85), "high");

  // Five detail questions at 69.1 => overall 69 (medium); moving one by +10 => 71 => medium_high.
  const seventy = [1, 2, 3, 4, 5].map((n) =>
    q({ questionId: `q${n}`, ordinal: n, kind: "detail", scores: { relevance: 4, accuracy: 3, explanation: 4, consistency: 3 } }),
  );
  const f = calculateFinalScore({ technicalIssue: false, questions: seventy });
  assert.equal(f.questionScores[0].score, 69.1);
  assert.equal(f.overallScore, 69);
  assert.equal(isBoundarySensitive({ technicalIssue: false, questions: seventy }, "q1", 10), true);
  // Far from any boundary: not sensitive.
  const nineties = [1, 2, 3, 4, 5].map((n) => q({ questionId: `q${n}`, ordinal: n, scores: { relevance: 5, accuracy: 5, explanation: 5, consistency: 4 } }));
  assert.equal(isBoundarySensitive({ technicalIssue: false, questions: nineties }, "q1", 10), false);
});

test("confidence: medium when credit was given without verified evidence; low on disagreement", () => {
  const base = [1, 2, 3, 4, 5].map((n) => q({ questionId: `q${n}`, ordinal: n }));
  const unverified = calculateFinalScore({ technicalIssue: false, questions: base.map((x, i) => (i === 0 ? { ...x, evidenceStatus: "unverified" } : x)) });
  assert.equal(unverified.confidence, "medium");
  const disagreed = calculateFinalScore({ technicalIssue: false, questions: base.map((x, i) => (i === 0 ? { ...x, requiresHumanReview: true, disagreement: 35 } : x)) });
  assert.equal(disagreed.confidence, "low");
  assert.deepEqual(disagreed.reviewReasons, ["pass_disagreement"]);
});
