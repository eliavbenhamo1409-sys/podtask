import type { InterviewLanguage } from "./interview-language";
import type { IntegritySettings } from "@/lib/integrity/settings";
/**
 * UI-facing shapes for the student studio. These are what pages and
 * components consume; the DB rows are mapped into them in
 * `student-service-supabase.ts` (real) and `mock-data.ts` (demo).
 */
import type {
  InterviewRuntimeState,
  InterviewStatus,
  StudentAssignmentStatus,
  SubmissionStatus,
} from "./status";

export interface StudentProfile {
  id: string;
  fullName: string;
  email: string;
  avatarInitial: string;
  institutionName: string;
  locale: "he" | "en";
}

export interface StudentAssignment {
  id: string;
  title: string;
  courseName: string;
  courseCode: string;
  lecturerName: string;
  description: string;
  instructions: string;
  dueAt: string;
  estimatedInterviewMinutes: number;
  topics: string[];
  status: StudentAssignmentStatus;
  submissionId?: string;
  interviewId?: string;
  badgeKind: "next" | "todo" | "done";
  dueLabelKey?: "dueTomorrow" | "dueIn4Days" | "dueIn6Days" | "submittedApr28";
  /** Resolved integrity feature flags of the assignment (camera, telemetry, nudges…). */
  integrity?: IntegritySettings;
}

export interface StudentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  status: SubmissionStatus;
  originalFilename: string;
  fileSizeBytes: number;
  submittedAt: string;
  failureReason?: string;
  interviewId?: string;
}

export interface StudentInterview {
  id: string;
  submissionId: string;
  assignmentId: string;
  status: InterviewStatus;
  currentState: InterviewRuntimeState;
  /** Language the host speaks / listens in; chosen in the lobby. */
  language: InterviewLanguage;
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  topics: string[];
  questions: StudentInterviewQuestion[];
}

export interface StudentInterviewQuestion {
  id: string;
  topic: string;
  /** Empty until the interview is over: the question text never reaches the browser early. */
  question: string;
  recommendedSeconds: number;
  kind?: string | null;
}

/** What `interview-control` returns when the room opens (or reopens). */
export interface InterviewStartResult {
  ok: true;
  resumed: boolean;
  attempt: number;
  questions: StudentInterviewQuestion[];
  settings: IntegritySettings;
  resume: { lastQuestionIndex: number; answeredQuestionIds: string[] };
}

export interface InterviewStartError {
  ok: false;
  error:
    | "consent_required"
    | "interview_completed"
    | "interview_unavailable"
    | "assignment_closed"
    | "plan_missing"
    | "not_found"
    | "unknown";
}

export type InterviewStartOutcome = InterviewStartResult | InterviewStartError;

export interface InterviewTranscriptMessage {
  speaker: "ai_host" | "student" | "system";
  content: string;
  planQuestionId: string | null;
  createdAt: string;
}

export interface InterviewTranscript {
  messages: InterviewTranscriptMessage[];
  plan: { id: string; topic: string; question: string }[];
}

export interface StudentDashboard {
  profile: StudentProfile;
  assignments: StudentAssignment[];
  next?: StudentAssignment;
}

export interface StudentHistoryEntry {
  assignmentId: string;
  interviewId?: string;
  title: string;
  courseName: string;
  uploadedAt: string;
  interviewedAt: string;
  durationSeconds: number;
}
