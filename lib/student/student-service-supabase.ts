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
import type {
  InterviewTranscript,
  StudentAssignment,
  StudentDashboard,
  StudentHistoryEntry,
  StudentInterview,
  StudentProfile,
  StudentSubmission,
} from "./types";
import type {
  StudentAssignmentStatus,
  SubmissionStatus,
} from "./status";

type SbClient = SupabaseClient<Database>;

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
  const { data: user } = await sb.auth.getUser();
  if (!user.user) return null;
  const { data, error } = await sb
    .from("profiles")
    .select("*, institution:institutions ( name )")
    .eq("id", user.user.id)
    .maybeSingle();
  if (error || !data) return null;
  return rowToProfile(data as unknown as ProfileRow);
}

export async function getStudentAssignmentsSb(
  sb: SbClient,
): Promise<StudentAssignment[]> {
  const { data: user } = await sb.auth.getUser();
  if (!user.user) return [];

  type AssignmentRow = {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    due_at: string | null;
    interview_duration_minutes: number;
    status: string;
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

  const { data: assignmentsRaw, error } = await sb
    .from("assignments")
    .select(
      `id, title, description, instructions, due_at, interview_duration_minutes, status,
       course:courses ( id, name, code, lecturer_name )`,
    )
    .eq("status", "published")
    .order("due_at", { ascending: true });
  if (error || !assignmentsRaw) return [];
  const assignments = assignmentsRaw as unknown as AssignmentRow[];

  const ids = assignments.map((a) => a.id);
  if (ids.length === 0) return [];

  const { data: submissionsRaw } = await sb
    .from("submissions")
    .select("id, assignment_id, status, file_path, original_filename, file_size_bytes, submitted_at")
    .in("assignment_id", ids)
    .eq("student_id", user.user.id);
  const submissions = (submissionsRaw ?? []) as unknown as SubmissionRow[];

  const subByAssignment = new Map(
    submissions.map((s) => [s.assignment_id, s] as const),
  );

  const { data: interviewsRaw } = await sb
    .from("interviews")
    .select("id, assignment_id, status, current_state, started_at, completed_at, duration_seconds")
    .in("assignment_id", ids)
    .eq("student_id", user.user.id);
  const interviews = (interviewsRaw ?? []) as unknown as InterviewRow[];

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
    } satisfies StudentAssignment;
  });
}

export async function getStudentDashboardSb(
  sb: SbClient,
): Promise<StudentDashboard | null> {
  const profile = await getStudentProfileSb(sb);
  if (!profile) return null;
  const assignments = await getStudentAssignmentsSb(sb);
  const next = assignments.find((a) => a.status !== "completed");
  return { profile, assignments, next };
}

export async function getAssignmentByIdSb(
  sb: SbClient,
  assignmentId: string,
): Promise<StudentAssignment | null> {
  const list = await getStudentAssignmentsSb(sb);
  return list.find((a) => a.id === assignmentId) ?? null;
}

export async function uploadAndCreateSubmissionSb(
  sb: SbClient,
  assignmentId: string,
  file: File,
): Promise<StudentSubmission> {
  const { data: user } = await sb.auth.getUser();
  if (!user.user) throw new Error("not_authenticated");

  const { data: existing } = await sb
    .from("submissions")
    .select("*")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.user.id)
    .maybeSingle();

  let submissionId = existing?.id;
  if (!submissionId) {
    const { data: row, error } = await sb
      .from("submissions")
      .insert({
        assignment_id: assignmentId,
        student_id: user.user.id,
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
  type InterviewWithPlan = {
    id: string;
    submission_id: string;
    assignment_id: string;
    status: StudentInterview["status"];
    current_state: StudentInterview["currentState"];
    started_at: string | null;
    completed_at: string | null;
    duration_seconds: number | null;
    plan?:
      | { plan: unknown }
      | { plan: unknown }[]
      | null;
  };

  const { data, error } = await sb
    .from("interviews")
    .select(
      `*, plan:interview_plans ( plan )`,
    )
    .eq("id", interviewId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as InterviewWithPlan;

  const planRow = row.plan;
  const planObj = Array.isArray(planRow) ? planRow[0] : planRow;
  const plan = (planObj?.plan ?? null) as
    | { questions?: { id: string; topic: string; question: string; recommended_seconds?: number }[] }
    | null;

  return {
    id: row.id,
    submissionId: row.submission_id,
    assignmentId: row.assignment_id,
    status: row.status,
    currentState: row.current_state,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
    topics: [],
    questions:
      plan?.questions?.map((q) => ({
        id: q.id,
        topic: q.topic,
        question: q.question,
        recommendedSeconds: q.recommended_seconds ?? 120,
      })) ?? [],
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
  const submission = await getSubmissionStatusSb(sb, submissionId);
  if (!submission) return null;
  const assignment = await getAssignmentByIdSb(sb, submission.assignmentId);
  if (!assignment) return null;

  const { data: interviewRow } = await sb
    .from("interviews")
    .select("id")
    .eq("submission_id", submissionId)
    .maybeSingle();
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
  },
): Promise<{ ok: boolean }> {
  const { data, error } = await sb.functions.invoke<
    { ok: true; messageId: string } | { ok: false; error: string }
  >("save-interview-message", { body: input });
  if (error) return { ok: false };
  return { ok: !!(data && "ok" in data && data.ok) };
}

export async function getInterviewTranscriptSb(
  sb: SbClient,
  interviewId: string,
): Promise<InterviewTranscript> {
  const [{ data: messages }, { data: planRow }] = await Promise.all([
    sb
      .from("interview_messages")
      .select("speaker, content, plan_question_id, created_at")
      .eq("interview_id", interviewId)
      .order("created_at", { ascending: true }),
    sb
      .from("interview_plans")
      .select("plan")
      .eq("interview_id", interviewId)
      .maybeSingle(),
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

  const planObj = (planRow?.plan ?? null) as
    | { questions?: { id: string; topic: string; question: string }[] }
    | null;
  const plan =
    planObj?.questions?.map((q) => ({
      id: q.id,
      topic: q.topic,
      question: q.question,
    })) ?? [];

  return { messages: filtered, plan };
}

export async function startInterviewSb(
  sb: SbClient,
  interviewId: string,
): Promise<StudentInterview | null> {
  await sb
    .from("interviews")
    .update({
      status: "in_progress",
      current_state: "host_intro",
      started_at: new Date().toISOString(),
    })
    .eq("id", interviewId);
  return getInterviewSb(sb, interviewId);
}

export async function uploadSelfInitiatedFileSb(
  sb: SbClient,
  file: File,
): Promise<{ assignmentId: string; submission: StudentSubmission }> {
  const { data: user } = await sb.auth.getUser();
  if (!user.user) throw new Error("not_authenticated");

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
