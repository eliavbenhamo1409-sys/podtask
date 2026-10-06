import type {
  StudentAssignment,
  StudentDashboard,
  StudentHistoryEntry,
  StudentInterview,
  StudentProfile,
  StudentSubmission,
} from "./types";

export const MOCK_PROFILE: StudentProfile = {
  id: "demo-student",
  fullName: "מאיה ריברה / Maya Rivera",
  email: "maya.r@university.edu",
  avatarInitial: "מ",
  institutionName: "Northstar University",
  locale: "he",
};

export const MOCK_ASSIGNMENTS: StudentAssignment[] = [
  {
    id: "a1",
    title: "מדיניות אקלים וכלכלה התנהגותית",
    courseName: "מדיניות ציבורית 301",
    courseCode: "PUB301",
    lecturerName: "פרופ׳ אלינור הרטוול",
    description: "נייר עמדה על מדיניות אקלים וכלכלה התנהגותית.",
    instructions:
      "כתבי נייר עמדה באורך של כ־1,500 מילים שינתח כיצד כלכלה התנהגותית יכולה לשפר את ההשתתפות בתוכניות תמחור פחמן. הסתמכי על לפחות שלושה מקרים אמיתיים מהעשור האחרון.",
    dueAt: "2026-05-06T23:59:00.000Z",
    estimatedInterviewMinutes: 12,
    topics: [
      "מנגנוני תמחור פחמן",
      "דחיפות התנהגותיות",
      "מקרי מבחן אמיתיים",
      "טיעוני נגד",
    ],
    status: "upload_required",
    badgeKind: "next",
    dueLabelKey: "dueTomorrow",
  },
  {
    id: "a2",
    title: "סמליות בספרות המאה ה־20",
    courseName: "ספרות אנגלית 240",
    courseCode: "LIT240",
    lecturerName: "Dr. Lila Chen",
    description: "ניתוח סמלים בארבעה רומנים מרכזיים מהמאה ה־20.",
    instructions:
      "בחרי שני רומנים מרשימת הקריאה ונתחי שלוש סצנות סמליות. נמקי כיצד הסמלים בונים את התמה הראשית.",
    dueAt: "2026-05-09T23:59:00.000Z",
    estimatedInterviewMinutes: 15,
    topics: ["סמלים מרכזיים", "ניתוח סצנה", "מבנה תמטי"],
    status: "not_started",
    badgeKind: "todo",
    dueLabelKey: "dueIn4Days",
  },
  {
    id: "a3",
    title: "דינמיקת זורמים: דוח מעבדה 3",
    courseName: "פיזיקה 220",
    courseCode: "PHY220",
    lecturerName: "Prof. Benjamin Park",
    description: "דוח מעבדה על ניסוי 3 ביציבות זרימה.",
    instructions:
      "תארי את ההגדרה הניסיונית, גזרי את משוואת היציבות, והשוויי לתוצאות שהתקבלו במעבדה. צרפי גרפים והפנייה לקוד הניתוח.",
    dueAt: "2026-05-11T23:59:00.000Z",
    estimatedInterviewMinutes: 10,
    topics: ["הגדרת ניסוי", "ניתוח שגיאה", "פירוש תוצאות"],
    status: "not_started",
    badgeKind: "todo",
    dueLabelKey: "dueIn6Days",
  },
  {
    id: "a4",
    title: "אסטרטגיית שיווק: חקר מקרה",
    courseName: "מנהל עסקים 180",
    courseCode: "MGT180",
    lecturerName: "Dr. Yael Brenner",
    description: "חקר מקרה של אסטרטגיית כניסה לשוק.",
    instructions: "נתחי את הכניסה של ספוטיפיי לשוק האמריקאי וזהי שלושה גורמי הצלחה.",
    dueAt: "2026-04-28T23:59:00.000Z",
    estimatedInterviewMinutes: 14,
    topics: ["אסטרטגיית כניסה", "מיצוב מותג", "ניתוח מתחרים"],
    status: "completed",
    badgeKind: "done",
    dueLabelKey: "submittedApr28",
    submissionId: "sub-a4",
    interviewId: "int-a4",
  },
];

export const MOCK_SUBMISSIONS: StudentSubmission[] = [
  {
    id: "sub-a4",
    assignmentId: "a4",
    studentId: MOCK_PROFILE.id,
    status: "report_ready",
    originalFilename: "spotify-case-study.pdf",
    fileSizeBytes: 184_320,
    submittedAt: "2026-04-28T18:32:00.000Z",
    interviewId: "int-a4",
  },
];

export const MOCK_INTERVIEWS: StudentInterview[] = [
  {
    id: "int-a4",
    submissionId: "sub-a4",
    assignmentId: "a4",
    status: "completed",
    currentState: "completed",
    startedAt: "2026-04-28T19:00:00.000Z",
    completedAt: "2026-04-28T19:11:42.000Z",
    durationSeconds: 702,
    topics: ["אסטרטגיית כניסה", "מיצוב מותג"],
    questions: [],
  },
];

export const MOCK_HISTORY: StudentHistoryEntry[] = [
  {
    assignmentId: "a4",
    interviewId: "int-a4",
    title: "אסטרטגיית שיווק: חקר מקרה",
    courseName: "מנהל עסקים 180",
    uploadedAt: "2026-04-28T18:32:00.000Z",
    interviewedAt: "2026-04-28T19:00:00.000Z",
    durationSeconds: 702,
  },
];

export function makeMockDashboard(): StudentDashboard {
  const next = MOCK_ASSIGNMENTS.find(
    (a) => a.badgeKind === "next" || a.status !== "completed",
  );
  return {
    profile: MOCK_PROFILE,
    assignments: MOCK_ASSIGNMENTS,
    next,
  };
}

export function findMockAssignment(id: string) {
  return MOCK_ASSIGNMENTS.find((a) => a.id === id);
}

export function findMockSubmission(id: string) {
  return MOCK_SUBMISSIONS.find((s) => s.id === id);
}

export function findMockInterview(id: string) {
  return MOCK_INTERVIEWS.find((i) => i.id === id);
}

export const MOCK_INTERVIEW_QUESTIONS = [
  {
    id: "q1",
    topic: "פתיחה",
    topicEn: "Opening",
    question:
      "בואי נתחיל ברוחב. מה משך אותך לכלכלה התנהגותית בתור עדשה למדיניות אקלים?",
    questionEn:
      "Let's start broad. What drew you to behavioral economics as a lens for climate policy?",
    recommendedSeconds: 120,
  },
  {
    id: "q2",
    topic: "מקרה מבחן 1",
    topicEn: "Case study 1",
    question:
      "את מצטטת את מס הפחמן של בריטיש קולומביה כהצלחה. מה בעיצוב שלו עזר לו לשרוד פוליטית?",
    questionEn:
      "You cite the British Columbia carbon tax as a success. What in its design helped it survive politically?",
    recommendedSeconds: 120,
  },
  {
    id: "q3",
    topic: "עמדה נגדית",
    topicEn: "Counter-position",
    question: "איפה את רואה את טיעון הנגד החזק ביותר לגישה מבוססת הדחיפות שלך?",
    questionEn:
      "Where do you see the strongest counter-argument to your nudge-based approach?",
    recommendedSeconds: 120,
  },
  {
    id: "q4",
    topic: "סינתזה",
    topicEn: "Synthesis",
    question:
      "אם היית צריכה לעצב מחדש אחת מהתוכניות האלה ממחר, מה היית משנה קודם?",
    questionEn:
      "If you had to redesign one of these programs starting tomorrow, what would you change first?",
    recommendedSeconds: 120,
  },
];
