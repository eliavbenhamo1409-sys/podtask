/**
 * Synthetic benchmark cases for the grading engine.
 *
 * Each case is ONE planned question with the student's spoken turns and an
 * expected outcome band. The bands encode the grading POLICY (what a careful
 * examiner would accept), not a specific model's output. They are a harness
 * for comparing models, prompts and rubric versions against each other and
 * across repeated runs; they are NOT evidence of academic validity. Real
 * validity comes from the human-rated dataset (`dataset/human/`).
 */
import type { AnswerStatus, DocumentChunk, PlanQuestion, QuestionKind } from "../../supabase/functions/_shared/grading/types.ts";

export interface BenchCase {
  id: string;
  title: string;
  language: "he" | "en";
  kind: QuestionKind;
  question: Omit<PlanQuestion, "id" | "index" | "kind">;
  chunks: DocumentChunk[];
  /** Host lines after the main question (follow-ups), interleaved before the matching student turn. */
  hostFollowUps?: string[];
  studentTurns: string[];
  /** The room's markers for this slot. */
  skipped?: boolean;
  technicalIssue?: boolean;
  expected: {
    /** Inclusive band for the 0-100 question score; null = not scored (skipped / excluded). */
    scoreBand: [number, number] | null;
    status: AnswerStatus | "skipped" | "no_answer";
    /** Which criteria must stay low (≤ 2) for the policy to hold, if any. */
    lowCriteria?: Array<"relevance" | "accuracy" | "explanation" | "consistency" | "process" | "application">;
    requiresHumanReview?: boolean;
  };
  notes: string;
}

const HE_DOC: DocumentChunk[] = [
  {
    index: 0,
    content:
      "בעבודה זו אני משווה בין מס פחמן לבין מערכת מסחר בפליטות. מס פחמן קובע מחיר קבוע לטון פליטה ומשאיר את כמות הפליטות לשוק, ואילו מערכת מסחר קובעת תקרת כמות ומשאירה את המחיר לשוק. הנתונים נאספו מהלשכה המרכזית לסטטיסטיקה ומדוחות משרד האנרגיה לשנים 2019 עד 2023.",
  },
  {
    index: 1,
    content:
      "הממצא המרכזי הוא שמס פחמן עם החזר כספי אחיד למשקי בית הוא פרוגרסיבי, בעוד שמערכת מסחר ללא פיצוי היא רגרסיבית, כי משקי בית בעשירונים הנמוכים מוציאים חלק גדול יותר מהכנסתם על אנרגיה. המגבלה העיקרית של העבודה היא היעדר נתונים על צריכת אנרגיה לפי עשירונים אחרי 2023.",
  },
];

const EN_DOC: DocumentChunk[] = [
  {
    index: 0,
    content:
      "This project compares a carbon tax with a cap-and-trade system. A carbon tax fixes the price per ton of emissions and lets the market decide the quantity, whereas cap-and-trade fixes the total quantity and lets the market set the price. Household expenditure data come from the national statistics bureau for 2019 to 2023.",
  },
  {
    index: 1,
    content:
      "The main finding is that a carbon tax with a uniform per-household rebate is progressive, while cap-and-trade without compensation is regressive, because low-income households spend a larger share of income on energy. The main limitation is the lack of decile-level energy consumption data after 2023.",
  },
];

const CONCEPT_HE = {
  topic: "מושג מרכזי",
  question: "מה ההבדל בין מס פחמן לבין מערכת מסחר בפליטות, מבחינת איפה נקבעים המחיר והכמות?",
  anchor: "מס פחמן קובע מחיר קבוע לטון פליטה ומשאיר את כמות הפליטות לשוק",
  keyPoints: ["מס פחמן: מחיר ידוע מראש, כמות משתנה", "מסחר בפליטות: כמות ידועה (תקרה), מחיר משתנה", "המחיר במסחר נקבע בשוק ההיתרים"],
  followUps: [],
};

const CONCEPT_EN = {
  topic: "core concept",
  question: "What is the difference between a carbon tax and cap-and-trade in terms of where the price and the quantity are set?",
  anchor: "A carbon tax fixes the price per ton of emissions and lets the market decide the quantity",
  keyPoints: ["carbon tax: fixed price, variable quantity", "cap-and-trade: fixed quantity (cap), variable price", "the permit market sets the price"],
  followUps: [],
};

export const CASES: BenchCase[] = [
  {
    id: "he-perfect-concept",
    title: "Perfect answer (he, concept)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: [
      "מס פחמן קובע מראש את המחיר לכל טון פליטה, והשוק מחליט כמה לפלוט בפועל, אז הוודאות היא על המחיר ולא על הכמות. במערכת מסחר זה הפוך: הממשלה קובעת תקרה לכמות הפליטות ומחלקת היתרים, והמחיר של ההיתר נקבע במסחר ביניהם. בגלל זה במס פחמן קל לתכנן תקציב אבל לא בטוח שנעמוד ביעד הפליטות, ובמסחר בטוחים בכמות אבל המחיר יכול לקפוץ.",
    ],
    expected: { scoreBand: [85, 100], status: "correct" },
    notes: "All three key points in own words, with the implication.",
  },
  {
    id: "he-average-concept",
    title: "Average answer (he, concept)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: ["מס פחמן זה שמשלמים סכום קבוע על כל טון, ובמסחר יש תקרה לכמות הפליטות. ההבדל הוא איפה המדינה מתערבת."],
    expected: { scoreBand: [45, 75], status: "partially_correct" },
    notes: "Two points named, the market-price mechanism missing, little explanation.",
  },
  {
    id: "he-wrong-with-terms",
    title: "Wrong answer dressed in the right terminology (he, concept)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: [
      "ההבדל המרכזי הוא שמס פחמן קובע תקרת כמות לפליטות ומשאיר את המחיר לשוק, בעוד שמערכת מסחר בפליטות קובעת מחיר קבוע לטון פליטה ומשאירה את הכמות לשוק. שני הכלים מייצרים תמריץ חלוקתי, אבל המס הוא הכלי הכמותי והמסחר הוא הכלי המחירי.",
    ],
    expected: { scoreBand: [0, 35], status: "incorrect", lowCriteria: ["accuracy"] },
    notes: "Fluent, uses every term, and inverts the core idea. The terminology trap.",
  },
  {
    id: "he-long-empty",
    title: "Long but empty (he, concept)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: [
      "זו שאלה מאוד חשובה ומרכזית בעבודה שלי. יש הרבה הבדלים בין הכלים האלה, וכל אחד מהם משפיע בצורה אחרת על המשק ועל משקי הבית. בעבודה ניתחתי את זה לעומק מכמה זוויות, כולל הזווית הכלכלית, החברתית והסביבתית, והגעתי למסקנות מעניינות. לדעתי חשוב להבין את ההקשר הרחב של מדיניות אקלים לפני שמשווים בין הכלים, כי כל כלי מתאים למצב אחר ולמטרות אחרות של קובעי המדיניות.",
    ],
    expected: { scoreBand: [0, 35], status: "vague", lowCriteria: ["explanation"] },
    notes: "Many words, zero checkable content. Length must not earn credit.",
  },
  {
    id: "en-short-precise",
    title: "Short and precise (en, concept)",
    language: "en",
    kind: "concept",
    question: CONCEPT_EN,
    chunks: EN_DOC,
    studentTurns: ["Tax fixes the price per ton, quantity floats. Cap and trade fixes the quantity, the permit price floats."],
    expected: { scoreBand: [70, 100], status: "correct" },
    notes: "Terse but complete; brevity must not be penalised.",
  },
  {
    id: "en-one-major-error",
    title: "Mostly right with one major error (en, evidence)",
    language: "en",
    kind: "evidence",
    question: {
      topic: "data",
      question: "What data did you use to analyse the distributional effect, and where did it come from?",
      anchor: "Household expenditure data come from the national statistics bureau for 2019 to 2023",
      keyPoints: ["household expenditure survey", "national statistics bureau", "years 2019 to 2023"],
      followUps: [],
    },
    chunks: EN_DOC,
    studentTurns: [
      "I used the household expenditure survey from the national statistics bureau, which gives spending by income decile. I took the years 2010 to 2015 because those were the most recent complete years, and I combined them with energy price series from the energy ministry.",
    ],
    expected: { scoreBand: [35, 70], status: "partially_correct" },
    notes: "Source and method right, the years are wrong (contradicts the submission). Accuracy and consistency should drop, not everything.",
  },
  {
    id: "he-partial-process",
    title: "Partial answer (he, process)",
    language: "he",
    kind: "process",
    question: {
      topic: "תהליך העבודה",
      question: "איך בחרת להשוות דווקא בין מס פחמן לבין מערכת מסחר בפליטות, ואיך בנית את ההשוואה?",
      anchor: "בעבודה זו אני משווה בין מס פחמן לבין מערכת מסחר בפליטות",
      keyPoints: ["שני הכלים הנפוצים ביותר לתמחור פחמן", "השוואה לפי השפעה חלוקתית על עשירונים", "שימוש בנתוני הוצאות משקי בית"],
      followUps: [],
    },
    chunks: HE_DOC,
    studentTurns: ["בחרתי בהם כי אלה שני הכלים שהכי מדברים עליהם. את ההשוואה בניתי לפי מי מפסיד ומי מרוויח בכל עשירון."],
    expected: { scoreBand: [35, 70], status: "partially_correct" },
    notes: "Rationale thin, the decile comparison is there, data source missing.",
  },
  {
    id: "he-followup-corrects",
    title: "Follow-up corrects an earlier error (he, concept)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    hostFollowUps: ["רגע, במס פחמן מה בדיוק קבוע, המחיר או הכמות?"],
    studentTurns: [
      "במס פחמן קובעים את הכמות ובמסחר קובעים את המחיר.",
      "סליחה, התבלבלתי. במס פחמן המחיר לטון קבוע והכמות נקבעת בשוק, ובמסחר בפליטות הכמות קבועה דרך התקרה והמחיר של ההיתרים נקבע בשוק.",
    ],
    expected: { scoreBand: [55, 90], status: "correct" },
    notes: "The final understanding is right; the initial slip must appear in errors but not sink the score.",
  },
  {
    id: "en-contradiction",
    title: "Contradiction within the answer (en, counter)",
    language: "en",
    kind: "counter",
    question: {
      topic: "counter-position",
      question: "How would you respond to the claim that cap-and-trade with compensation can be less regressive than your work suggests?",
      anchor: "cap-and-trade without compensation is regressive",
      keyPoints: ["compensation changes the distributional outcome", "the finding concerns the uncompensated case", "the design of the rebate matters"],
      followUps: [],
    },
    chunks: EN_DOC,
    studentTurns: [
      "I would say compensation makes no difference to who bears the burden, the energy share of income is what it is. But actually my whole result is that the rebate is what makes the tax progressive, so compensation changes everything. So cap and trade is always regressive no matter what you do with the money.",
    ],
    expected: { scoreBand: [15, 55], status: "partially_correct", lowCriteria: ["consistency"] },
    notes: "Asserts both that compensation is irrelevant and that it changes everything; ends on a claim the submission does not support.",
  },
  {
    id: "he-skipped",
    title: "Skipped question (he)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: [],
    skipped: true,
    expected: { scoreBand: null, status: "skipped" },
    notes: "No model call; deterministic zero credit for the slot.",
  },
  {
    id: "he-transcription-garble",
    title: "Transcription garble (he)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: ["אה כן אז זה ה... מס ה... כאילו ה... פחמן פחמן פחמן ו ה... ... תודה על הצפייה"],
    expected: { scoreBand: [0, 20], status: "unassessable", requiresHumanReview: false },
    notes: "Looping words + a transcription artefact: unassessable or near zero, never partially correct.",
  },
  {
    id: "he-no-answer-technical",
    title: "No answer captured after a disconnect (he)",
    language: "he",
    kind: "concept",
    question: CONCEPT_HE,
    chunks: HE_DOC,
    studentTurns: [],
    technicalIssue: true,
    expected: { scoreBand: null, status: "no_answer", requiresHumanReview: true },
    notes: "Excluded from the grade and sent to a human, not scored as ignorance.",
  },
  {
    id: "en-application-good",
    title: "Application answered well (en, application)",
    language: "en",
    kind: "application",
    question: {
      topic: "transfer",
      question: "How would you apply the rebate finding in a country where most low-income households heat with wood rather than grid energy?",
      anchor: "a carbon tax with a uniform per-household rebate is progressive",
      keyPoints: ["the burden depends on the carbon content of what households actually consume", "a uniform rebate may over- or under-compensate", "the rebate design must follow the local expenditure pattern"],
      followUps: [],
    },
    chunks: EN_DOC,
    studentTurns: [
      "The progressivity result depends on low-income households spending a big share on taxed energy. If they heat with wood, which is mostly outside the tax base, their burden is smaller, so a uniform rebate would over-compensate them and the tax might even look progressive without any rebate. I would first measure the carbon content of each decile's consumption basket there, and size the rebate from that rather than copying a uniform rebate.",
    ],
    expected: { scoreBand: [75, 100], status: "correct" },
    notes: "Transfers the mechanism correctly and proposes a grounded design step.",
  },
  {
    id: "he-reflection-platitudes",
    title: "Reflection with platitudes (he, reflection)",
    language: "he",
    kind: "reflection",
    question: {
      topic: "השתקפות",
      question: "אם היית יכולה לשפר או להרחיב את העבודה, מה היית משנה?",
      anchor: "",
      keyPoints: ["נתונים לפי עשירונים אחרי 2023", "הרחבת ההשוואה לכלים נוספים", "בדיקת רגישות לגובה ההחזר"],
      followUps: [],
    },
    chunks: HE_DOC,
    studentTurns: ["הייתי משקיעה יותר זמן, קוראת עוד מאמרים, ומנסה להיות יותר מדויקת. תמיד אפשר לשפר, וזה חשוב ללמוד מטעויות."],
    expected: { scoreBand: [15, 50], status: "vague" },
    notes: "Generic self-improvement talk, nothing tied to the work's actual limitation.",
  },
  {
    id: "en-off-topic",
    title: "Off-topic answer (en, concept)",
    language: "en",
    kind: "concept",
    question: CONCEPT_EN,
    chunks: EN_DOC,
    studentTurns: ["In my other course we studied how inflation targeting works at central banks, and I think interest rate policy is the more important tool for the economy overall."],
    expected: { scoreBand: [0, 20], status: "missing", lowCriteria: ["relevance"] },
    notes: "Fluent and unrelated to this submission; earns nothing.",
  },
];

/** Schema for the lecturer-rated dataset (`bench/grading/dataset/human/*.jsonl`). */
export interface HumanRating {
  /** Production interview id (the transcript is loaded from the database). */
  interviewId: string;
  questionId: string;
  raterId: string;
  /** 0-100 question score as the lecturer would grade this answer alone. */
  score: number;
  /** Optional per-criterion 0-5 ratings. */
  criteria?: Partial<Record<"relevance" | "accuracy" | "explanation" | "consistency" | "process" | "application", number>>;
  notes?: string;
}
