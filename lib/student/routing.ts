/**
 * Which screen an assignment card should open next, derived from the
 * submission / interview status. Pure; used by the dashboard and the
 * assignments list.
 */
import type { StudentAssignment, StudentInterview, StudentSubmission } from "./types";

export function nextRouteForAssignment(
  assignment: StudentAssignment,
  submission?: StudentSubmission,
  interview?: StudentInterview,
): string {
  if (!submission) {
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
