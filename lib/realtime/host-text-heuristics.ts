/**
 * Pure text heuristics over the AI host's transcript (no React, no DOM).
 *
 * The live interview room (`interview-client.tsx`) uses these to infer, from
 * what the host just said, which planned question is being asked and whether
 * the host is closing the interview. They back the browser-side safety nets
 * that close the session even when the model never calls `finish_interview`.
 *
 * CROSS-RUNTIME CONTRACT: the ordinal words and closing phrases here must stay
 * in sync with the system prompt built in
 * `supabase/functions/_shared/realtime-instructions.ts`, which instructs the
 * host to announce "אנחנו בשאלה השלישית" / "We're on the third question" /
 * "نحن في السؤال الثالث" and to end with a thank-you + farewell line. Change
 * both sides together.
 *
 * Every function takes the INTERVIEW language (he / en / ar), not the UI
 * locale. Unknown values fall back to English.
 */
import type { StudentInterviewQuestion } from "@/lib/student/types";

type HeuristicLanguage = "he" | "en" | "ar";

function toHeuristicLanguage(locale: string): HeuristicLanguage {
  return locale === "he" ? "he" : locale === "ar" ? "ar" : "en";
}

const HE_ORDINALS: ReadonlyArray<readonly [string, number]> = [
  ["ראשונה", 0],
  ["שנייה", 1],
  ["שניה", 1],
  ["שלישית", 2],
  ["רביעית", 3],
  ["חמישית", 4],
  ["שישית", 5],
  ["שביעית", 6],
  ["שמינית", 7],
  ["תשיעית", 8],
  ["עשירית", 9],
];

const EN_ORDINALS: ReadonlyArray<readonly [string, number]> = [
  ["first", 0],
  ["second", 1],
  ["third", 2],
  ["fourth", 3],
  ["fifth", 4],
  ["sixth", 5],
  ["seventh", 6],
  ["eighth", 7],
  ["ninth", 8],
  ["tenth", 9],
];

// Arabic ordinals as the prompt dictates them ("نحن في السؤال الثالث"),
// compared after `normalizeArabic` (no diacritics, unified alef). Both the
// masculine and the feminine forms are listed in case the host agrees the
// ordinal with a feminine noun.
const AR_ORDINALS: ReadonlyArray<readonly [string, number]> = [
  ["الاول", 0],
  ["الاولى", 0],
  ["الثاني", 1],
  ["الثانية", 1],
  ["الثالث", 2],
  ["الثالثة", 2],
  ["الرابع", 3],
  ["الرابعة", 3],
  ["الخامس", 4],
  ["الخامسة", 4],
  ["السادس", 5],
  ["السادسة", 5],
  ["السابع", 6],
  ["السابعة", 6],
  ["الثامن", 7],
  ["الثامنة", 7],
  ["التاسع", 8],
  ["التاسعة", 8],
  ["العاشر", 9],
  ["العاشرة", 9],
];

// "<ordinal> [and final|last] question" / "question [number] <ordinal>".
const EN_ORDINAL_PATTERNS: ReadonlyArray<readonly [RegExp, RegExp, number]> =
  EN_ORDINALS.map(([word, ordinal]) => [
    new RegExp(`\\b${word}\\s+(?:and\\s+(?:final|last)\\s+)?question\\b`),
    new RegExp(`\\bquestion\\s+(?:number\\s+)?${word}\\b`),
    ordinal,
  ]);

/**
 * High-confidence detector: looks for explicit ordinal/number markers in the
 * host's announcement, e.g. "אנחנו בשאלה השלישית" or "We're on the fifth and
 * final question". The host is instructed to prefix every NEW planned question
 * with such an announcement, so when this fires it is far more reliable than
 * fuzzy text matching.
 *
 * Returns the 0-based question index, or -1 when no marker is found.
 */
export function detectExplicitQuestionNumber(
  text: string,
  locale: string,
): number {
  if (!text) return -1;
  const language = toHeuristicLanguage(locale);
  if (language === "ar") {
    const normalized = normalizeArabic(text);
    for (const [word, ordinal] of AR_ORDINALS) {
      if (
        normalized.includes(`السؤال ${word}`) ||
        normalized.includes(`سؤال ${word}`)
      ) {
        return ordinal;
      }
    }
    const numMatch = normalized.match(/سؤال\s+(?:رقم\s+)?(\d{1,2})\b/);
    if (numMatch) {
      const n = Number.parseInt(numMatch[1], 10);
      if (Number.isFinite(n) && n >= 1) return n - 1;
    }
    return -1;
  }
  if (language === "he") {
    for (const [word, ordinal] of HE_ORDINALS) {
      if (
        text.includes(`שאלה ה${word}`) ||
        text.includes(`שאלה ${word}`) ||
        text.includes(`השאלה ה${word}`)
      ) {
        return ordinal;
      }
    }
    const numMatch = text.match(/שאלה\s+(?:מספר\s+)?(\d{1,2})\b/);
    if (numMatch) {
      const n = Number.parseInt(numMatch[1], 10);
      if (Number.isFinite(n) && n >= 1) return n - 1;
    }
    return -1;
  }
  const lower = text.toLowerCase();
  for (const [before, after, ordinal] of EN_ORDINAL_PATTERNS) {
    if (before.test(lower) || after.test(lower)) return ordinal;
  }
  const numMatch = lower.match(/\bquestion\s+(?:number\s+)?(\d{1,2})\b/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n >= 1) return n - 1;
  }
  return -1;
}

/**
 * Fuzzy detector: scores the host text against every planned question (and
 * topic) and returns the best 0-based index, or -1 below the confidence floor.
 */
export function detectPlannedQuestionIndex(
  assistantText: string,
  questions: StudentInterviewQuestion[],
): number {
  const hay = normalizeForMatch(assistantText);
  if (!hay) return -1;
  let bestIndex = -1;
  let bestScore = 0;
  // Match against known question texts from the plan.
  // We score each question and pick the strongest candidate.
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const he = normalizeForMatch(q.question);
    // Plans may carry an English rendering alongside the primary text.
    const en = normalizeForMatch((q as { questionEn?: string }).questionEn ?? "");
    const topic = normalizeForMatch(q.topic ?? "");
    let score = 0;
    if (he.length >= 8 && (hay.includes(he) || he.includes(hay))) score = 1;
    if (en.length >= 8 && (hay.includes(en) || en.includes(hay))) score = 1;
    score = Math.max(score, tokenOverlap(hay, he), tokenOverlap(hay, en));
    if (topic.length >= 4) score = Math.max(score, tokenOverlap(hay, topic) * 0.75);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  // Conservative floor for fuzzy matches to avoid random false positives.
  return bestScore >= 0.33 ? bestIndex : -1;
}

function normalizeForMatch(s: string): string {
  return normalizeArabic(s)
    .toLowerCase()
    .replace(/["'`“”״]/g, "")
    .replace(/[.,!?;:()[\]{}\-–—،؛؟]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Arabic text as the model writes it carries diacritics (tashkeel), tatweel
 * and three spellings of alef; strip / unify them so phrase matching is
 * stable. A no-op for Hebrew and English.
 */
function normalizeArabic(s: string): string {
  return s
    .replace(/[\u064B-\u0652\u0670\u0640]/g, "")
    .replace(/[\u0622\u0623\u0625]/g, "\u0627");
}

function tokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const aTokens = new Set(a.split(" ").filter((t) => t.length >= 3));
  const bTokens = new Set(b.split(" ").filter((t) => t.length >= 3));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let common = 0;
  for (const t of bTokens) {
    if (aTokens.has(t)) common += 1;
  }
  return common / bTokens.size;
}

// Closing phrases are grouped by what they express. A real farewell (the
// prompt asks for acknowledgement + thanks + goodbye) hits two or more
// groups; a single "תודה רבה" between questions hits only one. The caller
// decides what each strength means in context (see closingStrength).
const CLOSING_GROUPS: Record<HeuristicLanguage, { strong: string[]; thanks: string[]; farewell: string[]; wrap: string[] }> = {
  he: {
    strong: ["הראיון הסתיים", "הראיון נגמר", "סיימנו את הראיון", "נסיים את הראיון", "זה היה הראיון"],
    thanks: ["תודה רבה", "תודה שהשתתפת", "תודה שהשתתפתם", "תודה על השיחה", "תודה על ההשתתפות", "תודה על השיתוף"],
    farewell: ["להתראות", "יום טוב", "יום נעים", "המשך יום", "בהצלחה", "שיהיה לך", "שיהיה לכם", "כל טוב"],
    wrap: ["סיימנו", "נסיים כאן", "נעצור כאן", "נעצור פה", "נסיים פה"],
  },
  en: {
    strong: ["the interview is over", "the interview is done", "the interview has ended", "that was the interview", "this concludes"],
    thanks: ["thank you for joining", "thanks for joining", "thanks for sharing", "thank you for sharing", "thank you so much", "thanks so much", "thank you for your time"],
    farewell: ["goodbye", "have a good day", "have a great day", "have a wonderful day", "good luck", "take care", "all the best"],
    wrap: ["we'll wrap up", "let's wrap up", "let's stop here", "we'll stop here", "we're done", "we are done", "this is where we'll wrap"],
  },
  // Compared after normalizeForMatch (diacritics removed, alef unified).
  ar: {
    strong: ["انتهت المقابلة", "انتهى الحوار", "انتهت مقابلتنا", "نهاية المقابلة", "ننهي المقابلة", "هذه كانت المقابلة"],
    thanks: ["شكرا جزيلا", "شكرا لك", "شكرا على مشاركتك", "شكرا على وقتك", "شكرا للمشاركة", "شكرا على المشاركة", "اشكرك"],
    farewell: ["مع السلامة", "يوما سعيدا", "يوم سعيد", "بالتوفيق", "اتمنى لك", "الى اللقاء", "كل التوفيق", "نهارك سعيد"],
    wrap: ["انتهينا", "نتوقف هنا", "سنتوقف هنا", "نختم هنا", "ننهي هنا", "لننهي هنا"],
  },
};

export type ClosingStrength = "none" | "weak" | "likely" | "strong";

/**
 * How strongly the host text reads as the end of the interview:
 *   strong  — an explicit "the interview is over" phrase
 *   likely  — at least two of {thanks, farewell wish, wrap-up} (a real goodbye)
 *   weak    — just one of them (e.g. "תודה רבה" between questions)
 *   none    — nothing
 */
export function closingStrength(text: string, locale: string): ClosingStrength {
  const normalized = normalizeForMatch(text);
  if (!normalized) return "none";
  const groups = CLOSING_GROUPS[toHeuristicLanguage(locale)];
  const hit = (list: string[]) =>
    list.some((sig) => normalized.includes(normalizeForMatch(sig)));
  if (hit(groups.strong)) return "strong";
  const count = [groups.thanks, groups.farewell, groups.wrap].filter(hit).length;
  if (count >= 2) return "likely";
  if (count === 1) return "weak";
  return "none";
}

const HE_TRANSITION_SIGNALS = [
  "השאלה הבאה",
  "נעבור לשאלה הבאה",
  "בואי נעבור לשאלה הבאה",
  "בוא נמשיך לשאלה הבאה",
  "נעבור לנושא הבא",
  "בואי נמשיך",
  "בוא נמשיך",
];
const EN_TRANSITION_SIGNALS = [
  "next question",
  "let's move to the next question",
  "shall we move to the next question",
  "let's move on",
  "let's turn to",
  "moving to the next topic",
];
const AR_TRANSITION_SIGNALS = [
  "السؤال التالي",
  "ننتقل الى السؤال التالي",
  "لننتقل الى السؤال التالي",
  "ننتقل الان الى",
  "لننتقل الى",
  "الموضوع التالي",
];

/** True when the host text signals a move to the next planned question. */
export function looksLikePlannedQuestionTransition(
  text: string,
  locale: string,
): boolean {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  const language = toHeuristicLanguage(locale);
  const signals =
    language === "he"
      ? HE_TRANSITION_SIGNALS
      : language === "ar"
        ? AR_TRANSITION_SIGNALS
        : EN_TRANSITION_SIGNALS;
  return signals.some((sig) => normalized.includes(normalizeForMatch(sig)));
}
