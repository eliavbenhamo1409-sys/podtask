import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATION_PATH = resolve(here, "../../supabase/migrations/20260515000001_grading_engine.sql");

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(resolve(here, "fixture.sql"), "utf8"));
  await db.exec(readFileSync(MIGRATION_PATH, "utf8"));
  return db;
}

export interface Seeded {
  studentId: string;
  assignmentId: string;
  submissionId: string;
  interviewId: string;
}

export async function seedInterview(db: PGlite, opts: { status?: string } = {}): Promise<Seeded> {
  const { rows: s } = await db.query<{ id: string }>("insert into public.profiles (id, email) values (gen_random_uuid(), 'x@test') returning id");
  const studentId = s[0].id;
  const { rows: a } = await db.query<{ id: string }>("insert into public.assignments (id, title) values (gen_random_uuid(), 'T') returning id");
  const assignmentId = a[0].id;
  const { rows: sub } = await db.query<{ id: string }>(
    "insert into public.submissions (assignment_id, student_id, status) values ($1, $2, 'interview_ready') returning id",
    [assignmentId, studentId],
  );
  const submissionId = sub[0].id;
  const { rows: i } = await db.query<{ id: string }>(
    "insert into public.interviews (submission_id, assignment_id, student_id, status) values ($1, $2, $3, $4) returning id",
    [submissionId, assignmentId, studentId, opts.status ?? "in_progress"],
  );
  return { studentId, assignmentId, submissionId, interviewId: i[0].id };
}

/** Marks the interview completed the way complete-interview does (fires the outbox trigger). */
export async function completeInterview(db: PGlite, interviewId: string): Promise<void> {
  await db.query("update public.interviews set status = 'completed', completed_at = now() where id = $1 and status = 'in_progress'", [interviewId]);
  await db.query("update public.submissions set status = 'interview_completed' where id = (select submission_id from public.interviews where id = $1)", [interviewId]);
}

export async function one<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  if (rows.length !== 1) throw new Error(`expected 1 row, got ${rows.length}: ${sql}`);
  return rows[0];
}

export async function rpc<T = unknown>(db: PGlite, name: string, args: Record<string, unknown>): Promise<T> {
  const keys = Object.keys(args);
  const placeholders = keys.map((k, i) => `${k} := $${i + 1}`).join(", ");
  const { rows } = await db.query<{ r: T }>(`select ${name}(${placeholders}) as r`, keys.map((k) => args[k]));
  return rows[0].r;
}

export function sampleReport(seed: Seeded, runId: string, overall = 72) {
  return {
    submission_id: seed.submissionId,
    interview_id: seed.interviewId,
    student_id: seed.studentId,
    assignment_id: seed.assignmentId,
    overall_level: overall >= 85 ? "high" : overall >= 70 ? "medium_high" : overall >= 50 ? "medium" : "low",
    summary: "s",
    rubric_result: { conceptual: 3.5, reasoning: 3, communication: 4, evidence: 3, overall_score: overall, grading_run_id: runId, requires_human_review: false },
    gaps: [],
    evidence: ["quote"],
    recommendations: [{ kind: "strength", text: "x" }],
    pdf_path: null,
    status: "ready",
    grading_run_id: runId,
  };
}

export function sampleEvaluationRows(seed: Seeded, runId: string) {
  return [
    {
      message_id: null,
      question_id: "q1",
      model: "mock",
      understanding_level: "medium_high",
      clarity_score: 4,
      conceptual_score: 3.5,
      reasoning_score: null,
      consistency_score: 4,
      evidence: ["quote"],
      gaps: [],
      raw_output: { summary: "r" },
      question_score: 72.5,
      answer_status: "correct",
      evidence_status: "verified",
      confidence: "high",
      pass_count: 1,
      verified_evidence: [],
      rubric_version: "v1",
      prompt_version: "v1",
      scoring_version: "v1",
    },
  ];
}
