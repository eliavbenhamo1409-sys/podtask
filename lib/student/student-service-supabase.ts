/**
 * Supabase-backed branch of the student service.
 * Used in production (NEXT_PUBLIC_MOCK_MODE=false). Each function maps the DB row
 * shape to the UI types in `./types`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  STORAGE_BUCKETS,
  assignmentFilePath,
  uploadToBucket,
} from "@/lib/supabase/storage";
import type { Database } from "@/lib/supabase/database.types";
import {
  normalizeInterviewLanguage,
  type InterviewLanguage,
} from "./interview-language";
import type {
  InterviewStartOutcome,
  InterviewTranscript,
  StudentAssignment,
  StudentDashboard,
  StudentHistoryEntry,
  StudentInterview,
  StudentInterviewQuestion,
  StudentProfile,
  StudentSubmission,
} from "./types";
import type {
  StudentAssignmentStatus,
  SubmissionStatus,
} from "./status";
import {
  isPersonalCourseCode,
  resolveIntegritySettings,
  type IntegritySettings,
} from "@/lib/integrity/settings";
import type { HostFlagInput, IntegrityClientEvent } from "@/lib/integrity/types";

type SbClient = SupabaseClient<Database>;

/**
 * Calls an Edge Function with the current session's access token. Used
 * instead of `sb.functions.invoke` where the HTTP status matters (the
 * interview-control function answers 409 / 412 with a JSON body) or where a
 * keepalive request is needed (telemetry flushed on pagehide).
 */
async function callEdge<T>(
  sb: SbClient,
  name: string,
  body: unknown,
  opts: { keepalive?: boolean } = {},
): Promise<{ status: number; data: T | null }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const {
    data: { session },
  } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!url || !anon || !token) return { status: 401, data: null };
  const res = await fetch(`${url.replace(/\/$/, "")}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    keepalive: opts.keepalive === true,
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

interface OutlineQuestion {
  id?: string;
  topic?: string;
  kind?: string | null;
  question?: string | null;
  recommended_seconds?: number;
}

function outlineToQuestions(raw: unknown): StudentInterviewQuestion[] {
  const obj = (raw ?? null) as { questions?: OutlineQuestion[] } | null;
  if (!obj || !Array.isArray(obj.questions)) return [];
  return obj.questions
    .filter((q) => q && typeof q.id === "string")
    .map((q) => ({
      id: q.id as string,
      topic: typeof q.topic === "string" ? q.topic : "",
      question: typeof q.question === "string" ? q.question : "",
      recommendedSeconds:
        typeof q.recommended_seconds === "number" ? q.recommended_seconds : 75,
      kind: typeof q.kind === "string" ? q.kind : null,
    }));
}

/**
 * The planned questions through the `interview_outline` RPC: ids, topics and
 * timing always, the question text only once the interview is over. The
 * `interview_plans` table itself is not readable by the student before then.
 */
export async function getInterviewOutlineSb(
  sb: SbClient,
  interviewId: string,
): Promise<StudentInterviewQuestion[]> {
  const { data, error } = await sb.rpc("interview_outline", {
    p_interview_id: interviewId,
  });
  if (error || !data) return [];
  return outlineToQuestions(data);
}

/**
 * The signed-in student's id, read from the session JWT and verified locally
 * against the project's public signing key (JWKS, cached) — no round trip to
 * Supabase Auth per call. It is only used to scope filters; every query is
 * still authorised by RLS with the same token.
 */
async function currentUserIdSb(sb: SbClient): Promise<string | null> {
  const { data } = await sb.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}

function deriveBadge(
  s: StudentAssignmentStatus,
): "next" | "todo" | "done" {
  if (s === "completed") return "done";
  if (
    s === "processing" ||
    s === "ready_for_interview" ||
    s === "mic_test_required" ||
    s === "interview_in_progress"
  )
    return "next";
  return "todo";
}

function projectAssignmentStatus(
  status?: SubmissionStatus,
): StudentAssignmentStatus {
  if (!status) return "upload_required";
  switch (status) {
    case "uploaded":
    case "parsing":
    case "parsed":
    case "analyzing":
    case "analysis_ready":
      return "processing";
    case "interview_ready":
      return "ready_for_interview";
    case "interview_completed":
    case "report_ready":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "processing";
  }
}

type SubmissionRowFull = Database["public"]["Tables"]["submissions"]["Row"];

/** Single source of truth for the submissions row -> UI shape mapping. */
function rowToSubmission(row: SubmissionRowFull): StudentSubmission {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    studentId: row.student_id,
    status: row.status as SubmissionStatus,
    originalFilename: row.original_filename ?? "",
    fileSizeBytes: Number(row.file_size_bytes ?? 0),
    submittedAt: row.submitted_at,
    failureReason: row.failure_reason ?? undefined,
  };
}

// `institution` comes from the embedded select `institution:institutions ( name )`;
// institution_id is a many-to-one FK, so PostgREST returns an object or null.
type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"] & {
  institution?: { name: string } | null;
};

function rowToProfile(row: ProfileRow): StudentProfile {
  return {
    id: row.id,
    fullName: row.full_name ?? row.email,
    email: row.email,
    avatarInitial: (row.full_name ?? row.email).slice(0, 1).toUpperCase(),
    institutionName: row.institution?.name ?? "",
    locale: (row.locale === "en" ? "en" : "he"),
  };
}

export async function getStudentProfileSb(
  sb: SbClient,
): Promise<StudentProfile | null> {
  const userId = await currentUserIdSb(sb);
  if (!userId) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("*, institution:institutions ( name )")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as unknown as ProfileRow);
}

/**
 * Loads the student's view of published assignments. With `assignmentId` the
 * three queries (the assignment, the student's submission for it, their
 * interview for it) are independent and go out in parallel — one round trip
 * instead of loading every assignment just to pick one.
 */
async function loadAssignmentsSb(
  sb: SbClient,
  opts: { assignmentId?: string } = {},
): Promise<StudentAssignment[]> {
  const userId = await currentUserIdSb(sb);
  if (!userId) return [];

  type AssignmentRow = {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    due_at: string | null;
    interview_duration_minutes: number;
    status: string;
    settings: unknown;
    course?:
      | { id: string; name: string; code: string; lecturer_name: string | null }
      | { id: string; name: string; code: string; lecturer_name: string | null }[]
      | null;
  };
  type SubmissionRow = {
    id: string;
    assignment_id: string;
    status: string;
    file_path: string | null;
    original_filename: string | null;
    file_size_bytes: number | null;
    submitted_at: string;
  };
  type InterviewRow = {
    id: string;
    assignment_id: string;
    status: string;
    current_state: string;
    started_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
  };

  const assignmentsQuery = () => {
    const q = sb
      .from("assignments")
      .select(
        `id, title, description, instructions, due_at, interview_duration_minutes, status, settings,
         course:courses ( id, name, code, lecturer_name )`,
      )
      .eq("status", "published");
    return opts.assignmentId
      ? q.eq("id", opts.assignmentId)
      : q.order("due_at", { ascending: true });
  };
  const relatedQueries = (ids: string[]) =>
    Promise.all([
      sb
        .from("submissions")
        .select("id, assignment_id, status, file_path, original_filename, file_size_bytes, submitted_at")
        .in("assignment_id", ids)
        .eq("student_id", userId),
      sb
        .from("interviews")
        .select("id, assignment_id, status, current_state, started_at, completed_at, duration_seconds")
        .in("assignment_id", ids)
        .eq("student_id", userId),
    ]);

  let assignments: AssignmentRow[];
  let submissions: SubmissionRow[];
  let interviews: InterviewRow[];
  if (opts.assignmentId) {
    const [{ data: assignmentsRaw, error }, [{ data: subs }, { data: ints }]] =
      await Promise.all([assignmentsQuery(), relatedQueries([opts.assignmentId])]);
    if (error || !assignmentsRaw) return [];
    assignments = assignmentsRaw as unknown as AssignmentRow[];
    submissions = (subs ?? []) as unknown as SubmissionRow[];
    interviews = (ints ?? []) as unknown as InterviewRow[];
  } else {
    const { data: assignmentsRaw, error } = await assignmentsQuery();
    if (error || !assignmentsRaw) return [];
    assignments = assignmentsRaw as unknown as AssignmentRow[];
    const ids = assignments.map((a) => a.id);
    if (ids.length === 0) return [];
    const [{ data: subs }, { data: ints }] = await relatedQueries(ids);
    submissions = (subs ?? []) as unknown as SubmissionRow[];
    interviews = (ints ?? []) as unknown as InterviewRow[];
  }

  const subByAssignment = new Map(
    submissions.map((s) => [s.assignment_id, s] as const),
  );
  const intByAssignment = new Map(
    interviews.map((i) => [i.assignment_id, i] as const),
  );

  return assignments.map((a) => {
    const courseRaw = a.course;
    const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
    const sub = subByAssignment.get(a.id);
    const status: StudentAssignmentStatus = projectAssignmentStatus(
      sub?.status as SubmissionStatus | undefined,
    );

    return {
      id: a.id,
      title: a.title,
      courseName: course?.name ?? "",
      courseCode: course?.code ?? "",
      lecturerName: course?.lecturer_name ?? "",
      description: a.description ?? "",
      instructions: a.instructions ?? "",
      dueAt: a.due_at ?? "",
      estimatedInterviewMinutes: a.interview_duration_minutes,
      topics: [],
      status,
      submissionId: sub?.id,
      interviewId: intByAssignment.get(a.id)?.id,
      badgeKind: deriveBadge(status),
      integrity: resolveIntegritySettings(a.settings, {
        personal: isPersonalCourseCode(course?.code),
      }),
    } satisfies StudentAssignment;
  });
}

export async function getStudentAssignmentsSb(
  sb: SbClient,
): Promise<StudentAssignment[]> {
  return loadAssignmentsSb(sb);
}

export async function getStudentDashboardSb(
  sb: SbClient,
): Promise<StudentDashboard | null> {
  // Profile and assignments don't depend on each other — fetch in parallel.
  const [profile, assignments] = await Promise.all([
    getStudentProfileSb(sb),
    getStudentAssignmentsSb(sb),
  ]);
  if (!profile) return null;
  const next = assignments.find((a) => a.status !== "completed");
  return { profile, assignments, next };
}

export async function getAssignmentByIdSb(
  sb: SbClient,
  assignmentId: string,
): Promise<StudentAssignment | null> {
  const [assignment] = await loadAssignmentsSb(sb, { assignmentId });
  return assignment ?? null;
}

export async function uploadAndCreateSubmissionSb(
  sb: SbClient,
  assignmentId: string,
  file: File,
): Promise<StudentSubmission> {
  const userId = await currentUserIdSb(sb);
  if (!userId) throw new Error("not_authenticated");

  const { data: existing } = await sb
    .from("submissions")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();

  let submissionId = existing?.id;
  if (!submissionId) {
    const { data: row, error } = await sb
      .from("submissions")
      .insert({
        assignment_id: assignmentId,
        student_id: userId,
        original_filename: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        status: "uploaded",
      })
      .select("*")
      .single();
    if (error || !row) throw error;
    submissionId = row.id;
  }

  const path = assignmentFilePath(submissionId!, file.name);
  await uploadToBucket(sb, STORAGE_BUCKETS.ASSIGNMENT_FILES, path, file, {
    contentType: file.type,
    upsert: true,
  });

  const { data: updated, error: updateErr } = await sb
    .from("submissions")
    .update({ file_path: path })
    .eq("id", submissionId!)
    .select("*")
    .single();
  if (updateErr || !updated) throw updateErr;

  return {
    id: updated.id,
    assignmentId: updated.assignment_id,
    studentId: updated.student_id,
    status: updated.status as SubmissionStatus,
    originalFilename: updated.original_filename ?? file.name,
    fileSizeBytes: Number(updated.file_size_bytes ?? file.size),
    submittedAt: updated.submitted_at,
  };
}

export async function getSubmissionStatusSb(
  sb: SbClient,
  submissionId: string,
): Promise<StudentSubmission | null> {
  const { data, error } = await sb
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .maybeSingle();
  if (error || !data) return null;
  return rowToSubmission(data);
}

export function subscribeToSubmissionSb(
  sb: SbClient,
  submissionId: string,
  observer: (s: StudentSubmission) => void,
): () => void {
  const channel = sb
    .channel(`submission:${submissionId}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "submissions",
        filter: `id=eq.${submissionId}`,
      },
      (payload) => {
        observer(rowToSubmission(payload.new as SubmissionRowFull));
      },
    )
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export async function getStudentHistorySb(
  sb: SbClient,
): Promise<StudentHistoryEntry[]> {
  type HistoryRow = {
    id: string;
    assignment_id: string;
    completed_at: string | null;
    duration_seconds: number | null;
    assignment?:
      | {
          title?: string;
          course?: { name?: string } | { name?: string }[] | null;
        }
      | { title?: string; course?: { name?: string } | { name?: string }[] | null }[]
      | null;
    submission?:
      | { submitted_at?: string }
      | { submitted_at?: string }[]
      | null;
  };

  const { data, error } = await sb
    .from("interviews")
    .select(
      `id, assignment_id, completed_at, duration_seconds,
       assignment:assignments ( title, course:courses ( name ) ),
       submission:submissions ( submitted_at )`,
    )
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  if (error || !data) return [];

  return (data as unknown as HistoryRow[]).map((row) => {
    const aRaw = row.assignment;
    const a = Array.isArray(aRaw) ? aRaw[0] : aRaw;
    const courseRaw = a?.course;
    const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
    const sRaw = row.submission;
    const s = Array.isArray(sRaw) ? sRaw[0] : sRaw;
    return {
      assignmentId: row.assignment_id,
      interviewId: row.id,
      title: a?.title ?? "",
      courseName: course?.name ?? "",
      uploadedAt: s?.submitted_at ?? row.completed_at ?? "",
      interviewedAt: row.completed_at ?? "",
      durationSeconds: Number(row.duration_seconds ?? 0),
    } satisfies StudentHistoryEntry;
  });
}

export async function getInterviewSb(
  sb: SbClient,
  interviewId: string,
): Promise<StudentInterview | null> {
  type InterviewRow = {
    id: string;
    submission_id: string;
    assignment_id: string;
    status: StudentInterview["status"];
    current_state: StudentInterview["currentState"];
    language: string | null;
    started_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
  };

  // The row and the outline are independent; one round trip for both. The
  // outline carries the question text only for a finished interview.
  const [{ data, error }, questions] = await Promise.all([
    sb
      .from("interviews")
      .select("id, submission_id, assignment_id, status, current_state, language, started_at, completed_at, duration_seconds")
      .eq("id", interviewId)
      .maybeSingle(),
    getInterviewOutlineSb(sb, interviewId),
  ]);
  if (error || !data) return null;
  const row = data as unknown as InterviewRow;

  return {
    id: row.id,
    submissionId: row.submission_id,
    assignmentId: row.assignment_id,
    status: row.status,
    currentState: row.current_state,
    language: normalizeInterviewLanguage(row.language),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
    topics: [],
    questions,
  };
}

export async function getInterviewWithAssignmentSb(
  sb: SbClient,
  interviewId: string,
): Promise<{ interview: StudentInterview; assignment: StudentAssignment } | null> {
  const interview = await getInterviewSb(sb, interviewId);
  if (!interview) return null;
  const assignment = await getAssignmentByIdSb(sb, interview.assignmentId);
  if (!assignment) return null;
  return { interview, assignment };
}

export async function getSubmissionLobbySb(
  sb: SbClient,
  submissionId: string,
): Promise<{
  submission: StudentSubmission;
  assignment: StudentAssignment;
  interview: StudentInterview;
} | null> {
  // The submission row and the interview-id lookup only need submissionId,
  // so they go out together; the assignment needs submission.assignmentId.
  const [submission, { data: interviewRow }] = await Promise.all([
    getSubmissionStatusSb(sb, submissionId),
    sb
      .from("interviews")
      .select("id")
      .eq("submission_id", submissionId)
      .maybeSingle(),
  ]);
  if (!submission) return null;
  const assignment = await getAssignmentByIdSb(sb, submission.assignmentId);
  if (!assignment) return null;
  let interview: StudentInterview | null = null;
  if (interviewRow?.id) {
    interview = await getInterviewSb(sb, interviewRow.id);
  }
  if (!interview) {
    interview = {
      id: "",
      submissionId,
      assignmentId: submission.assignmentId,
      status: "ready",
      currentState: "idle",
      language: "he",
      topics: [],
      questions: [],
    };
  }
  return { submission, assignment, interview };
}

export interface StudentReport {
  id: string;
  submissionId: string;
  interviewId: string;
  overallLevel: "low" | "medium" | "medium_high" | "high" | null;
  overallScore: number | null;
  rubric: {
    conceptual?: number;
    reasoning?: number;
    communication?: number;
    evidence?: number;
  } | null;
  summary: string | null;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  evidence: string[];
  gaps: string[];
  status: "draft" | "ready" | "reviewed" | "flagged";
}

interface RecommendationEntry {
  kind?: "strength" | "weakness" | "recommendation";
  text?: string;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
}

export async function getReportForInterviewSb(
  sb: SbClient,
  interviewId: string,
): Promise<StudentReport | null> {
  const { data, error } = await sb
    .from("reports")
    .select("*")
    .eq("interview_id", interviewId)
    .maybeSingle();
  if (error || !data) return null;

  const rubric = (data.rubric_result ?? null) as
    | (StudentReport["rubric"] & { overall_score?: number })
    | null;
  const overallScore =
    rubric && typeof rubric.overall_score === "number"
      ? rubric.overall_score
      : null;

  const recsRaw = Array.isArray(data.recommendations)
    ? (data.recommendations as RecommendationEntry[])
    : [];
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];
  for (const item of recsRaw) {
    if (!item || typeof item !== "object" || typeof item.text !== "string")
      continue;
    if (item.kind === "strength") strengths.push(item.text);
    else if (item.kind === "weakness") weaknesses.push(item.text);
    else recommendations.push(item.text);
  }

  return {
    id: data.id,
    submissionId: data.submission_id,
    interviewId: data.interview_id,
    overallLevel: data.overall_level ?? null,
    overallScore,
    rubric,
    summary: data.summary ?? null,
    strengths,
    weaknesses,
    recommendations,
    evidence: asStringList(data.evidence),
    gaps: asStringList(data.gaps),
    status: data.status,
  };
}

export async function prepareSubmissionInvokeSb(
  sb: SbClient,
  submissionId: string,
): Promise<{ interviewId: string }> {
  const { data, error } = await sb.functions.invoke<
    | { ok: true; submissionId: string; interviewId: string; skipped?: boolean }
    | { ok: false; error: string }
  >("prepare-submission", { body: { submissionId } });
  if (error) throw new Error(`prepare_submission_invoke: ${error.message}`);
  if (!data || !("ok" in data) || !data.ok) {
    throw new Error(
      data && "error" in data ? data.error : "prepare_submission_unknown_error",
    );
  }
  return { interviewId: data.interviewId };
}

export async function completeInterviewInvokeSb(
  sb: SbClient,
  interviewId: string,
  durationSeconds: number,
): Promise<{ ok: true }> {
  const { data, error } = await sb.functions.invoke<
    { ok: true } | { ok: false; error: string }
  >("complete-interview", { body: { interviewId, durationSeconds } });
  if (error) throw new Error(`complete_interview_invoke: ${error.message}`);
  if (!data || !("ok" in data) || !data.ok) {
    throw new Error(
      data && "error" in data ? data.error : "complete_interview_unknown_error",
    );
  }
  return { ok: true };
}

export async function saveInterviewMessageInvokeSb(
  sb: SbClient,
  input: {
    interviewId: string;
    speaker: "ai_host" | "student" | "system";
    messageType: "question" | "answer" | "followup" | "system" | "summary";
    content: string;
    planQuestionId?: string | null;
    clientId?: string;
    startedAt?: string;
    endedAt?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: boolean }> {
  const { data, error } = await sb.functions.invoke<
    { ok: true; messageId: string } | { ok: false; error: string }
  >("save-interview-message", { body: input });
  if (error) return { ok: false };
  return { ok: !!(data && "ok" in data && data.ok) };
}

// -----------------------------------------------------------------------------
// Interview control (server-side state changes) + integrity telemetry
// -----------------------------------------------------------------------------

interface StartResponse {
  ok: boolean;
  error?: string;
  status?: string;
  resumed?: boolean;
  attempt?: number;
  outline?: { id: string; topic: string; kind?: string | null; recommendedSeconds?: number }[];
  resume?: { lastQuestionIndex: number; answeredQuestionIds: string[] };
  settings?: IntegritySettings;
}

/**
 * ready -> in_progress through `interview-control`, or a resume of a running
 * interview. Returns the outline (no question text), the resolved integrity
 * settings and where to continue from.
 */
export async function startInterviewSb(
  sb: SbClient,
  interviewId: string,
): Promise<InterviewStartOutcome> {
  const { status, data } = await callEdge<StartResponse>(sb, "interview-control", {
    action: "start",
    interviewId,
  });
  if (data?.ok) {
    return {
      ok: true,
      resumed: data.resumed === true,
      attempt: typeof data.attempt === "number" ? data.attempt : 1,
      questions: (data.outline ?? []).map((q) => ({
        id: q.id,
        topic: q.topic ?? "",
        question: "",
        recommendedSeconds: q.recommendedSeconds ?? 75,
        kind: q.kind ?? null,
      })),
      settings:
        data.settings ?? resolveIntegritySettings(null, { personal: false }),
      resume: data.resume ?? { lastQuestionIndex: -1, answeredQuestionIds: [] },
    };
  }
  const code = data?.error;
  if (status === 404) return { ok: false, error: "not_found" };
  if (
    code === "consent_required" ||
    code === "interview_completed" ||
    code === "interview_unavailable" ||
    code === "assignment_closed" ||
    code === "plan_missing"
  ) {
    return { ok: false, error: code };
  }
  return { ok: false, error: "unknown" };
}

export async function recordConsentSb(
  sb: SbClient,
  interviewId: string,
  version: string,
  locale: string,
): Promise<boolean> {
  const { data } = await callEdge<{ ok: boolean }>(sb, "interview-control", {
    action: "consent",
    interviewId,
    version,
    locale,
  });
  return data?.ok === true;
}

export async function recordIntegrityEventsSb(
  sb: SbClient,
  interviewId: string,
  events: IntegrityClientEvent[],
  opts: { keepalive?: boolean } = {},
): Promise<void> {
  if (events.length === 0) return;
  await callEdge(sb, "interview-control", { action: "events", interviewId, events }, opts);
}

export async function recordInterviewFlagSb(
  sb: SbClient,
  interviewId: string,
  flag: HostFlagInput,
): Promise<boolean> {
  const { data } = await callEdge<{ ok: boolean }>(sb, "interview-control", {
    action: "flag",
    interviewId,
    flag,
  });
  return data?.ok === true;
}

export async function recordDisconnectSb(
  sb: SbClient,
  interviewId: string,
  reason: string,
  planQuestionId: string | null,
): Promise<void> {
  await callEdge(
    sb,
    "interview-control",
    { action: "disconnect", interviewId, reason, planQuestionId },
    { keepalive: true },
  );
}

/**
 * The stored text of the student's own submission (their RLS lets them read
 * it), used by the room's live "in your own words" check. For a PDF this is
 * a model rendering, not the exact text; `exact` says which.
 */
export async function getDocumentTextSb(
  sb: SbClient,
  submissionId: string,
): Promise<{ text: string; exact: boolean } | null> {
  const { data, error } = await sb
    .from("document_parses")
    .select("markdown, metadata")
    .eq("submission_id", submissionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.markdown) return null;
  const source = (data.metadata as { source?: string } | null)?.source;
  return { text: data.markdown, exact: source === "raw_text" };
}

export async function getInterviewTranscriptSb(
  sb: SbClient,
  interviewId: string,
): Promise<InterviewTranscript> {
  const [{ data: messages }, outline] = await Promise.all([
    sb
      .from("interview_messages")
      .select("speaker, content, plan_question_id, created_at")
      .eq("interview_id", interviewId)
      .order("created_at", { ascending: true }),
    getInterviewOutlineSb(sb, interviewId),
  ]);

  type Row = {
    speaker: "ai_host" | "student" | "system";
    content: string | null;
    plan_question_id: string | null;
    created_at: string;
  };

  const rows = (messages as Row[] | null) ?? [];
  const filtered = rows
    .filter((r) => typeof r.content === "string" && r.content.trim().length > 0)
    .map((r) => ({
      speaker: r.speaker,
      content: (r.content as string).trim(),
      planQuestionId: r.plan_question_id,
      createdAt: r.created_at,
    }));

  const plan = outline.map((q) => ({
    id: q.id,
    topic: q.topic,
    question: q.question,
  }));

  return { messages: filtered, plan };
}

/**
 * Stores the language the student picked in the lobby. Only interviews that
 * have not started yet accept it (a running session was minted with the old
 * language and would not follow). Returns false when nothing was updated.
 */
export async function setInterviewLanguageSb(
  sb: SbClient,
  interviewId: string,
  language: InterviewLanguage,
): Promise<boolean> {
  const { data, error } = await sb
    .from("interviews")
    .update({ language })
    .eq("id", interviewId)
    .in("status", ["created", "ready"])
    .select("id");
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

export async function uploadSelfInitiatedFileSb(
  sb: SbClient,
  file: File,
): Promise<{ assignmentId: string; submission: StudentSubmission }> {
  if (!(await currentUserIdSb(sb))) throw new Error("not_authenticated");

  const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[_\-]+/g, " ").trim();
  const title = baseName ? baseName.charAt(0).toUpperCase() + baseName.slice(1) : "Personal task";
  const lang = "he";

  const { data: assignmentId, error: rpcErr } = await sb.rpc(
    "create_personal_assignment",
    { p_title: title, p_language: lang },
  );
  if (rpcErr || !assignmentId) {
    throw new Error(rpcErr?.message ?? "create_personal_assignment_failed");
  }

  const submission = await uploadAndCreateSubmissionSb(sb, assignmentId, file);
  return { assignmentId, submission };
}
