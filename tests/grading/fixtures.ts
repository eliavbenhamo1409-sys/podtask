/**
 * Builders for small, deterministic interview bundles used by the pure-TS
 * tests (and by the mock-mode benchmark). Hebrew and English variants so the
 * tokenizer paths are both exercised.
 */
import type { InterviewBundle, PlanQuestion, QuestionKind, TranscriptRow } from "../../supabase/functions/_shared/grading/types.ts";

let counter = 0;
export function uid(prefix = "m"): string {
  counter += 1;
  return `${prefix}-${counter.toString().padStart(4, "0")}`;
}

export function question(index: number, kind: QuestionKind, overrides: Partial<PlanQuestion> = {}): PlanQuestion {
  return {
    id: `q${index + 1}`,
    index,
    kind,
    topic: `topic ${index + 1}`,
    question: `Planned question ${index + 1}?`,
    anchor: "",
    keyPoints: [],
    followUps: [],
    ...overrides,
  };
}

export const HE_PLAN: PlanQuestion[] = [
  question(0, "opening", {
    question: "ספרי לי בקצרה על נושא העבודה ומדוע בחרת בו.",
    keyPoints: ["תמחור פחמן ככלי מדיניות", "השוואה בין מס פחמן למערכת מסחר בפליטות", "השפעה חלוקתית על משקי בית"],
  }),
  question(1, "concept", {
    question: "מה ההבדל בין מס פחמן לבין מערכת מסחר בפליטות?",
    anchor: "מס פחמן קובע מחיר קבוע לטון פליטה ומשאיר את כמות הפליטות לשוק",
    keyPoints: ["מס פחמן קובע מחיר קבוע לטון פליטה", "מערכת מסחר קובעת תקרת כמות", "המחיר נקבע בשוק"],
  }),
  question(2, "evidence", {
    question: "על אילו נתונים התבססת?",
    anchor: "הנתונים נאספו מהלשכה המרכזית לסטטיסטיקה",
    keyPoints: ["הלשכה המרכזית לסטטיסטיקה", "דוחות משרד האנרגיה", "השנים 2019 עד 2023"],
  }),
  question(3, "counter", {
    question: "איך היית מגיבה לטענה שמערכת מסחר עם פיצוי פחות רגרסיבית?",
    keyPoints: ["פיצוי משנה את ההשפעה החלוקתית", "ללא פיצוי המערכת רגרסיבית"],
  }),
  question(4, "reflection", {
    question: "מה היית משנה בעבודה?",
    keyPoints: ["נתונים עדכניים יותר", "הרחבת ההשוואה לכלים נוספים"],
  }),
];

export const HE_CHUNKS = [
  {
    index: 0,
    content:
      "בעבודה זו אני משווה בין מס פחמן לבין מערכת מסחר בפליטות. מס פחמן קובע מחיר קבוע לטון פליטה ומשאיר את כמות הפליטות לשוק, ואילו מערכת מסחר קובעת תקרת כמות ומשאירה את המחיר לשוק. הנתונים נאספו מהלשכה המרכזית לסטטיסטיקה ומדוחות משרד האנרגיה לשנים 2019 עד 2023.",
  },
  {
    index: 1,
    content: "הממצא המרכזי הוא שמס פחמן עם החזר כספי אחיד למשקי בית הוא פרוגרסיבי, בעוד שמערכת מסחר ללא פיצוי היא רגרסיבית. המגבלה העיקרית היא היעדר נתונים לפי עשירונים אחרי 2023.",
  },
];

export const HE_GOOD_ANSWERS: Record<string, string> = {
  q1: "העבודה שלי עוסקת בתמחור פחמן ככלי מדיניות. בחרתי להשוות בין מס פחמן למערכת מסחר בפליטות כי רציתי להבין את ההשפעה החלוקתית על משקי בית בעשירונים שונים.",
  q2: "מס פחמן קובע מחיר קבוע לטון פליטה והכמות נקבעת בשוק, ואילו מערכת מסחר קובעת תקרת כמות והמחיר נקבע בשוק לפי הביקוש להיתרים.",
  q3: "התבססתי על נתוני הלשכה המרכזית לסטטיסטיקה על הוצאות משקי בית ועל דוחות משרד האנרגיה לשנים 2019 עד 2023.",
  q4: "זה נכון שפיצוי משנה את ההשפעה החלוקתית, אבל בעבודה הראיתי שללא פיצוי המערכת רגרסיבית, ועם פיצוי אחיד היא יכולה להיות פרוגרסיבית כמו מס פחמן עם החזר.",
  q5: "הייתי מוסיפה נתונים עדכניים יותר לפי עשירונים ומרחיבה את ההשוואה לכלים נוספים כמו סובסידיות ירוקות.",
};

export interface BundleOptions {
  interviewId?: string;
  language?: "he" | "en";
  plan?: PlanQuestion[];
  answers?: Record<string, string | string[] | null>;
  skipped?: string[];
  replaced?: string[];
  discarded?: Record<string, number>;
  technicalIssue?: boolean;
  chunks?: InterviewBundle["chunks"];
  extraRows?: TranscriptRow[];
}

export function buildBundle(opts: BundleOptions = {}): InterviewBundle {
  const plan = opts.plan ?? HE_PLAN;
  const interviewId = opts.interviewId ?? "11111111-1111-4111-8111-111111111111";
  const rows: TranscriptRow[] = [];
  let t = Date.parse("2026-10-14T10:00:00Z");
  const push = (row: Omit<TranscriptRow, "id" | "created_at">) => {
    t += 5000;
    rows.push({ id: uid("msg"), created_at: new Date(t).toISOString(), ...row });
  };
  push({ speaker: "ai_host", message_type: "question", content: "שלום, ברוכה הבאה לראיון.", plan_question_id: null, metadata: {} });
  for (const q of plan) {
    push({ speaker: "ai_host", message_type: "question", content: `אנחנו בשאלה ${q.index + 1}. ${q.question}`, plan_question_id: q.id, metadata: {} });
    if (opts.skipped?.includes(q.id)) {
      push({ speaker: "system", message_type: "system", content: `skipped_question:${q.index + 1}`, plan_question_id: q.id, metadata: {} });
      continue;
    }
    if (opts.replaced?.includes(q.id)) {
      push({ speaker: "system", message_type: "system", content: `replaced_question:${q.index + 1}`, plan_question_id: q.id, metadata: {} });
      push({ speaker: "ai_host", message_type: "question", content: "בסדר, שאלה אחרת על אותו נושא.", plan_question_id: q.id, metadata: {} });
    }
    for (let i = 0; i < (opts.discarded?.[q.id] ?? 0); i++) {
      push({ speaker: "system", message_type: "system", content: "discarded_utterance:noise", plan_question_id: q.id, metadata: {} });
    }
    const answer = opts.answers && q.id in opts.answers ? opts.answers[q.id] : HE_GOOD_ANSWERS[q.id];
    if (answer === null || answer === undefined) continue;
    for (const a of Array.isArray(answer) ? answer : [answer]) {
      push({ speaker: "student", message_type: "answer", content: a, plan_question_id: q.id, metadata: { source: "client" } });
    }
  }
  for (const r of opts.extraRows ?? []) rows.push(r);
  return {
    interviewId,
    submissionId: "22222222-2222-4222-8222-222222222222",
    assignmentId: "33333333-3333-4333-8333-333333333333",
    studentId: "44444444-4444-4444-8444-444444444444",
    language: opts.language ?? "he",
    assignmentTitle: "תמחור פחמן והשפעתו החלוקתית",
    analysis: { summary: "השוואה בין מס פחמן למערכת מסחר בפליטות.", mainArgument: "מס פחמן עם החזר אחיד הוא פרוגרסיבי.", keyConcepts: ["מס פחמן", "מסחר בפליטות"], claims: [] },
    plan,
    messages: rows,
    chunks: opts.chunks ?? HE_CHUNKS,
    technical: { disconnects: 0, resumes: 0, mintFailures: 0, technicalIssue: opts.technicalIssue ?? false },
  };
}
