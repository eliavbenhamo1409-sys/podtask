/**
 * Public student-service surface used by every page/component.
 *
 * This module dispatches to one of two backends:
 *   - **mock**: in-memory data driven by ./mock-data + a local timer
 *     simulator. Used for the demo IDs (`a1`–`a4`, `int-a4`, `sub-a4`,
 *     `self-…`) so the showcase walkthrough never hits the network.
 *   - **supabase**: real Postgres data + Edge Functions, via
 *     ./student-service-supabase.ts. This is the path students hit in
 *     production when `NEXT_PUBLIC_MOCK_MODE=false`.
 *
 * The dispatcher picks per-call: real mode is engaged when the env var is
 * disabled AND the id (when supplied) is a real UUID. Anything else falls
 * back to mock so the demo never regresses. Anonymous Supabase sessions
 * (sign-in from the login screen) use this real path with a valid `auth.uid`.
 */

import {
  MOCK_ASSIGNMENTS,
  MOCK_HISTORY,
  MOCK_INTERVIEWS,
  MOCK_INTERVIEW_QUESTIONS,
  MOCK_PROFILE,
  MOCK_SUBMISSIONS,
  findMockAssignment,
  findMockInterview,
  findMockSubmission,
  makeMockDashboard,
} from "./mock-data";
import { SUBMISSION_PROCESSING_ORDER } from "./status";
import type {
  InterviewTranscript,
  StudentAssignment,
  StudentDashboard,
  StudentHistoryEntry,
  StudentInterview,
  StudentInterviewQuestion,
  StudentProfile,
  StudentSubmission,
} from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

// =============================================================================
// Mode + id helpers
// =============================================================================

const MOCK_MODE_ENV =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_MOCK_MODE !== "false";

const UUID_RE = /^[0-9a-f-]{36}$/i;

export function isMockMode() {
  return MOCK_MODE_ENV;
}

function isUuid(id: string) {
  return UUID_RE.test(id);
}

/**
 * Returns true if we should run the real Supabase pipeline for this id. A
 * non-UUID id (e.g. demo `int-a4`) always stays on mock so the showcase
 * keeps working even with `NEXT_PUBLIC_MOCK_MODE=false`.
 *
 * Named so eslint-plugin-react-hooks doesn't think it's a hook.
 */
function shouldUseRealBackend(id?: string): boolean {
  if (MOCK_MODE_ENV) return false;
  if (id !== undefined && !isUuid(id)) return false;
  return true;
}

type SbClient = SupabaseClient<Database>;

/**
 * Browser-only supabase-client factory. Server components cannot reach this
 * path because it would force `next/headers` into the client bundle —
 * server components use {@link student-service-server.ts} instead, which
 * imports the cookie-bound server client.
 *
 * If a server context ends up calling this (no `window`), we throw so the
 * caller knows to switch to the server-side service module rather than
 * silently downgrading to an unauthenticated request.
 */
async function getSb(): Promise<SbClient> {
  if (typeof window === "undefined") {
    throw new Error(
      "student_service_server_call: import from '@/lib/student/student-service-server' in server components",
    );
  }
  const mod = await import("@/lib/supabase/client");
  return mod.createClient() as unknown as SbClient;
}

// =============================================================================
// Mock helpers (preserved from the original file)
// =============================================================================

function ensureSelfInitiatedAssignment(
  assignmentId: string,
): StudentAssignment | undefined {
  const existing = findMockAssignment(assignmentId);
  if (existing) return existing;
  if (!assignmentId.startsWith("self-")) return undefined;

  const synthesized: StudentAssignment = {
    id: assignmentId,
    title: "משימה יזומה",
    courseName: "Podtask",
    courseCode: "SELF",
    lecturerName: "—",
    description: "",
    instructions: "",
    dueAt: new Date().toISOString(),
    estimatedInterviewMinutes: 12,
    topics: [],
    status: "processing",
    badgeKind: "next",
  };
  MOCK_ASSIGNMENTS.push(synthesized);
  return synthesized;
}

function findOrRecoverSubmission(
  submissionId: string,
): StudentSubmission | undefined {
  const existing = findMockSubmission(submissionId);
  if (existing) return existing;
  if (!submissionId.startsWith("sub-")) return undefined;

  const tail = submissionId.slice("sub-".length);
  const stripped = tail.replace(/-\d+$/, "");
  const candidates = stripped !== tail ? [tail, stripped] : [tail];

  for (const assignmentId of candidates) {
    const assignment =
      findMockAssignment(assignmentId) ??
      ensureSelfInitiatedAssignment(assignmentId);
    if (!assignment) continue;

    const synthesized: StudentSubmission = {
      id: submissionId,
      assignmentId,
      studentId: MOCK_PROFILE.id,
      status: "interview_ready",
      originalFilename: "draft.pdf",
      fileSizeBytes: 0,
      submittedAt: new Date().toISOString(),
    };
    MOCK_SUBMISSIONS.push(synthesized);
    if (assignment.submissionId !== submissionId) {
      assignment.submissionId = submissionId;
      if (assignment.status !== "completed") {
        assignment.status = "ready_for_interview";
      }
    }
    return synthesized;
  }
  return undefined;
}

function deriveTitleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[_\-]+/g, " ").trim();
  if (!cleaned) return "משימה יזומה";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

const inFlightSubmissions = new Map<string, StudentSubmission>();
const inFlightInterviews = new Map<string, StudentInterview>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// Public API — dispatches to mock or supabase based on mode + id shape
// =============================================================================

export async function getStudentDashboard(): Promise<StudentDashboard> {
  if (shouldUseRealBackend()) {
    const { getStudentDashboardSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    const real = await getStudentDashboardSb(sb);
    if (real) return real;
  }
  return makeMockDashboard();
}

export async function getStudentProfile(): Promise<StudentProfile> {
  if (shouldUseRealBackend()) {
    const { getStudentProfileSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    const real = await getStudentProfileSb(sb);
    if (real) return real;
  }
  return MOCK_PROFILE;
}

export async function getStudentAssignments(): Promise<StudentAssignment[]> {
  if (shouldUseRealBackend()) {
    const { getStudentAssignmentsSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getStudentAssignmentsSb(sb);
  }
  return MOCK_ASSIGNMENTS;
}

export async function getAssignmentById(
  assignmentId: string,
): Promise<StudentAssignment | null> {
  if (shouldUseRealBackend(assignmentId)) {
    const { getAssignmentByIdSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getAssignmentByIdSb(sb, assignmentId);
  }
  return findMockAssignment(assignmentId) ?? null;
}

// -----------------------------------------------------------------------------
// Uploads
// -----------------------------------------------------------------------------

export interface UploadResult {
  submission: StudentSubmission;
}

export async function createSubmission(
  assignmentId: string,
  file: { name: string; size: number; type: string },
): Promise<UploadResult> {
  // Mock-only path used by tests; real uploads go through uploadAssignmentFile.
  const id = `sub-${assignmentId}-${Date.now()}`;
  const submission: StudentSubmission = {
    id,
    assignmentId,
    studentId: MOCK_PROFILE.id,
    status: "uploaded",
    originalFilename: file.name,
    fileSizeBytes: file.size,
    submittedAt: new Date().toISOString(),
  };
  inFlightSubmissions.set(id, submission);
  MOCK_SUBMISSIONS.push(submission);

  const assignment = findMockAssignment(assignmentId);
  if (assignment) {
    assignment.submissionId = id;
    assignment.status = "processing";
  }
  return { submission };
}

export async function uploadAssignmentFile(
  assignmentId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResult> {
  if (shouldUseRealBackend(assignmentId)) {
    const { uploadAndCreateSubmissionSb, prepareSubmissionInvokeSb } =
      await import("./student-service-supabase");
    const sb = await getSb();
    onProgress?.(15);
    const submission = await uploadAndCreateSubmissionSb(sb, assignmentId, file);
    onProgress?.(80);
    // Fire-and-forget: kick off processing so the /processing page sees the
    // status transitions from `uploaded` -> ... -> `interview_ready`.
    void prepareSubmissionInvokeSb(sb, submission.id).catch(() => {
      // Errors surface via submission.status='failed' in the UI.
    });
    onProgress?.(100);
    return { submission };
  }

  for (let p = 0; p <= 100; p += 10) {
    onProgress?.(p);
    await delay(60);
  }
  return createSubmission(assignmentId, {
    name: file.name,
    size: file.size,
    type: file.type,
  });
}

export interface SelfInitiatedResult {
  assignment: StudentAssignment;
  submission: StudentSubmission;
}

export async function createSelfInitiatedTask(file: {
  name: string;
  size: number;
  type: string;
}): Promise<SelfInitiatedResult> {
  // Mock-only path; the real self-initiated upload lives in
  // uploadSelfInitiatedFile so it can also do the actual file upload.
  const ts = Date.now();
  const assignmentId = `self-${ts}`;
  const submissionId = `sub-${assignmentId}`;

  const assignment: StudentAssignment = {
    id: assignmentId,
    title: deriveTitleFromFilename(file.name),
    courseName: "Podtask",
    courseCode: "SELF",
    lecturerName: "—",
    description: "",
    instructions: "",
    dueAt: new Date(ts).toISOString(),
    estimatedInterviewMinutes: 12,
    topics: [],
    status: "processing",
    badgeKind: "next",
    submissionId,
  };
  const submission: StudentSubmission = {
    id: submissionId,
    assignmentId,
    studentId: MOCK_PROFILE.id,
    status: "uploaded",
    originalFilename: file.name,
    fileSizeBytes: file.size,
    submittedAt: new Date(ts).toISOString(),
  };
  MOCK_ASSIGNMENTS.push(assignment);
  MOCK_SUBMISSIONS.push(submission);
  inFlightSubmissions.set(submissionId, submission);

  return { assignment, submission };
}

export async function uploadSelfInitiatedFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<SelfInitiatedResult> {
  if (shouldUseRealBackend()) {
    const {
      uploadSelfInitiatedFileSb,
      prepareSubmissionInvokeSb,
      getAssignmentByIdSb,
    } = await import("./student-service-supabase");
    const sb = await getSb();
    onProgress?.(15);
    const { assignmentId, submission } = await uploadSelfInitiatedFileSb(sb, file);
    onProgress?.(80);
    void prepareSubmissionInvokeSb(sb, submission.id).catch(() => {});
    const assignment =
      (await getAssignmentByIdSb(sb, assignmentId)) ?? {
        id: assignmentId,
        title: deriveTitleFromFilename(file.name),
        courseName: "Personal",
        courseCode: "PERSONAL",
        lecturerName: "Self-directed",
        description: "",
        instructions: "",
        dueAt: new Date().toISOString(),
        estimatedInterviewMinutes: 12,
        topics: [],
        status: "processing",
        badgeKind: "next",
        submissionId: submission.id,
      };
    onProgress?.(100);
    return { assignment, submission };
  }

  for (let p = 0; p <= 100; p += 10) {
    onProgress?.(p);
    await delay(60);
  }
  return createSelfInitiatedTask({
    name: file.name,
    size: file.size,
    type: file.type,
  });
}

// -----------------------------------------------------------------------------
// Submission processing
// -----------------------------------------------------------------------------

export async function prepareSubmission(
  submissionId: string,
): Promise<{ submissionId: string; interviewId: string }> {
  if (shouldUseRealBackend(submissionId)) {
    const { prepareSubmissionInvokeSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    const { interviewId } = await prepareSubmissionInvokeSb(sb, submissionId);
    return { submissionId, interviewId };
  }

  const submission = findOrRecoverSubmission(submissionId);
  if (!submission) throw new Error("submission_not_found");

  const interviewId =
    submission.interviewId ?? `int-${submission.assignmentId}-${Date.now()}`;
  submission.interviewId = interviewId;

  let interview = inFlightInterviews.get(interviewId);
  if (!interview) {
    interview = {
      id: interviewId,
      submissionId,
      assignmentId: submission.assignmentId,
      status: "ready",
      currentState: "idle",
      topics: findMockAssignment(submission.assignmentId)?.topics ?? [],
      questions: MOCK_INTERVIEW_QUESTIONS as StudentInterviewQuestion[],
    };
    inFlightInterviews.set(interviewId, interview);
    MOCK_INTERVIEWS.push(interview);
  }

  return { submissionId, interviewId };
}

export async function getSubmissionStatus(
  submissionId: string,
): Promise<StudentSubmission | null> {
  if (shouldUseRealBackend(submissionId)) {
    const { getSubmissionStatusSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getSubmissionStatusSb(sb, submissionId);
  }
  return findOrRecoverSubmission(submissionId) ?? null;
}

export type ProcessingObserver = (submission: StudentSubmission) => void;

/**
 * Watches a submission as it walks the parsing → interview_ready pipeline.
 * Real mode wires up Postgres realtime (`subscribeToSubmissionSb`) and falls
 * back to a 1500ms polling loop in case realtime delivery lags. Mock mode
 * runs the legacy timer simulator unchanged.
 */
export function observeSubmissionProcessing(
  submissionId: string,
  observer: ProcessingObserver,
): () => void {
  if (shouldUseRealBackend(submissionId)) {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      const { getSubmissionStatusSb, subscribeToSubmissionSb } = await import(
        "./student-service-supabase"
      );
      const sb = await getSb();

      const initial = await getSubmissionStatusSb(sb, submissionId);
      if (cancelled) return;
      if (initial) observer(initial);

      unsubscribe = subscribeToSubmissionSb(sb, submissionId, (sub) => {
        if (cancelled) return;
        observer(sub);
      });

      pollTimer = setInterval(async () => {
        if (cancelled) return;
        const fresh = await getSubmissionStatusSb(sb, submissionId);
        if (fresh && !cancelled) observer(fresh);
      }, 1500);
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (unsubscribe) unsubscribe();
    };
  }

  const submission = findOrRecoverSubmission(submissionId);
  if (!submission) {
    return () => {};
  }

  let cancelled = false;
  let stepIdx = SUBMISSION_PROCESSING_ORDER.indexOf(submission.status);
  if (stepIdx < 0) stepIdx = 0;

  const tick = async () => {
    while (!cancelled && stepIdx < SUBMISSION_PROCESSING_ORDER.length - 1) {
      await delay(1700);
      if (cancelled) return;
      stepIdx += 1;
      submission.status = SUBMISSION_PROCESSING_ORDER[stepIdx];
      observer({ ...submission });
    }
    if (!cancelled && submission.status === "interview_ready") {
      await prepareSubmission(submissionId);
      observer({ ...submission });
    }
  };

  observer({ ...submission });
  void tick();

  return () => {
    cancelled = true;
  };
}

export async function getSubmissionLobby(submissionId: string): Promise<{
  submission: StudentSubmission;
  assignment: StudentAssignment;
  interview: StudentInterview;
} | null> {
  if (shouldUseRealBackend(submissionId)) {
    const { getSubmissionLobbySb, prepareSubmissionInvokeSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    let lobby = await getSubmissionLobbySb(sb, submissionId);
    if (lobby && lobby.interview.id === "") {
      // Submission exists but no interview yet — kick off processing once
      // and re-read.
      try {
        await prepareSubmissionInvokeSb(sb, submissionId);
      } catch {
        // Best-effort; we'll reflect the failure via submission.status.
      }
      lobby = await getSubmissionLobbySb(sb, submissionId);
    }
    return lobby;
  }

  const submission = findOrRecoverSubmission(submissionId);
  if (!submission) return null;
  const assignment = findMockAssignment(submission.assignmentId);
  if (!assignment) return null;

  if (!submission.interviewId) {
    await prepareSubmission(submissionId);
  }
  const interview = findMockInterview(submission.interviewId!);
  if (!interview) return null;

  return { submission, assignment, interview };
}

// -----------------------------------------------------------------------------
// Interview lifecycle
// -----------------------------------------------------------------------------

export async function getInterview(
  interviewId: string,
): Promise<StudentInterview | null> {
  if (shouldUseRealBackend(interviewId)) {
    const { getInterviewSb } = await import("./student-service-supabase");
    const sb = await getSb();
    return await getInterviewSb(sb, interviewId);
  }
  return findMockInterview(interviewId) ?? null;
}

export async function getInterviewWithAssignment(interviewId: string) {
  if (shouldUseRealBackend(interviewId)) {
    const { getInterviewWithAssignmentSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getInterviewWithAssignmentSb(sb, interviewId);
  }
  const interview = findMockInterview(interviewId);
  if (!interview) return null;
  const assignment = findMockAssignment(interview.assignmentId);
  if (!assignment) return null;
  return { interview, assignment };
}

export async function startInterview(
  interviewId: string,
): Promise<StudentInterview | null> {
  if (shouldUseRealBackend(interviewId)) {
    const { startInterviewSb } = await import("./student-service-supabase");
    const sb = await getSb();
    return await startInterviewSb(sb, interviewId);
  }
  const interview = findMockInterview(interviewId);
  if (!interview) return null;
  interview.status = "in_progress";
  interview.startedAt = new Date().toISOString();
  interview.currentState = "host_intro";
  if (interview.questions.length === 0) {
    interview.questions = MOCK_INTERVIEW_QUESTIONS as StudentInterviewQuestion[];
  }
  return interview;
}

export async function completeInterview(
  interviewId: string,
  durationSeconds: number,
): Promise<StudentInterview | null> {
  if (shouldUseRealBackend(interviewId)) {
    const { completeInterviewInvokeSb, getInterviewSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    try {
      await completeInterviewInvokeSb(sb, interviewId, durationSeconds);
    } catch {
      // Even if the edge call fails, return the latest server view so the
      // /complete page can render. The error has already been logged
      // server-side via system_events.
    }
    return await getInterviewSb(sb, interviewId);
  }

  const interview = findMockInterview(interviewId);
  if (!interview) return null;
  interview.status = "completed";
  interview.completedAt = new Date().toISOString();
  interview.durationSeconds = durationSeconds;
  interview.currentState = "completed";

  const submission = findMockSubmission(interview.submissionId);
  if (submission) {
    submission.status = "interview_completed";
  }
  const assignment = findMockAssignment(interview.assignmentId);
  if (assignment) {
    assignment.status = "completed";
    assignment.badgeKind = "done";
  }
  return interview;
}

export async function saveInterviewMessage(input: {
  interviewId: string;
  speaker: "ai_host" | "student" | "system";
  messageType: "question" | "answer" | "followup" | "system" | "summary";
  content: string;
  planQuestionId?: string | null;
}): Promise<{ ok: boolean }> {
  if (shouldUseRealBackend(input.interviewId)) {
    const { saveInterviewMessageInvokeSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await saveInterviewMessageInvokeSb(sb, input);
  }
  return { ok: true };
}

// -----------------------------------------------------------------------------
// History + reports
// -----------------------------------------------------------------------------

export async function getStudentHistory(): Promise<StudentHistoryEntry[]> {
  if (shouldUseRealBackend()) {
    const { getStudentHistorySb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getStudentHistorySb(sb);
  }
  return MOCK_HISTORY;
}

export async function getInterviewTranscript(
  interviewId: string,
): Promise<InterviewTranscript> {
  if (shouldUseRealBackend(interviewId)) {
    const { getInterviewTranscriptSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getInterviewTranscriptSb(sb, interviewId);
  }
  return { messages: [], plan: [] };
}

export async function getReportForInterview(interviewId: string) {
  if (shouldUseRealBackend(interviewId)) {
    const { getReportForInterviewSb } = await import(
      "./student-service-supabase"
    );
    const sb = await getSb();
    return await getReportForInterviewSb(sb, interviewId);
  }
  return null;
}

export async function runMicPermissionCheck(): Promise<"granted" | "denied"> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return "denied";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch {
    return "denied";
  }
}
