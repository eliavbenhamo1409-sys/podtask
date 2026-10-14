/**
 * UI-facing shapes of the lecturer dashboard. Every row comes from queries
 * that run under the lecturer's own session, so RLS (lecturer policies in
 * 20260514000001_integrity_foundation.sql) decides what is visible; the
 * service only shapes it.
 */
import type { IntegritySettings } from "@/lib/integrity/settings";
import type { StudentReport } from "@/lib/student/student-service-supabase";

export type AppRole = "student" | "lecturer" | "admin";

export interface LecturerProfile {
  id: string;
  fullName: string;
  email: string;
  avatarInitial: string;
  institutionName: string;
  role: AppRole;
}

export type AssignmentStatus = "draft" | "published" | "closed" | "archived";

export interface LecturerAssignmentSummary {
  id: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  title: string;
  status: AssignmentStatus;
  dueAt: string | null;
  language: string;
  createdAt: string;
  interviewDurationMinutes: number;
  integrity: IntegritySettings;
  /** Students enrolled in the course. */
  invited: number;
  /** Interviews completed. */
  completed: number;
  /** Enrolled students without a completed interview. */
  pending: number;
  /** Completed interviews with at least one open review item. */
  needsReview: number;
  averageScore: number | null;
}

export interface LecturerCourse {
  id: string;
  name: string;
  code: string;
  semester: string | null;
  studentCount: number;
  assignments: LecturerAssignmentSummary[];
}

export interface LecturerDashboard {
  profile: LecturerProfile;
  courses: LecturerCourse[];
  totals: {
    courses: number;
    assignments: number;
    students: number;
    completed: number;
    needsReview: number;
  };
}

export type ReviewStatus =
  | "unreviewed"
  | "reviewed"
  | "needs_clarification"
  | "closed_no_finding";

export interface LecturerStudentRow {
  studentId: string;
  fullName: string;
  email: string;
  isGuest: boolean;
  submissionId: string | null;
  submissionStatus: string | null;
  interviewId: string | null;
  interviewStatus: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  score: number | null;
  level: string | null;
  flagsCount: number;
  reviewStatus: ReviewStatus;
  followUpRequested: boolean;
}

export interface LecturerAssignmentDetail {
  assignment: LecturerAssignmentSummary & {
    description: string;
    instructions: string;
  };
  students: LecturerStudentRow[];
}

export interface ReportFlag {
  id: string;
  planQuestionId: string | null;
  category: string;
  description: string;
  quote: string | null;
  evidence: unknown[];
  confidence: "low" | "medium" | "high";
  limitations: string | null;
  source: string;
  createdAt: string;
}

export interface ReportEvent {
  id: string;
  kind: string;
  source: string;
  planQuestionId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  payload: Record<string, unknown>;
}

export interface ReportEvaluation {
  questionId: string | null;
  understandingLevel: string | null;
  scores: {
    relevance: number | null;
    accuracy: number | null;
    explanation: number | null;
    consistency: number | null;
    process: number | null;
    application: number | null;
  };
  evidence: string[];
  gaps: string[];
  summary: string | null;
}

export interface ReportMessage {
  id: string;
  speaker: "ai_host" | "student" | "system";
  content: string;
  planQuestionId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface LecturerInterviewReport {
  interview: {
    id: string;
    status: string;
    language: string;
    startedAt: string | null;
    completedAt: string | null;
    durationSeconds: number | null;
    attempts: number;
    integritySummary: Record<string, unknown> | null;
  };
  student: { id: string; fullName: string; email: string; isGuest: boolean };
  assignment: { id: string; title: string; courseName: string; courseCode: string; integrity: IntegritySettings };
  questions: { id: string; topic: string; question: string; kind: string | null }[];
  report: StudentReport | null;
  messages: ReportMessage[];
  evaluations: ReportEvaluation[];
  flags: ReportFlag[];
  events: ReportEvent[];
  consent: { acceptedAt: string; version: string } | null;
  review: {
    status: ReviewStatus;
    followUpRequested: boolean;
    note: string | null;
    updatedAt: string;
  } | null;
}
