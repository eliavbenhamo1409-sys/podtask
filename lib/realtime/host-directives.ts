/**
 * Text the browser injects into the live Realtime conversation to steer the
 * host:
 *   - skip / swap requests, sent as a bracketed "system note" inside a user
 *     text message (the Realtime API has no out-of-band channel), and
 *   - the explicit farewell instructions used when the room decides the
 *     interview is over and the host has not said goodbye yet.
 *
 * Keep the wording in sync with the "system notes" section of
 * supabase/functions/_shared/realtime-instructions.ts.
 */

export type FarewellReason = "tool" | "watchdog" | "student_end" | "skipped_last";

/** Prefixes every skip / swap directive starts with, in either locale. */
const DIRECTIVE_PREFIXES = ["[הודעת מערכת]", "[SYSTEM NOTE]"] as const;

/**
 * True for a skip / swap directive. They travel as user text items, so one
 * can end up stored as a "student" transcript line; the report screen hides
 * them.
 */
export function isHostDirective(text: string): boolean {
  const t = text.trimStart();
  return DIRECTIVE_PREFIXES.some((p) => t.startsWith(p));
}

export function buildSkipDirective(
  locale: string,
  questionNumber: number,
  total: number,
  isLast: boolean,
): string {
  if (locale === "he") {
    return [
      `[הודעת מערכת] הסטודנט/ית בחר/ה לדלג על שאלה ${questionNumber} מתוך ${total} בלי לענות עליה.`,
      "אל תתייחסי לזה כתשובה ואל תשפטי את הבחירה. אמרי משפט קצר ונעים אחד (למשל \"בסדר גמור, נמשיך הלאה\").",
      isLast
        ? "זו הייתה השאלה האחרונה: עברי עכשיו ישירות לסיום הראיון לפי פרוטוקול הסיום — משפט סיכום חם, תודה ופרידה — ורק אחרי שסיימת לדבר לגמרי קראי finish_interview."
        : `ואז עברי מיד לשאלה ${questionNumber + 1} מהרשימה, עם הכרזת המספר שלה.`,
      "אל תקריאי את ההודעה הזו בקול.",
    ].join(" ");
  }
  return [
    `[SYSTEM NOTE] The student chose to skip question ${questionNumber} of ${total} without answering it.`,
    "Do not treat this as an answer and do not judge the choice. Say one short, kind sentence (e.g. \"No problem, let's move on\").",
    isLast
      ? "That was the last question: go straight to the closing protocol — a warm acknowledgement, a thank-you and a farewell — and only after you have completely finished speaking call finish_interview."
      : `Then move immediately to question ${questionNumber + 1} from the plan, announcing its ordinal.`,
    "Do not read this note aloud.",
  ].join(" ");
}

export function buildReplaceDirective(locale: string, questionNumber: number): string {
  if (locale === "he") {
    return [
      `[הודעת מערכת] הסטודנט/ית ביקש/ה להחליף את שאלה ${questionNumber} בשאלה אחרת (מותר פעם אחת בראיון, בלי השפעה על ההערכה).`,
      "נסחי עכשיו שאלה חדשה ושונה במהותה על אותו חלק בעבודה או על נושא קרוב מתוך העבודה, במקום השאלה המקורית.",
      `זו עדיין שאלה ${questionNumber} — אל תכריזי על מספר חדש. אל תשפטי את הבקשה ואל תקריאי את ההודעה הזו בקול.`,
    ].join(" ");
  }
  return [
    `[SYSTEM NOTE] The student asked to swap question ${questionNumber} for a different one (allowed once per interview, no effect on the evaluation).`,
    "Ask a new, substantially different question about the same part of the submission or a closely related topic from it, in place of the original.",
    `It is still question ${questionNumber} — do not announce a new ordinal. Do not judge the request and do not read this note aloud.`,
  ].join(" ");
}

/**
 * Per-response instructions for the farewell the browser requests when the
 * interview ends and the host has not said goodbye yet. These REPLACE the
 * session prompt for that one response, so the persona is restated.
 */
export function buildFarewellInstructions(locale: string, reason: FarewellReason): string {
  if (locale === "he") {
    const context =
      reason === "student_end"
        ? "הסטודנט/ית ביקש/ה לסיים כאן, וזה בסדר גמור."
        : reason === "skipped_last"
          ? "הסטודנט/ית דילג/ה על השאלה האחרונה והראיון הסתיים."
          : "כל השאלות המתוכננות כוסו והראיון הסתיים.";
    return [
      "את מנחת הפודקאסט האקדמי Podtask, מדברת בעברית בקול חם, טבעי ואנושי, בגוף שני נקבה כברירת מחדל.",
      context,
      "אמרי עכשיו, בקול, פרידה קצרה ואנושית (שלושה עד ארבעה משפטים) שכוללת, לפי הסדר: משפט הערכה חם ואישי על השיחה שהייתה לכן (בלי ציון ובלי משוב על נכונות), תודה מפורשת על ההשתתפות, ומשפט פרידה עם איחול להמשך.",
      "אל תשאלי שאלות, אל תחכי לתשובה, אל תזכירי כלים או מערכת, ואל תגידי שאת AI.",
    ].join(" ");
  }
  const context =
    reason === "student_end"
      ? "The student asked to stop here, and that is perfectly fine."
      : reason === "skipped_last"
        ? "The student skipped the final question and the interview is over."
        : "All planned questions have been covered and the interview is over.";
  return [
    "You are the host of the academic podcast Podtask, speaking warm, natural, human English.",
    context,
    "Say now, out loud, a short human farewell (three to four sentences) that contains, in order: one warm, personal acknowledgement of the conversation you just had (no grade, no correctness feedback), an explicit thank-you for participating, and a farewell line with a well-wish.",
    "Do not ask questions, do not wait for a reply, do not mention tools or the system, and do not say you are an AI.",
  ].join(" ");
}
