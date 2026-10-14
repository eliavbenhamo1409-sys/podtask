/**
 * Turns the stored transcript into per-question material the evaluator can
 * judge. Mirrors the room's conventions (see ARCHITECTURE.md §4):
 *
 *   - student turns: speaker `student`, message_type `answer`; the room's
 *     `[SYSTEM NOTE]` directives echoed back as student items are dropped
 *     (prefix check + `metadata.kind = directive_echo`);
 *   - host turns: speaker `ai_host`; the first bound to a question is the
 *     question itself, later ones are follow-ups;
 *   - system rows: `skipped_question:N`, `replaced_question:N`,
 *     `discarded_utterance:<kind>`; bound by `plan_question_id` when the
 *     room set it, otherwise by the ordinal N.
 */
import type {
  PlanQuestion,
  QuestionMaterial,
  TranscriptRow,
  Turn,
} from "./types.ts";
import { toQuestionKind } from "./rubric.ts";

const DIRECTIVE_RE = /^\s*\[(SYSTEM NOTE|הודעת מערכת)\]/;
const MARKER_RE = /^(skipped|replaced)_question:(\d{1,2})$/;
const DISCARDED_RE = /^discarded_utterance:([a-z_]+)$/;

export function isDirective(text: string | null | undefined): boolean {
  return DIRECTIVE_RE.test(text ?? "");
}

/** Normalises `interview_plans.plan.questions` into `PlanQuestion`s. */
export function normalizePlan(plan: unknown): PlanQuestion[] {
  const questions = (plan as { questions?: unknown[] } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  const out: PlanQuestion[] = [];
  questions.forEach((raw, index) => {
    const q = (raw ?? {}) as Record<string, unknown>;
    if (typeof q.id !== "string" || typeof q.question !== "string") return;
    out.push({
      id: q.id,
      index,
      kind: toQuestionKind(q.kind),
      topic: typeof q.topic === "string" ? q.topic : "",
      question: q.question,
      anchor: typeof q.anchor === "string" ? q.anchor : "",
      keyPoints: stringList(q.key_points, 6),
      followUps: stringList(q.follow_ups, 4),
    });
  });
  return out;
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

export interface TranscriptMaterial {
  questions: QuestionMaterial[];
  /** Student turns the room bound to no question (greeting / asides). */
  unboundStudentTurns: Turn[];
  totalStudentTurns: number;
  totalStudentChars: number;
}

export function buildMaterial(plan: PlanQuestion[], rows: TranscriptRow[]): TranscriptMaterial {
  const byId = new Map<string, QuestionMaterial>();
  for (const q of plan) {
    byId.set(q.id, {
      question: q,
      coverage: "no_answer",
      replaced: false,
      studentTurns: [],
      hostTurns: [],
      discardedTurns: 0,
    });
  }
  const skipped = new Set<string>();
  const unbound: Turn[] = [];
  let totalStudentTurns = 0;
  let totalStudentChars = 0;

  const resolveQuestionId = (row: TranscriptRow, ordinal: number | null): string | null => {
    if (row.plan_question_id && byId.has(row.plan_question_id)) return row.plan_question_id;
    if (ordinal !== null && ordinal >= 1 && ordinal <= plan.length) return plan[ordinal - 1].id;
    return null;
  };

  for (const row of rows) {
    const text = (row.content ?? "").trim();
    if (!text) continue;

    if (row.speaker === "system") {
      const marker = MARKER_RE.exec(text);
      if (marker) {
        const qid = resolveQuestionId(row, Number.parseInt(marker[2], 10));
        if (!qid) continue;
        if (marker[1] === "skipped") skipped.add(qid);
        else byId.get(qid)!.replaced = true;
        continue;
      }
      if (DISCARDED_RE.test(text)) {
        const qid = resolveQuestionId(row, null);
        if (qid) byId.get(qid)!.discardedTurns += 1;
      }
      continue;
    }

    if (row.speaker === "student") {
      if (row.message_type !== "answer") continue;
      if (isDirective(text)) continue;
      if ((row.metadata as { kind?: unknown } | null)?.kind === "directive_echo") continue;
      const turn: Turn = { messageId: row.id, content: text, createdAt: row.created_at };
      totalStudentTurns += 1;
      totalStudentChars += text.length;
      const qid = resolveQuestionId(row, null);
      if (qid) byId.get(qid)!.studentTurns.push(turn);
      else unbound.push(turn);
      continue;
    }

    if (row.speaker === "ai_host") {
      const qid = resolveQuestionId(row, null);
      if (!qid) continue;
      byId.get(qid)!.hostTurns.push({ messageId: row.id, content: text, createdAt: row.created_at });
    }
  }

  const questions = plan.map((q) => {
    const m = byId.get(q.id)!;
    if (skipped.has(q.id) && m.studentTurns.length === 0) m.coverage = "skipped";
    else if (m.studentTurns.length > 0) m.coverage = "answered";
    else m.coverage = "no_answer";
    return m;
  });

  return { questions, unboundStudentTurns: unbound, totalStudentTurns, totalStudentChars };
}

/** Interleaves host and student turns of one question in time order, as the evaluator sees them. */
export function conversationLines(m: QuestionMaterial): Array<{ role: "host" | "student"; messageId: string; content: string }> {
  const merged = [
    ...m.hostTurns.map((t) => ({ role: "host" as const, ...t })),
    ...m.studentTurns.map((t) => ({ role: "student" as const, ...t })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return merged.map((t) => ({ role: t.role, messageId: t.messageId, content: t.content }));
}
