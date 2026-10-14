/**
 * Builds the database rows the engine persists, so the shape is defined in
 * one place and checked by tests:
 *
 *   answer_evaluations   one row per planned question (compatible with the
 *                        lecturer UI: understanding_level, the four legacy
 *                        score columns, evidence, gaps, raw_output) plus the
 *                        new provenance columns;
 *   reports              the row the student page polls; `rubric_result`
 *                        keeps its four dimension keys + overall_score and
 *                        gains the provenance block.
 */
import { levelForScore } from "./rubric.ts";
import type {
  FinalScore,
  GradingModels,
  GradingVersions,
  Language,
  Narrative,
  QuestionEvaluation,
} from "./types.ts";

export interface AnswerEvaluationRow {
  interview_id: string;
  message_id: string | null;
  question_id: string;
  model: string;
  understanding_level: "low" | "medium" | "medium_high" | "high" | null;
  clarity_score: number | null;
  conceptual_score: number | null;
  reasoning_score: number | null;
  consistency_score: number | null;
  evidence: string[];
  gaps: string[];
  recommended_next_action: null;
  recommended_followup: null;
  raw_output: Record<string, unknown>;
  grading_run_id: string;
  question_score: number | null;
  answer_status: string;
  evidence_status: string;
  confidence: string;
  pass_count: number;
  verified_evidence: unknown[];
  rubric_version: string;
  prompt_version: string;
  scoring_version: string;
}

export function buildAnswerEvaluationRows(args: {
  interviewId: string;
  runId: string;
  models: GradingModels;
  versions: GradingVersions;
  evaluations: QuestionEvaluation[];
  final: FinalScore;
}): AnswerEvaluationRow[] {
  const { interviewId, runId, models, versions, evaluations, final } = args;
  return evaluations.map((e) => {
    const o = e.outcome;
    const line = final.questionScores.find((q) => q.questionId === e.questionId);
    const score = line?.score ?? null;
    const verified = o.verifiedEvidence.filter((v) => v.verified);
    const n = (v: number | undefined): number | null => (typeof v === "number" ? Math.round(v * 10) / 10 : null);
    return {
      interview_id: interviewId,
      message_id: e.firstAnswerMessageId,
      question_id: e.questionId,
      model: e.passes[0]?.model ?? models.evaluate,
      understanding_level: score === null ? null : levelForScore(score),
      clarity_score: n(o.scores.explanation),
      conceptual_score: n(o.scores.accuracy),
      reasoning_score: n(o.scores.application),
      consistency_score: n(o.scores.consistency),
      evidence: verified.map((v) => v.quote).slice(0, 3),
      gaps: [...o.errors, ...o.missingPoints].slice(0, 3),
      recommended_next_action: null,
      recommended_followup: null,
      raw_output: {
        relevance: n(o.scores.relevance),
        accuracy: n(o.scores.accuracy),
        explanation: n(o.scores.explanation),
        consistency: n(o.scores.consistency),
        process: n(o.scores.process),
        application: n(o.scores.application),
        summary: o.rationale,
        answer_status: o.status,
        coverage: e.coverage,
        replaced: e.replaced,
        correct_facts: o.correctFacts,
        errors: o.errors,
        missing_points: o.missingPoints,
        question_score: score,
        score_status: line?.status ?? null,
        second_pass_reasons: o.secondPassReasons,
        disagreement: o.disagreement,
        provisional: o.provisional,
        requires_human_review: o.requiresHumanReview,
        unverified_evidence: o.verifiedEvidence.filter((v) => !v.verified).map((v) => v.quote),
      },
      grading_run_id: runId,
      question_score: score,
      answer_status: e.coverage === "answered" ? o.status : e.coverage,
      evidence_status: o.evidenceStatus,
      confidence: o.confidence,
      pass_count: e.passes.length,
      verified_evidence: o.verifiedEvidence,
      rubric_version: versions.rubricVersion,
      prompt_version: versions.promptVersion,
      scoring_version: versions.scoringVersion,
    };
  });
}

export interface ReportRow {
  submission_id: string;
  interview_id: string;
  student_id: string;
  assignment_id: string;
  overall_level: "low" | "medium" | "medium_high" | "high";
  summary: string;
  rubric_result: Record<string, unknown>;
  gaps: string[];
  evidence: string[];
  recommendations: Array<{ kind: "strength" | "weakness" | "recommendation"; text: string }>;
  pdf_path: null;
  status: "ready";
  grading_run_id: string;
}

export function buildReportRow(args: {
  interviewId: string;
  submissionId: string;
  studentId: string;
  assignmentId: string;
  runId: string;
  language: Language;
  versions: GradingVersions;
  models: GradingModels;
  final: FinalScore;
  evaluations: QuestionEvaluation[];
  narrative: Narrative;
  narrativeSource: "model" | "fallback";
}): ReportRow {
  const { final, evaluations, narrative } = args;
  const gaps: string[] = [];
  const evidence: string[] = [];
  for (const e of evaluations) {
    for (const g of [...e.outcome.errors, ...e.outcome.missingPoints]) if (gaps.length < 5 && !gaps.includes(g)) gaps.push(g);
    for (const v of e.outcome.verifiedEvidence) {
      if (v.verified && evidence.length < 6 && !evidence.includes(v.quote)) evidence.push(v.quote);
    }
  }
  return {
    submission_id: args.submissionId,
    interview_id: args.interviewId,
    student_id: args.studentId,
    assignment_id: args.assignmentId,
    overall_level: final.overallLevel,
    summary: narrative.summary,
    rubric_result: {
      conceptual: final.dimensions.conceptual,
      reasoning: final.dimensions.reasoning,
      communication: final.dimensions.communication,
      evidence: final.dimensions.evidence,
      overall_score: final.overallScore,
      skipped_questions: final.skippedQuestions,
      replaced_questions: final.replacedQuestions,
      engine: "v2",
      rubric_version: args.versions.rubricVersion,
      scoring_version: args.versions.scoringVersion,
      prompt_version: args.versions.promptVersion,
      grading_run_id: args.runId,
      models: args.models,
      language: args.language,
      requires_human_review: final.requiresHumanReview,
      review_reasons: final.reviewReasons,
      confidence: final.confidence,
      coverage: final.coverage,
      assessed_questions: final.assessedQuestions,
      planned_questions: final.plannedQuestions,
      excluded_questions: final.excludedQuestions,
      dimension_fallbacks: final.dimensionFallbacks,
      question_scores: final.questionScores.map((q) => ({
        id: q.questionId,
        ordinal: q.ordinal,
        kind: q.kind,
        score: q.score,
        level: q.level,
        status: q.status,
      })),
      narrative_source: args.narrativeSource,
    },
    gaps,
    evidence,
    recommendations: [
      ...narrative.strengths.map((text) => ({ kind: "strength" as const, text })),
      ...narrative.weaknesses.map((text) => ({ kind: "weakness" as const, text })),
      ...narrative.recommendations.map((text) => ({ kind: "recommendation" as const, text })),
    ],
    pdf_path: null,
    status: "ready",
    grading_run_id: args.runId,
  };
}
