/**
 * Server-side integrity analysis, run once by `complete-interview` after the
 * interview is over. Everything here works on rows the server already holds
 * (messages, system events, the parsed document) and produces REVIEW ITEMS
 * for the lecturer, never a verdict:
 *
 *   analyzeSession   facts the browser cannot forge: was a Realtime session
 *                    ever minted for this interview, do the stored rows fit
 *                    the wall clock.
 *   analyzeTiming    extreme patterns in the room's per-turn timing metadata
 *                    (client telemetry): repeated long pauses followed by
 *                    long fluent answers, or uniformly instant answers.
 *   analyzeOverlap   long verbatim runs shared with the submitted document.
 *
 * Thresholds are deliberately conservative and every flag carries a
 * `limitations` note that the report shows next to it.
 */
import { DocumentIndex, computeOverlap, isSignificantOverlap } from "./overlap.ts";

export interface MessageRow {
  id: string;
  speaker: string;
  message_type: string;
  content: string | null;
  plan_question_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface FlagInsert {
  interview_id: string;
  student_id: string;
  plan_question_id: string | null;
  message_id: string | null;
  category: string;
  description: string;
  quote: string | null;
  evidence: unknown[];
  confidence: "low" | "medium" | "high";
  limitations: string;
  needs_human_review: boolean;
  source: "server_overlap" | "server_timing" | "server_session";
}

const DIRECTIVE_RE = /^\s*\[(SYSTEM NOTE|הודעת מערכת)\]/;

export function isDirective(text: string | null | undefined): boolean {
  return DIRECTIVE_RE.test(text ?? "");
}

export function studentAnswers(messages: MessageRow[]): MessageRow[] {
  return messages.filter(
    (m) =>
      m.speaker === "student" &&
      m.message_type === "answer" &&
      typeof m.content === "string" &&
      m.content.trim().length > 2 &&
      !isDirective(m.content),
  );
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function num(meta: Record<string, unknown> | null, key: string): number | null {
  const v = meta?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------

export interface SessionFacts {
  interviewId: string;
  studentId: string;
  mintCount: number;
  startedAt: string | null;
  completedAt: string | null;
  messages: MessageRow[];
}

export function analyzeSession(facts: SessionFacts): FlagInsert[] {
  const flags: FlagInsert[] = [];
  const answers = studentAnswers(facts.messages);
  const base = {
    interview_id: facts.interviewId,
    student_id: facts.studentId,
    plan_question_id: null,
    message_id: null,
    quote: null,
    needs_human_review: true,
    source: "server_session" as const,
  };

  if (answers.length > 0 && facts.mintCount === 0) {
    flags.push({
      ...base,
      category: "no_live_session",
      description:
        "Transcript rows were stored although no live voice session was ever created for this interview.",
      evidence: [{ answers: answers.length, sessions_minted: 0 }],
      confidence: "high",
      limitations:
        "Server-side fact: the voice session is created by the server on every room start. A transcript without any session cannot come from the interview room.",
    });
  }

  if (facts.startedAt) {
    const startMs = new Date(facts.startedAt).getTime();
    const early = answers.filter(
      (m) => new Date(m.created_at).getTime() < startMs - 60_000,
    );
    if (early.length > 0) {
      flags.push({
        ...base,
        category: "messages_before_start",
        description: "Some answers were stored before the interview was started.",
        evidence: [{ answers_before_start: early.length }],
        confidence: "high",
        limitations: "Server-side timestamps.",
      });
    }
  }

  if (facts.startedAt && facts.completedAt && answers.length >= 3) {
    const wall =
      new Date(facts.completedAt).getTime() - new Date(facts.startedAt).getTime();
    if (wall < 90_000) {
      flags.push({
        ...base,
        category: "implausibly_short",
        description: "The whole interview took under 90 seconds of wall-clock time.",
        evidence: [{ wall_clock_seconds: Math.round(wall / 1000), answers: answers.length }],
        confidence: "medium",
        limitations:
          "Server-side timestamps. A reconnect that restarted the clock can shorten the measured span.",
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------

export interface TimingSummary {
  answers: number;
  withTiming: number;
  medianLatencyMs: number | null;
  maxLatencyMs: number | null;
  bargeIns: number;
}

export function analyzeTiming(
  interviewId: string,
  studentId: string,
  messages: MessageRow[],
): { flags: FlagInsert[]; summary: TimingSummary } {
  const answers = studentAnswers(messages);
  const timed = answers
    .map((m) => ({
      row: m,
      latency: num(m.metadata, "latency_ms"),
      speech: num(m.metadata, "speech_ms"),
      bargeIn: m.metadata?.barge_in === true,
      words: wordCount(m.content ?? ""),
    }))
    .filter((t) => t.latency !== null);

  const latencies = timed.map((t) => t.latency as number).sort((a, b) => a - b);
  const median = latencies.length
    ? latencies[Math.floor(latencies.length / 2)]
    : null;
  const summary: TimingSummary = {
    answers: answers.length,
    withTiming: timed.length,
    medianLatencyMs: median,
    maxLatencyMs: latencies.length ? latencies[latencies.length - 1] : null,
    bargeIns: timed.filter((t) => t.bargeIn).length,
  };

  const flags: FlagInsert[] = [];
  const base = {
    interview_id: interviewId,
    student_id: studentId,
    message_id: null,
    quote: null,
    needs_human_review: true,
    source: "server_timing" as const,
  };

  // Pattern A: repeated long pause, then a long fluent answer.
  const longPauseFluent = timed.filter(
    (t) => (t.latency as number) >= 20_000 && t.words >= 40,
  );
  if (longPauseFluent.length >= 3) {
    flags.push({
      ...base,
      plan_question_id: longPauseFluent[0].row.plan_question_id,
      category: "long_pause_then_fluent",
      description:
        "Several answers started after a long pause and then ran long and continuous.",
      evidence: longPauseFluent.map((t) => ({
        plan_question_id: t.row.plan_question_id,
        latency_ms: t.latency,
        words: t.words,
      })),
      confidence: "low",
      limitations:
        "Client-reported timing. Thinking time, a slow connection, a noisy room, accessibility needs or answering in a second language produce the same pattern. Read together with the answers themselves.",
    });
  }

  // Pattern B: uniformly instant answers with no interruptions.
  if (timed.length >= 4) {
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const variance =
      latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / latencies.length;
    const sd = Math.sqrt(variance);
    if (mean < 1200 && sd < 200 && summary.bargeIns === 0) {
      flags.push({
        ...base,
        plan_question_id: null,
        category: "uniform_instant_answers",
        description:
          "Every answer started within about a second of the question, with almost no variation.",
        evidence: [{ mean_latency_ms: Math.round(mean), sd_ms: Math.round(sd), answers: timed.length }],
        confidence: "low",
        limitations:
          "Client-reported timing. A fast, confident speaker produces this too; it is only worth a look together with the content.",
      });
    }
  }

  return { flags, summary };
}

// ---------------------------------------------------------------------------

export function analyzeOverlap(
  interviewId: string,
  studentId: string,
  documentText: string,
  messages: MessageRow[],
  documentKind: "raw_text" | "llm_markdown",
): FlagInsert[] {
  if (!documentText || documentText.trim().length < 200) return [];
  const index = new DocumentIndex(documentText);
  const flags: FlagInsert[] = [];
  for (const m of studentAnswers(messages)) {
    const result = computeOverlap(m.content ?? "", index);
    if (!isSignificantOverlap(result)) continue;
    flags.push({
      interview_id: interviewId,
      student_id: studentId,
      plan_question_id: m.plan_question_id,
      message_id: m.id,
      category: "verbatim_document",
      description:
        "A long run of this answer matches the submitted document word for word.",
      quote: result.answerExcerpt,
      evidence: [
        {
          passage: result.passage,
          longest_run_tokens: result.longestRun,
          shared_share: Number(result.score.toFixed(2)),
          answer_tokens: result.answerTokens,
          document_source: documentKind,
        },
      ],
      confidence: result.longestRun >= 20 ? "high" : "medium",
      limitations:
        documentKind === "raw_text"
          ? "Compared with the text of the submitted file. Quoting your own definitions or terms is normal; what matters is whether the idea was then explained in the student's own words (see the follow-up in the transcript)."
          : "Compared with a model-generated rendering of the PDF, not its exact text, so matches are approximate. Quoting your own work is normal; what matters is the explanation that followed.",
      needs_human_review: true,
      source: "server_overlap",
    });
  }
  return flags;
}
