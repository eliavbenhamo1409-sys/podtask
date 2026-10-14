/**
 * Demo fixtures for the lecturer dashboard (mock mode only). Small on
 * purpose: enough to render every screen, nothing that looks like a real
 * record.
 */
import { resolveIntegritySettings } from "@/lib/integrity/settings";
import type {
  LecturerAssignmentDetail,
  LecturerDashboard,
  LecturerInterviewReport,
} from "./types";

const integrity = resolveIntegritySettings(null, { personal: false });

const assignment = {
  id: "mock-assignment",
  courseId: "mock-course",
  courseName: "מדיניות סביבתית",
  courseCode: "PUB301",
  title: "ניתוח מנגנוני תמחור פחמן",
  status: "published" as const,
  dueAt: "2026-11-01T21:00:00.000Z",
  language: "he",
  createdAt: "2026-10-01T08:00:00.000Z",
  interviewDurationMinutes: 12,
  integrity,
  invited: 3,
  completed: 1,
  pending: 2,
  needsReview: 1,
  averageScore: 78,
};

export const MOCK_LECTURER_DASHBOARD: LecturerDashboard = {
  profile: {
    id: "mock-lecturer",
    fullName: "ד״ר נועה לוי",
    email: "lecturer@example.edu",
    avatarInitial: "נ",
    institutionName: "Demo sandbox",
    role: "lecturer",
  },
  courses: [
    {
      id: "mock-course",
      name: "מדיניות סביבתית",
      code: "PUB301",
      semester: "2026א",
      studentCount: 3,
      assignments: [assignment],
    },
  ],
  totals: { courses: 1, assignments: 1, students: 3, completed: 1, needsReview: 1 },
};

export const MOCK_LECTURER_ASSIGNMENT_DETAIL: LecturerAssignmentDetail = {
  assignment: { ...assignment, description: "", instructions: "" },
  students: [
    {
      studentId: "s1",
      fullName: "מאיה כהן",
      email: "maya@example.edu",
      isGuest: false,
      submissionId: "sub-1",
      submissionStatus: "report_ready",
      interviewId: "mock-interview",
      interviewStatus: "completed",
      completedAt: "2026-10-12T10:12:00.000Z",
      durationSeconds: 640,
      score: 78,
      level: "medium_high",
      flagsCount: 1,
      reviewStatus: "unreviewed",
      followUpRequested: false,
    },
    {
      studentId: "s2",
      fullName: "יונתן פרץ",
      email: "yonatan@example.edu",
      isGuest: false,
      submissionId: "sub-2",
      submissionStatus: "interview_ready",
      interviewId: null,
      interviewStatus: "ready",
      completedAt: null,
      durationSeconds: null,
      score: null,
      level: null,
      flagsCount: 0,
      reviewStatus: "unreviewed",
      followUpRequested: false,
    },
    {
      studentId: "s3",
      fullName: "דנה אברהם",
      email: "dana@example.edu",
      isGuest: false,
      submissionId: null,
      submissionStatus: null,
      interviewId: null,
      interviewStatus: null,
      completedAt: null,
      durationSeconds: null,
      score: null,
      level: null,
      flagsCount: 0,
      reviewStatus: "unreviewed",
      followUpRequested: false,
    },
  ],
};

export const MOCK_LECTURER_REPORT: LecturerInterviewReport = {
  interview: {
    id: "mock-interview",
    status: "completed",
    language: "he",
    startedAt: "2026-10-12T10:00:00.000Z",
    completedAt: "2026-10-12T10:12:00.000Z",
    durationSeconds: 640,
    attempts: 1,
    integritySummary: { sessions_minted: 1, answers: 5, median_latency_ms: 2100, barge_ins: 1 },
  },
  student: { id: "s1", fullName: "מאיה כהן", email: "maya@example.edu", isGuest: false },
  assignment: {
    id: "mock-assignment",
    title: "ניתוח מנגנוני תמחור פחמן",
    courseName: "מדיניות סביבתית",
    courseCode: "PUB301",
    integrity,
  },
  questions: [
    { id: "q1", topic: "פתיחה", question: "ספרי לי במילים שלך על מה העבודה.", kind: "opening" },
    { id: "q2", topic: "תמחור פחמן", question: "איך מס פחמן שונה ממסחר בפליטות, לפי העבודה שלך?", kind: "concept" },
    { id: "q3", topic: "נתונים", question: "איך אספת את הנתונים על מחירי הפליטות, ומה היה קשה?", kind: "process" },
    { id: "q4", topic: "טיעון נגד", question: "מה היית עונה למי שטוען שמס פחמן פוגע במשקי בית חלשים?", kind: "counter" },
    { id: "q5", topic: "רפלקציה", question: "מה היית משנה בעבודה היום?", kind: "reflection" },
  ],
  report: {
    id: "mock-report",
    submissionId: "sub-1",
    interviewId: "mock-interview",
    overallLevel: "medium_high",
    overallScore: 78,
    rubric: { conceptual: 4, reasoning: 3.5, communication: 4, evidence: 3 },
    summary: "הסטודנטית מסבירה היטב את ההבדל בין מס פחמן למסחר בפליטות ומכירה את מקורות הנתונים. ההגנה על הטיעון מול טענת הנגד הייתה חלקית.",
    strengths: ["הסבר ברור של מנגנון המס", "הכרת מקורות הנתונים"],
    weaknesses: ["ההגנה מול טענת הנגד הייתה כללית"],
    recommendations: ["לחדד את הדיון בהשפעות חלוקתיות"],
    evidence: [],
    gaps: [],
    status: "ready",
  },
  messages: [
    { id: "m1", speaker: "ai_host", content: "אנחנו בשאלה הראשונה, ספרי לי על מה העבודה.", planQuestionId: "q1", createdAt: "2026-10-12T10:00:30.000Z", metadata: {} },
    { id: "m2", speaker: "student", content: "העבודה בוחנת שני מנגנונים לתמחור פחמן ומשווה ביניהם מבחינת יעילות והשפעה חלוקתית.", planQuestionId: "q1", createdAt: "2026-10-12T10:00:50.000Z", metadata: { latency_ms: 1800, speech_ms: 9000 } },
    { id: "m3", speaker: "ai_host", content: "אנחנו בשאלה השנייה, איך מס פחמן שונה ממסחר בפליטות?", planQuestionId: "q2", createdAt: "2026-10-12T10:01:20.000Z", metadata: {} },
    { id: "m4", speaker: "student", content: "מס פחמן קובע מחיר ומשאיר את הכמות לשוק, ומסחר בפליטות קובע כמות ומשאיר את המחיר לשוק.", planQuestionId: "q2", createdAt: "2026-10-12T10:01:45.000Z", metadata: { latency_ms: 2600, speech_ms: 11000 } },
  ],
  evaluations: [
    { questionId: "q1", understandingLevel: "high", scores: { relevance: 5, accuracy: 4.5, explanation: 4.5, consistency: 5, process: 4, application: 4 }, evidence: ["בוחנת שני מנגנונים לתמחור פחמן"], gaps: [], summary: "פתיחה ממוקדת ומדויקת." },
    { questionId: "q2", understandingLevel: "medium_high", scores: { relevance: 5, accuracy: 4, explanation: 4, consistency: 4, process: 3, application: 3 }, evidence: ["קובע מחיר ומשאיר את הכמות לשוק"], gaps: ["לא הוזכרה אי־ודאות המחיר במסחר"], summary: "ההבחנה נכונה; חסר עומק על אי־ודאות." },
  ],
  flags: [
    {
      id: "f1",
      planQuestionId: "q4",
      category: "generic_answer",
      description: "התשובה חזרה על עקרונות כלליים ולא התייחסה לטענת הנגד שנשאלה.",
      quote: "בגדול, מס פחמן הוא כלי יעיל.",
      evidence: [],
      confidence: "medium",
      limitations: "Raised by the AI host during the conversation. It is the host's impression of one answer, reported through the student's browser, not a verified finding.",
      source: "host_tool",
      createdAt: "2026-10-12T10:08:00.000Z",
    },
  ],
  events: [
    { id: "e1", kind: "camera_started", source: "client", planQuestionId: null, startedAt: "2026-10-12T10:00:05.000Z", endedAt: null, durationMs: null, payload: { detector: true } },
    { id: "e2", kind: "visibility_hidden", source: "client", planQuestionId: "q4", startedAt: "2026-10-12T10:07:10.000Z", endedAt: "2026-10-12T10:07:44.000Z", durationMs: 34000, payload: {} },
    { id: "e3", kind: "silence_nudge", source: "client", planQuestionId: "q4", startedAt: "2026-10-12T10:07:30.000Z", endedAt: null, durationMs: null, payload: { stage: 1 } },
  ],
  consent: { acceptedAt: "2026-10-12T09:58:00.000Z", version: "2026-10-14" },
  review: null,
};
