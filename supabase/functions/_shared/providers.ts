/**
 * Mock AI providers. Swap implementations here when wiring real providers.
 * Each function returns the SAME shape as the real provider so call sites stay stable.
 */

export interface ParseResult {
  provider: "mistral_ocr" | "llamaparse" | "manual_text";
  markdown: string;
  pageCount: number;
  metadata: Record<string, unknown>;
}

export interface AnalysisResult {
  model: string;
  summary: string;
  mainArgument: string;
  keyConcepts: string[];
  claims: string[];
  weakPoints: string[];
  complexSections: string[];
  interviewTargets: string[];
  rawOutput: Record<string, unknown>;
}

export interface InterviewPlan {
  model: string;
  questions: {
    id: string;
    topic: string;
    question: string;
    recommended_seconds: number;
    follow_ups: string[];
  }[];
}

export interface AnswerEvaluation {
  model: string;
  understandingLevel: "low" | "medium" | "medium_high" | "high";
  clarityScore: number;
  conceptualScore: number;
  reasoningScore: number;
  consistencyScore: number;
  evidence: string[];
  gaps: string[];
  recommendedFollowup: string | null;
}

export interface ReportResult {
  model: string;
  overallLevel: "low" | "medium" | "medium_high" | "high";
  summary: string;
  rubricResult: Record<string, unknown>;
  gaps: string[];
  evidence: string[];
  recommendations: string[];
  pdfPath: string | null;
}

export async function parseDocumentMock(): Promise<ParseResult> {
  return {
    provider: "manual_text",
    markdown:
      "# Mock parse\n\nThis is a placeholder parse result. Replace with Mistral OCR / LlamaParse output.",
    pageCount: 4,
    metadata: { mock: true },
  };
}

export async function analyzeAssignmentMock(): Promise<AnalysisResult> {
  return {
    model: "mock-gpt-5",
    summary:
      "The student argues that behavioral economics can substantially improve carbon-pricing adoption by leveraging defaults and salience.",
    mainArgument:
      "Behavioral nudges complement, rather than replace, market-based climate instruments.",
    keyConcepts: [
      "Carbon-pricing mechanisms",
      "Behavioral nudges",
      "Default effects",
      "Salience and framing",
    ],
    claims: [
      "BC's carbon tax succeeded due to revenue recycling.",
      "Behavioral nudges raise participation in opt-in green programs.",
    ],
    weakPoints: [
      "Limited engagement with distributional concerns",
      "No discussion of long-run elasticity",
    ],
    complexSections: ["Methodology — case selection criteria"],
    interviewTargets: [
      "Counter-arguments to behavioral approach",
      "Trade-offs of revenue-recycling design",
    ],
    rawOutput: { mock: true },
  };
}

export async function generateInterviewPlanMock(
  language = "he",
): Promise<InterviewPlan> {
  const isHebrew = language === "he";
  return {
    model: "mock-gpt-5",
    questions: [
      {
        id: "q1",
        topic: isHebrew ? "פתיחה" : "Opening",
        question: isHebrew
          ? "בואי נתחיל ברוחב — מה משך אותך לכלכלה התנהגותית בתור עדשה למדיניות אקלים?"
          : "Let's start broad — what drew you to behavioral economics as a lens for climate policy?",
        recommended_seconds: 120,
        follow_ups: [],
      },
      {
        id: "q2",
        topic: isHebrew ? "מקרה מבחן 1" : "Case study 1",
        question: isHebrew
          ? "את מצטטת את מס הפחמן של בריטיש קולומביה כהצלחה. מה בעיצוב שלו עזר לו לשרוד פוליטית?"
          : "You cite the British Columbia carbon tax as a success. What in its design helped it survive politically?",
        recommended_seconds: 120,
        follow_ups: [],
      },
      {
        id: "q3",
        topic: isHebrew ? "עמדה נגדית" : "Counter-position",
        question: isHebrew
          ? "איפה את רואה את טיעון הנגד החזק ביותר לגישה מבוססת הדחיפות שלך?"
          : "Where do you see the strongest counter-argument to your nudge-based approach?",
        recommended_seconds: 120,
        follow_ups: [],
      },
      {
        id: "q4",
        topic: isHebrew ? "סינתזה" : "Synthesis",
        question: isHebrew
          ? "אם היית צריכה לעצב מחדש אחת מהתוכניות האלה ממחר, מה היית משנה קודם?"
          : "If you had to redesign one of these programs starting tomorrow, what would you change first?",
        recommended_seconds: 120,
        follow_ups: [],
      },
    ],
  };
}

export async function evaluateAnswerMock(): Promise<AnswerEvaluation> {
  return {
    model: "mock-gpt-5",
    understandingLevel: "medium_high",
    clarityScore: 4.3,
    conceptualScore: 4.0,
    reasoningScore: 4.1,
    consistencyScore: 4.5,
    evidence: ["Cited BC carbon tax as a key example"],
    gaps: ["Did not address distributional impact"],
    recommendedFollowup: "Press on how revenue recycling reduces regressive effects.",
  };
}

export async function generateReportMock(): Promise<ReportResult> {
  return {
    model: "mock-gpt-5",
    overallLevel: "medium_high",
    summary:
      "The student demonstrates a coherent, citation-anchored grasp of carbon-pricing dynamics with one notable gap on distributional impact.",
    rubricResult: { conceptual: 4.0, reasoning: 4.1, communication: 4.4 },
    gaps: ["Distributional / equity analysis was thin throughout."],
    evidence: ["Multiple references to BC, EU-ETS, RGGI"],
    recommendations: [
      "Read Stiglitz (2019) on equity-aware carbon pricing.",
      "Practice articulating trade-offs aloud — strong written, looser verbal.",
    ],
    pdfPath: null,
  };
}
