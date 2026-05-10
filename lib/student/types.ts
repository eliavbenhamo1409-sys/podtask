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
  startedAt?: string;
  completedAt?: string;
  durationSeconds?: number;
  topics: string[];
  questions: StudentInterviewQuestion[];
}

export interface StudentInterviewQuestion {
  id: string;
  topic: string;
  question: string;
  recommendedSeconds: number;
}

export interface StudentInterviewMessage {
  id: string;
  interviewId: string;
  speaker: "ai_host" | "student" | "system";
  messageType: "question" | "answer" | "followup" | "system" | "summary";
  content: string;
  startedAt: string;
}

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
  title: string;
  courseName: string;
  uploadedAt: string;
  interviewedAt: string;
  durationSeconds: number;
}
