/**
 * Server-only mirror of `student-service.ts`. Used by Server Components
 * (under `app/[locale]/student/.../page.tsx`) that need to render with the
 * student's session cookies. Importing this from a Client Component is a
 * compile-time error thanks to the `server-only` import.
 *
 * The function names mirror `student-service.ts` so callers can switch
 * import paths without changing the call sites.
 *
 * Every read is wrapped in React `cache`: within one request, repeated calls
 * with the same arguments (e.g. generateMetadata + page) hit Supabase once.
 * `startInterview` is a write and is deliberately NOT cached.
 */
import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient as createServerSb } from "@/lib/supabase/server";
import {
  MOCK_PROFILE,
  MOCK_ASSIGNMENTS,
  MOCK_HISTORY,
  findMockAssignment,
  findMockInterview,
  findMockSubmission,
  makeMockDashboard,
  MOCK_INTERVIEW_QUESTIONS,
} from "./mock-data";
import {
  getAssignmentByIdSb,
  getInterviewWithAssignmentSb,
  getReportForInterviewSb,
  getStudentAssignmentsSb,
  getStudentDashboardSb,
  getStudentHistorySb,
  getStudentProfileSb,
  getSubmissionLobbySb,
  startInterviewSb,
  type StudentReport,
} from "./student-service-supabase";
import { MOCK_MODE } from "@/lib/env";
import { isUuidLike } from "@/lib/utils";
import type {
  StudentAssignment,
  StudentDashboard,
  StudentHistoryEntry,
  StudentInterview,
  StudentInterviewQuestion,
  StudentProfile,
  StudentSubmission,
} from "./types";

async function shouldUseRealBackend(id?: string): Promise<boolean> {
  if (MOCK_MODE) return false;
  if (id !== undefined && !isUuidLike(id)) return false;
  return true;
}

type SbClient = SupabaseClient<Database>;

// One Supabase client per request. React `cache` scopes memoisation to the
// current server request, so generateMetadata() and the page body — which
// often ask for the same data — share one client and one set of queries.
const getSb = cache(async (): Promise<SbClient> => {
  return (await createServerSb()) as unknown as SbClient;
});

export const getStudentDashboard = cache(async function getStudentDashboard(): Promise<StudentDashboard> {
  if (await shouldUseRealBackend()) {
    const sb = await getSb();
    const real = await getStudentDashboardSb(sb);
    if (real) return real;
  }
  return makeMockDashboard();
});

export const getStudentProfile = cache(async function getStudentProfile(): Promise<StudentProfile> {
  if (await shouldUseRealBackend()) {
    const sb = await getSb();
    const real = await getStudentProfileSb(sb);
    if (real) return real;
  }
  return MOCK_PROFILE;
});

export const getStudentAssignments = cache(async function getStudentAssignments(): Promise<StudentAssignment[]> {
  if (await shouldUseRealBackend()) {
    const sb = await getSb();
    return await getStudentAssignmentsSb(sb);
  }
  return MOCK_ASSIGNMENTS;
});

export const getAssignmentById = cache(async function getAssignmentById(
  assignmentId: string,
): Promise<StudentAssignment | null> {
  if (await shouldUseRealBackend(assignmentId)) {
    const sb = await getSb();
    return await getAssignmentByIdSb(sb, assignmentId);
  }
  return findMockAssignment(assignmentId) ?? null;
});

export const getStudentHistory = cache(async function getStudentHistory(): Promise<StudentHistoryEntry[]> {
  if (await shouldUseRealBackend()) {
    const sb = await getSb();
    return await getStudentHistorySb(sb);
  }
  return MOCK_HISTORY;
});

export const getSubmissionLobby = cache(async function getSubmissionLobby(submissionId: string): Promise<{
  submission: StudentSubmission;
  assignment: StudentAssignment;
  interview: StudentInterview;
} | null> {
  if (await shouldUseRealBackend(submissionId)) {
    const sb = await getSb();
    return await getSubmissionLobbySb(sb, submissionId);
  }
  const submission = findMockSubmission(submissionId);
  if (!submission) return null;
  const assignment = findMockAssignment(submission.assignmentId);
  if (!assignment) return null;
  const interview = submission.interviewId
    ? findMockInterview(submission.interviewId)
    : undefined;
  if (!interview) return null;
  return { submission, assignment, interview };
});

export const getInterviewWithAssignment = cache(async function getInterviewWithAssignment(interviewId: string) {
  if (await shouldUseRealBackend(interviewId)) {
    const sb = await getSb();
    return await getInterviewWithAssignmentSb(sb, interviewId);
  }
  const interview = findMockInterview(interviewId);
  if (!interview) return null;
  const assignment = findMockAssignment(interview.assignmentId);
  if (!assignment) return null;
  return { interview, assignment };
});

export async function startInterview(
  interviewId: string,
): Promise<StudentInterview | null> {
  if (await shouldUseRealBackend(interviewId)) {
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

export const getReportForInterview = cache(async function getReportForInterview(
  interviewId: string,
): Promise<StudentReport | null> {
  if (await shouldUseRealBackend(interviewId)) {
    const sb = await getSb();
    return await getReportForInterviewSb(sb, interviewId);
  }
  return null;
});
