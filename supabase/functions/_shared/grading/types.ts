/**
 * Shared types for the grading engine (`_shared/grading/*`).
 *
 * The engine has one job: turn a finished interview (plan + transcript +
 * document context) into a versioned, reproducible score. The model only
 * ever returns per-criterion judgements with evidence; every number the
 * student or lecturer sees is computed in `score.ts` from those judgements.
 *
 * Runtime-neutral: no Deno or Node globals, so the same files run in the
 * Edge Functions, in `node --test`, and in the benchmark harness.
 */

export type Language = "he" | "en" | "ar";

export type QuestionKind =
  | "opening"
  | "concept"
  | "evidence"
  | "process"
  | "counter"
  | "application"
  | "reflection"
  | "detail";

export const QUESTION_KINDS: readonly QuestionKind[] = [
  "opening",
  "concept",
  "evidence",
  "process",
  "counter",
  "application",
  "reflection",
  "detail",
];

/** The six model-judged criteria (0-5 each, see `rubric.ts`). */
export type Criterion =
  | "relevance"
  | "accuracy"
  | "explanation"
  | "consistency"
  | "process"
  | "application";

export const CRITERIA: readonly Criterion[] = [
  "relevance",
  "accuracy",
  "explanation",
  "consistency",
  "process",
  "application",
];

/** The four dimensions the report shows (unchanged UI contract). */
export type Dimension = "conceptual" | "reasoning" | "evidence" | "communication";

export const DIMENSIONS: readonly Dimension[] = [
  "conceptual",
  "reasoning",
  "evidence",
  "communication",
];

export type AnswerStatus =
  | "correct"
  | "partially_correct"
  | "vague"
  | "incorrect"
  | "missing"
  | "unassessable";

export type Confidence = "high" | "medium" | "low";

export type Level = "low" | "medium" | "medium_high" | "high";

/** How a planned question was covered in the interview, from the transcript. */
export type QuestionCoverage = "answered" | "skipped" | "no_answer";

export interface PlanQuestion {
  id: string;
  /** 0-based position in the plan (the host announces ordinal index+1). */
  index: number;
  kind: QuestionKind;
  topic: string;
  question: string;
  /** Verbatim excerpt from the document the question is anchored on ("" for the opening). */
  anchor: string;
  keyPoints: string[];
  followUps: string[];
}

export interface Turn {
  messageId: string;
  content: string;
  createdAt: string;
}

export interface QuestionMaterial {
  question: PlanQuestion;
  coverage: QuestionCoverage;
  /** The student asked once for a different question in this slot (no penalty). */
  replaced: boolean;
  /** Student turns bound to this question, in order (directives and discarded turns removed). */
  studentTurns: Turn[];
  /** Host turns bound to this question (the first is the question, later ones are follow-ups). */
  hostTurns: Turn[];
  /** Spoken turns the room rejected as noise / wrong language for this question. */
  discardedTurns: number;
}

export interface TechnicalSignals {
  disconnects: number;
  resumes: number;
  mintFailures: number;
  /** True when any signal suggests parts of the conversation may be missing for technical reasons. */
  technicalIssue: boolean;
}

export interface DocumentChunk {
  index: number;
  content: string;
}

/** Everything the engine needs, loaded by the store in one go. */
export interface InterviewBundle {
  interviewId: string;
  submissionId: string;
  assignmentId: string;
  studentId: string;
  language: Language;
  assignmentTitle: string;
  analysis: {
    summary: string | null;
    mainArgument: string | null;
    keyConcepts: string[];
    claims: string[];
  };
  plan: PlanQuestion[];
  /** Raw transcript rows, ordered by created_at. */
  messages: TranscriptRow[];
  chunks: DocumentChunk[];
  technical: TechnicalSignals;
}

export interface TranscriptRow {
  id: string;
  speaker: string;
  message_type: string;
  content: string | null;
  plan_question_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

/** The strict structured output the evaluation model returns for ONE question. */
export interface ModelEvaluation {
  answer_status: AnswerStatus;
  scores: Record<Criterion, number>;
  correct_facts: string[];
  errors: string[];
  missing_points: string[];
  evidence: Array<{ quote: string; criterion: Criterion }>;
  rationale: string;
  confidence: Confidence;
  uncertainty_reasons: string[];
}

export interface VerifiedEvidence {
  quote: string;
  criterion: Criterion;
  verified: boolean;
  messageId: string | null;
  /** Character offsets of the matched span inside that message's content. */
  start: number | null;
  end: number | null;
  /** Share of the quote's tokens found as one contiguous run in a student turn. */
  matchRatio: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface PassResult {
  pass: 1 | 2;
  model: string;
  evaluation: ModelEvaluation;
  evidence: VerifiedEvidence[];
  /** 0-100, computed from the applicable criteria; null when unassessable. */
  questionScore: number | null;
  usage: Usage | null;
  latencyMs: number;
  responseId: string | null;
}

export type EvidenceStatus = "verified" | "unverified" | "missing";

export interface QuestionOutcome {
  status: AnswerStatus;
  /** Applicable criteria only, 0-5. Empty when nothing was assessed. */
  scores: Partial<Record<Criterion, number>>;
  questionScore: number | null;
  level: Level | null;
  evidenceStatus: EvidenceStatus;
  confidence: Confidence;
  secondPassReasons: string[];
  /** |pass1 - pass2| question score difference, when a second pass ran. */
  disagreement: number | null;
  requiresHumanReview: boolean;
  /** True when the displayed score is the first pass kept after a material disagreement. */
  provisional: boolean;
  correctFacts: string[];
  errors: string[];
  missingPoints: string[];
  rationale: string;
  verifiedEvidence: VerifiedEvidence[];
}

export interface QuestionEvaluation {
  questionId: string;
  ordinal: number;
  kind: QuestionKind;
  coverage: QuestionCoverage;
  replaced: boolean;
  firstAnswerMessageId: string | null;
  passes: PassResult[];
  outcome: QuestionOutcome;
}

/** Input of the pure scoring function (`calculateFinalScore`). */
export interface ScoreQuestionInput {
  questionId: string;
  ordinal: number;
  kind: QuestionKind;
  coverage: QuestionCoverage;
  replaced: boolean;
  answerStatus: AnswerStatus | null;
  /** Applicable criteria only, 0-5. */
  scores: Partial<Record<Criterion, number>>;
  evidenceStatus: EvidenceStatus;
  confidence: Confidence | null;
  disagreement: number | null;
  requiresHumanReview: boolean;
}

export interface ScoreInput {
  questions: ScoreQuestionInput[];
  technicalIssue: boolean;
}

export type QuestionScoreStatus =
  | "scored"
  | "skipped"
  | "no_answer"
  | "excluded_technical"
  | "excluded_unassessable";

export interface FinalScore {
  rubricVersion: string;
  scoringVersion: string;
  overallScore: number;
  overallLevel: Level;
  dimensions: Record<Dimension, number | null>;
  questionScores: Array<{
    questionId: string;
    ordinal: number;
    kind: QuestionKind;
    score: number | null;
    weight: number;
    status: QuestionScoreStatus;
    level: Level | null;
  }>;
  plannedQuestions: number;
  /** Questions that carry weight in the overall score (answered or skipped). */
  assessedQuestions: number;
  /** assessedQuestions / plannedQuestions. */
  coverage: number;
  skippedQuestions: number[];
  replacedQuestions: number[];
  excludedQuestions: number[];
  requiresHumanReview: boolean;
  reviewReasons: string[];
  confidence: Confidence | "none";
  /** Dimensions that had no applicable criterion in any assessed question. */
  dimensionFallbacks: Dimension[];
}

export interface Narrative {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export interface StageUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  /** Retries the provider needed (429 / 5xx / network). */
  retries?: number;
  /** Last `x-ratelimit-*` headers OpenAI returned for this stage (the org's real limits). */
  rateLimit?: Record<string, string> | null;
}

export interface GradingVersions {
  rubricVersion: string;
  promptVersion: string;
  scoringVersion: string;
}

export interface GradingModels {
  evaluate: string;
  verify: string;
  narrative: string;
}

export interface GradingParams {
  temperature: number;
  /** Second-pass trigger: a question score this close to flipping the overall level gets re-checked. */
  boundaryDelta: number;
  /** Material disagreement between the two passes, in question-score points (0-100). */
  disagreementThreshold: number;
  /** 0-1 share of interviews that get a second pass on one question for drift monitoring. */
  qaSampleRate: number;
}
