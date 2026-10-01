/**
 * Which screen an assignment card should open next, derived from the
 * submission / interview status. Pure; used by the dashboard and the
 * assignments list.
 */
import type { StudentAssignment, StudentInterview, StudentSubmission } from "./types";

function routeFromStatus(assignment: StudentAssignment): string {
  const sub = assignment.submissionId;
  const int = assignment.interviewId;
  switch (assignment.status) {
    case "processing":
    case "failed":
      return `/student/submissions/${sub}/processing`;
    case "mic_test_required":
      return `/student/submissions/${sub}/mic-test`;
    case "ready_for_interview":
      return `/student/submissions/${sub}/lobby`;
    case "interview_in_progress":
      return int ? `/student/interviews/${int}` : `/student/submissions/${sub}/lobby`;
    case "completed":
      return int
        ? `/student/interviews/${int}/complete`
        : `/student/assignments/${assignment.id}`;
    default:
      return `/student/assignments/${assignment.id}/upload`;
  }
}

export function nextRouteForAssignment(
  assignment: StudentAssignment,
  submission?: StudentSubmission,
  interview?: StudentInterview,
): string {
  if (!submission) {
    // Real-mode callers only have the derived status plus the ids; route
    // from those so a completed card does not fall back to /upload.
    if (assignment.submissionId) {
      return routeFromStatus(assignment);
    }
    return `/student/assignments/${assignment.id}/upload`;
  }

  if (submission.status === "failed") {
    return `/student/submissions/${submission.id}/processing`;
  }

  if (
    submission.status === "uploaded" ||
    submission.status === "parsing" ||
    submission.status === "parsed" ||
    submission.status === "analyzing" ||
    submission.status === "analysis_ready"
  ) {
    return `/student/submissions/${submission.id}/processing`;
  }

  if (submission.status === "interview_ready") {
    if (assignment.status === "mic_test_required") {
      return `/student/submissions/${submission.id}/mic-test`;
    }
    return `/student/submissions/${submission.id}/lobby`;
  }

  if (interview && interview.status === "in_progress") {
    return `/student/interviews/${interview.id}`;
  }

  if (
    interview &&
    (interview.status === "completed" ||
      submission.status === "interview_completed" ||
      submission.status === "report_ready")
  ) {
    return `/student/interviews/${interview.id}/complete`;
  }

  return `/student/assignments/${assignment.id}`;
}
