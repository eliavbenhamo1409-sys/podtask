/**
 * The four status vocabularies of the student pipeline, mirrored by hand from
 * the Postgres enums in `lib/supabase/database.types.ts` (keep in sync):
 *
 *  - `SubmissionStatus`         — `submissions.status`, written by the edge functions.
 *  - `InterviewStatus`          — `interviews.status`, lifecycle of the interview row.
 *  - `InterviewRuntimeState`    — the browser FSM in `lib/realtime/interview-session.ts`.
 *  - `StudentAssignmentStatus`  — derived (never stored) card status; the mapping
 *    from submission status lives in `projectAssignmentStatus`
 *    (`student-service-supabase.ts`), routing in `routing.ts`.
 *
 * See ARCHITECTURE.md §2 for the derivation rules.
 */
export const STUDENT_ASSIGNMENT_STATUS = [
  "not_started",
  "upload_required",
  "processing",
  "ready_for_interview",
  "mic_test_required",
  "interview_in_progress",
  "completed",
  "failed",
] as const;
export type StudentAssignmentStatus =
  (typeof STUDENT_ASSIGNMENT_STATUS)[number];

export const SUBMISSION_STATUS = [
  "uploaded",
  "parsing",
  "parsed",
  "analyzing",
  "analysis_ready",
  "interview_ready",
  "interview_completed",
  "report_ready",
  "failed",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[number];

export const INTERVIEW_STATUS = [
  "created",
  "ready",
  "starting",
  "in_progress",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUS)[number];

export const INTERVIEW_RUNTIME_STATE = [
  "idle",
  "connecting",
  "host_intro",
  "ai_speaking",
  "student_turn",
  "student_recording",
  "transcribing",
  "evaluating_answer",
  "followup",
  "closing",
  "completed",
  "failed",
] as const;
export type InterviewRuntimeState = (typeof INTERVIEW_RUNTIME_STATE)[number];

export type MicPermissionState =
  | "idle"
  | "permission_required"
  | "permission_granted"
  | "permission_denied"
  | "recording_test"
  | "test_ready"
  | "ready_to_start";

export type ProcessingStep = 0 | 1 | 2 | 3 | 4;

export const SUBMISSION_PROCESSING_ORDER: SubmissionStatus[] = [
  "uploaded",
  "parsing",
  "parsed",
  "analyzing",
  "analysis_ready",
  "interview_ready",
];

export function processingStepFor(status: SubmissionStatus): ProcessingStep {
  switch (status) {
    case "uploaded":
    case "parsing":
      return 0;
    case "parsed":
    case "analyzing":
      return 1;
    case "analysis_ready":
      return 2;
    case "interview_ready":
      return 3;
    default:
      return 4;
  }
}

export function isTerminalSubmissionStatus(s: SubmissionStatus) {
  return (
    s === "interview_ready" ||
    s === "interview_completed" ||
    s === "report_ready" ||
    s === "failed"
  );
}
