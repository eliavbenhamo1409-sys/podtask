/**
 * The canonical grading rubric, version `v1`.
 *
 * Six criteria are judged by the model on a 0-5 scale with the anchors
 * below. Which criteria apply, and with what weight, depends on the KIND of
 * the planned question, so a question that never asked for application is
 * never penalised for not applying anything. Every criterion maps to exactly
 * one of the four report dimensions, so nothing is counted twice:
 *
 *   conceptual     <- accuracy, relevance
 *   reasoning      <- application, consistency
 *   evidence       <- process (grounding in the work's data, method, sources)
 *   communication  <- explanation
 *
 * Changing anchors, weights or the mapping is a new RUBRIC_VERSION. The
 * benchmark (`bench/grading`) is re-run for every version.
 */
import type { Criterion, Dimension, Level, QuestionKind } from "./types.ts";

export const RUBRIC_VERSION = "v1";

export interface CriterionDefinition {
  key: Criterion;
  label: string;
  question: string;
  anchors: Record<0 | 1 | 2 | 3 | 4 | 5, string>;
}

export const CRITERION_DEFINITIONS: readonly CriterionDefinition[] = [
  {
    key: "relevance",
    label: "Relevance",
    question: "Does the answer address what was actually asked?",
    anchors: {
      0: "Nothing in the answer relates to the question (silence, a different topic, generic chat).",
      1: "Touches the topic area only; does not engage the question itself.",
      2: "Partly on target: answers a neighbouring or easier question, or drifts for most of the turn.",
      3: "Addresses the question with noticeable detours or one unaddressed part.",
      4: "Addresses the question directly; minor digressions only.",
      5: "Squarely answers exactly what was asked, including any follow-up, with nothing substantive missing from the question's scope.",
    },
  },
  {
    key: "accuracy",
    label: "Accuracy",
    question: "Is what the student says correct with respect to the submission and the discipline?",
    anchors: {
      0: "No checkable claim, or every claim is wrong.",
      1: "Mostly wrong; a correct term may appear but the substance is mistaken.",
      2: "Basic facts right, but a significant error or misconception about the core idea.",
      3: "Largely correct with a clear error or an imprecise statement that matters.",
      4: "Correct; at most a small imprecision that does not change the meaning.",
      5: "Precise and correct throughout, including nuances the question invites.",
    },
  },
  {
    key: "explanation",
    label: "Explanation in own words",
    question: "Can the student explain the idea, mechanism or reasoning, not just name it?",
    anchors: {
      0: "No explanation: names nothing, or only repeats the question.",
      1: "Names terms or headings only; no mechanism, no 'how' or 'why'.",
      2: "A fragment of explanation; mostly restates the written text or stays at labels.",
      3: "Explains the main idea in own words with gaps or a muddled step.",
      4: "Clear, structured explanation of the idea and how it works.",
      5: "Clear, complete and well-organised explanation that could teach the idea to a peer.",
    },
  },
  {
    key: "consistency",
    label: "Consistency",
    question: "Does the answer fit the submission and the student's other answers?",
    anchors: {
      0: "Directly contradicts the submission or an earlier answer on the central point.",
      1: "Major inconsistency with the submission's own claims or method.",
      2: "Noticeable inconsistency on a secondary point, or shifting claims within the answer.",
      3: "Consistent on the main point; a minor tension left unresolved.",
      4: "Consistent with the submission and earlier answers.",
      5: "Consistent, and the student reconciles tensions explicitly when they arise (including correcting an earlier slip).",
    },
  },
  {
    key: "process",
    label: "Process and grounding",
    question: "Does the student know how the work was done and ground claims in its concrete data, sources, method and choices?",
    anchors: {
      0: "Cannot say anything about how the work was done or what it rests on.",
      1: "Vague gestures ('I read things', 'I used data') with no specifics.",
      2: "Names one concrete element (a source, a dataset, a step) without explaining its role.",
      3: "Describes the main steps or sources with gaps on why they were chosen.",
      4: "Describes the method, data or sources and the main choices behind them.",
      5: "Describes method, data, sources, limitations and trade-offs, tying each to the claims they support.",
    },
  },
  {
    key: "application",
    label: "Application and defence",
    question: "Can the student use the idea in a new situation or defend it against a counter-position?",
    anchors: {
      0: "No attempt, or an attempt that abandons the idea entirely.",
      1: "Restates the original claim without engaging the new case or objection.",
      2: "Engages superficially; the transfer or defence does not hold.",
      3: "A reasonable application or defence with a weak step or a missed implication.",
      4: "Sound application or defence that handles the main objection.",
      5: "Insightful application or defence that anticipates implications and limits.",
    },
  },
];

/** Criterion -> report dimension (each criterion appears exactly once). */
export const CRITERION_DIMENSION: Record<Criterion, Dimension> = {
  accuracy: "conceptual",
  relevance: "conceptual",
  application: "reasoning",
  consistency: "reasoning",
  process: "evidence",
  explanation: "communication",
};

/**
 * Criterion weights by question kind. A weight of 0 means "not applicable
 * for this kind": the model is told to ignore it and the score never uses it.
 */
export const KIND_WEIGHTS: Record<QuestionKind, Record<Criterion, number>> = {
  opening: { relevance: 1, accuracy: 1, explanation: 1.5, consistency: 1, process: 1, application: 0 },
  concept: { relevance: 1, accuracy: 2, explanation: 2, consistency: 1, process: 0, application: 0 },
  evidence: { relevance: 1, accuracy: 2, explanation: 1, consistency: 1, process: 2, application: 0 },
  process: { relevance: 1, accuracy: 1.5, explanation: 1, consistency: 1, process: 2.5, application: 0 },
  counter: { relevance: 1, accuracy: 1.5, explanation: 1, consistency: 1, process: 0, application: 2.5 },
  application: { relevance: 1, accuracy: 1.5, explanation: 1, consistency: 1, process: 0, application: 2.5 },
  reflection: { relevance: 1, accuracy: 0.5, explanation: 1, consistency: 1, process: 1.5, application: 1.5 },
  detail: { relevance: 1, accuracy: 2, explanation: 1.5, consistency: 1, process: 0, application: 0 },
};

/** What each kind of question is for (shown to the evaluator as the question's purpose). */
export const KIND_PURPOSE: Record<QuestionKind, string> = {
  opening: "Orientation: can the student describe what the work is about and why they chose it. Breadth over depth; no application expected.",
  concept: "A central concept: can the student define and explain it in their own words and connect it to the work. Terminology alone earns nothing.",
  evidence: "A factual claim or finding: can the student say what it rests on (data, sources, cases) and what it shows.",
  process: "How the work was done: choices, steps, data, tools, limitations and trade-offs.",
  counter: "A counter-position or objection: can the student defend or qualify their claim against it.",
  application: "Transfer: can the student use the idea in a new situation or a different setting.",
  reflection: "Reflection: what the student would change or extend, and why; judged on grounded, specific reasoning.",
  detail: "A specific passage or detail: can the student explain what it means and why it is there.",
};

export function applicableCriteria(kind: QuestionKind): Criterion[] {
  const w = KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.concept;
  return (Object.keys(w) as Criterion[]).filter((c) => w[c] > 0);
}

export function criterionWeight(kind: QuestionKind, criterion: Criterion): number {
  return (KIND_WEIGHTS[kind] ?? KIND_WEIGHTS.concept)[criterion] ?? 0;
}

export function toQuestionKind(value: unknown): QuestionKind {
  return typeof value === "string" && value in KIND_WEIGHTS ? (value as QuestionKind) : "concept";
}

/** Overall 0-100 -> level. Unchanged from the previous prompt-based mapping. */
export const LEVEL_THRESHOLDS: ReadonlyArray<{ min: number; level: Level }> = [
  { min: 85, level: "high" },
  { min: 70, level: "medium_high" },
  { min: 50, level: "medium" },
  { min: 0, level: "low" },
];

export function levelForScore(score: number): Level {
  for (const t of LEVEL_THRESHOLDS) if (score >= t.min) return t.level;
  return "low";
}

/** Distance (in points) from `score` to the nearest level boundary. */
export function distanceToBoundary(score: number): number {
  let best = Infinity;
  for (const t of LEVEL_THRESHOLDS) {
    if (t.min === 0) continue;
    best = Math.min(best, Math.abs(score - t.min));
  }
  return best;
}

/** Renders the rubric for the evaluator prompt (English; the model writes its findings in the interview language). */
export function renderRubric(kind: QuestionKind): string {
  const applicable = new Set(applicableCriteria(kind));
  const lines: string[] = [];
  for (const def of CRITERION_DEFINITIONS) {
    const tag = applicable.has(def.key)
      ? `weight ${criterionWeight(kind, def.key)}`
      : "NOT APPLICABLE for this question: return 0, it is ignored";
    lines.push(`${def.key} (${def.label}; ${tag}): ${def.question}`);
    for (const level of [0, 1, 2, 3, 4, 5] as const) {
      lines.push(`  ${level} = ${def.anchors[level]}`);
    }
  }
  return lines.join("\n");
}
