/**
 * Text the browser injects into the live Realtime conversation to steer the
 * host:
 *   - skip / swap requests and "that turn was unintelligible" notices, sent
 *     as a bracketed "system note" inside a user text message (the Realtime
 *     API has no out-of-band channel), and
 *   - the explicit farewell instructions used when the room decides the
 *     interview is over and the host has not said goodbye yet.
 *
 * Every builder takes the INTERVIEW language (he / en / ar), not the UI
 * locale. Hebrew notes are written in Hebrew; English and Arabic interviews
 * get English notes that tell the host which language to answer in (the
 * model follows English instructions most reliably, and the Arabic prompt
 * declares the [SYSTEM NOTE] prefix).
 *
 * Keep the wording in sync with the "system notes" section of
 * supabase/functions/_shared/realtime-instructions.ts.
 */

export type FarewellReason = "tool" | "watchdog" | "student_end" | "skipped_last";

/** Prefixes every directive starts with, in either script. */
const DIRECTIVE_PREFIXES = ["[הודעת מערכת]", "[SYSTEM NOTE]"] as const;

/**
 * True for a skip / swap / unintelligible directive. They travel as user
 * text items, so one can end up stored as a "student" transcript line; the
 * report screen and the scorer hide them.
 */
export function isHostDirective(text: string): boolean {
  const t = text.trimStart();
  return DIRECTIVE_PREFIXES.some((p) => t.startsWith(p));
}

function languageName(language: string): string {
  return language === "ar" ? "Arabic" : language === "he" ? "Hebrew" : "English";
}

export function buildSkipDirective(
  language: string,
  questionNumber: number,
  total: number,
  isLast: boolean,
): string {
  if (language === "he") {
    return [
      `[הודעת מערכת] הסטודנט/ית בחר/ה לדלג על שאלה ${questionNumber} מתוך ${total} בלי לענות עליה.`,
      "אל תתייחסי לזה כתשובה ואל תשפטי את הבחירה. אמרי משפט קצר ונעים אחד (למשל \"בסדר גמור, נמשיך הלאה\").",
      isLast
        ? "זו הייתה השאלה האחרונה: עברי עכשיו ישירות לסיום הראיון לפי פרוטוקול הסיום — משפט סיכום חם, תודה ופרידה — ורק אחרי שסיימת לדבר לגמרי קראי finish_interview."
        : `ואז עברי מיד לשאלה ${questionNumber + 1} מהרשימה, עם הכרזת המספר שלה.`,
      "אל תקריאי את ההודעה הזו בקול.",
    ].join(" ");
  }
  const lang = languageName(language);
  return [
    `[SYSTEM NOTE] The student chose to skip question ${questionNumber} of ${total} without answering it.`,
    "Do not treat this as an answer and do not judge the choice. Say one short, kind sentence (e.g. \"No problem, let's move on\").",
    isLast
      ? "That was the last question: go straight to the closing protocol — a warm acknowledgement, a thank-you and a farewell — and only after you have completely finished speaking call finish_interview."
      : `Then move immediately to question ${questionNumber + 1} from the plan, announcing its ordinal.`,
    `Speak only ${lang}. Do not read this note aloud.`,
  ].join(" ");
}

export function buildReplaceDirective(language: string, questionNumber: number): string {
  if (language === "he") {
    return [
      `[הודעת מערכת] הסטודנט/ית ביקש/ה להחליף את שאלה ${questionNumber} בשאלה אחרת (מותר פעם אחת בראיון, בלי השפעה על ההערכה).`,
      "נסחי עכשיו שאלה חדשה ושונה במהותה על אותו חלק בעבודה או על נושא קרוב מתוך העבודה, במקום השאלה המקורית.",
      `זו עדיין שאלה ${questionNumber} — אל תכריזי על מספר חדש. אל תשפטי את הבקשה ואל תקריאי את ההודעה הזו בקול.`,
    ].join(" ");
  }
  const lang = languageName(language);
  return [
    `[SYSTEM NOTE] The student asked to swap question ${questionNumber} for a different one (allowed once per interview, no effect on the evaluation).`,
    "Ask a new, substantially different question about the same part of the submission or a closely related topic from it, in place of the original.",
    `It is still question ${questionNumber} — do not announce a new ordinal. Speak only ${lang}. Do not judge the request and do not read this note aloud.`,
  ].join(" ");
}

export type UnintelligibleKind = "off_language" | "noise";

/**
 * Sent when the transcript guard rejected the student's last turn. The host
 * has already heard the audio natively and may be mid-reply; the room
 * cancels that reply and asks for this one instead, so the host never builds
 * on noise or on a different language.
 */
export function buildUnintelligibleDirective(
  language: string,
  kind: UnintelligibleKind,
): string {
  if (language === "he") {
    return [
      kind === "off_language"
        ? "[הודעת מערכת] הקטע האחרון שנקלט מהמיקרופון לא היה בעברית."
        : "[הודעת מערכת] הקטע האחרון שנקלט מהמיקרופון היה רעש או דיבור לא מובן, לא תשובה.",
      "אל תתייחסי אליו כתשובה, אל תסכמי אותו ואל תמציאי מה נאמר.",
      kind === "off_language"
        ? "אמרי בעברית, במשפט קצר ונעים, שהראיון מתנהל בעברית ובקשי לענות שוב בעברית, ואז חזרי בקצרה על השאלה הנוכחית."
        : "אמרי בעברית, במשפט קצר ונעים, שלא הצלחת לשמוע ובקשי לענות שוב, ואז חזרי בקצרה על השאלה הנוכחית.",
      "אל תתקדמי לשאלה הבאה. אל תקריאי את ההודעה הזו בקול.",
    ].join(" ");
  }
  const lang = languageName(language);
  return [
    kind === "off_language"
      ? `[SYSTEM NOTE] The last turn picked up by the microphone was not in ${lang}.`
      : "[SYSTEM NOTE] The last turn picked up by the microphone was noise or unintelligible speech, not an answer.",
    "Do not treat it as an answer, do not summarise it and do not invent what was said.",
    kind === "off_language"
      ? `Say, in one short kind sentence in ${lang}, that the interview is conducted in ${lang} and ask them to answer again in ${lang}, then briefly repeat the current question.`
      : `Say, in one short kind sentence in ${lang}, that you could not hear that and ask them to answer again, then briefly repeat the current question.`,
    "Do not move on to the next question. Do not read this note aloud.",
  ].join(" ");
}

export interface FarewellContext {
  /** Title of the submission, so the goodbye cannot drift to another topic. */
  assignmentTitle?: string;
  /**
   * False when no usable student answer was captured: a dead microphone, or
   * a student who ended / skipped before answering. The goodbye then stays
   * neutral (no recap) and never guesses at a cause.
   */
  studentSpoke: boolean;
}

/**
 * Per-response instructions for the farewell the browser requests when the
 * interview ends and the host has not said goodbye yet. These REPLACE the
 * session prompt for that one response, so the persona, the language and
 * the grounding rules are restated. When the student never managed to say
 * anything, the goodbye is explicitly neutral: no invented recap.
 */
export function buildFarewellInstructions(
  language: string,
  reason: FarewellReason,
  context: FarewellContext = { studentSpoke: true },
): string {
  const title = context.assignmentTitle?.trim() ?? "";
  if (language === "he") {
    const situation =
      reason === "student_end"
        ? "הסטודנט/ית ביקש/ה לסיים כאן, וזה בסדר גמור."
        : reason === "skipped_last"
          ? "הסטודנט/ית דילג/ה על השאלה האחרונה והראיון הסתיים."
          : "כל השאלות המתוכננות כוסו והראיון הסתיים.";
    const grounding = context.studentSpoke
      ? "משפט ההערכה מתבסס אך ורק על דברים שהסטודנט/ית אמר/ה בפועל בשיחה הזו; אם את לא בטוחה, השאירי אותו כללי. אל תזכירי נושאים, מטלות או שיחות אחרות."
      : "בשיחה הזו לא נקלטה אף תשובה מהסטודנט/ית. אל תעמידי פנים שהתקיימה שיחה, אל תזכירי שום תוכן ואל תנחשי למה (אל תזכירי מיקרופון או תקלה): אמרי בעדינות שלא יצא לך לשמוע הפעם את המחשבות שלו/ה, הודי על הזמן, ואחלי בהצלחה.";
    return [
      "את מנחת הפודקאסט האקדמי Podtask, מדברת בעברית בלבד, בקול חם, טבעי ואנושי, בגוף שני נקבה כברירת מחדל.",
      title ? `הראיון עסק בעבודה "${title}".` : "",
      situation,
      context.studentSpoke
        ? "אמרי עכשיו, בקול, פרידה קצרה ואנושית (שלושה עד ארבעה משפטים) שכוללת, לפי הסדר: משפט הערכה חם ואישי על השיחה שהייתה לכן (בלי ציון ובלי משוב על נכונות), תודה מפורשת על ההשתתפות, ומשפט פרידה עם איחול להמשך."
        : "אמרי עכשיו, בקול, פרידה קצרה ואנושית (שניים עד שלושה משפטים): משפט חם אחד על כך שלא יצא לך לשמוע הפעם את המחשבות שלו/ה, תודה על הזמן, ומשפט פרידה עם איחול להמשך.",
      grounding,
      "אל תשאלי שאלות, אל תחכי לתשובה, אל תזכירי כלים או מערכת, ואל תגידי שאת AI.",
    ]
      .filter(Boolean)
      .join(" ");
  }
  const lang = languageName(language);
  const situation =
    reason === "student_end"
      ? "The student asked to stop here, and that is perfectly fine."
      : reason === "skipped_last"
        ? "The student skipped the final question and the interview is over."
        : "All planned questions have been covered and the interview is over.";
  const grounding = context.studentSpoke
    ? "The acknowledgement must be based only on things the student actually said in this conversation; if unsure, keep it general. Never mention other topics, assignments or conversations."
    : "No usable answer from the student was captured in this conversation. Do not pretend a conversation took place, do not mention any content, and do not guess at a reason (no mention of microphones or technical problems): say gently that you did not get to hear their thoughts this time, thank them for their time, and wish them well.";
  return [
    `You are the host of the academic podcast Podtask, speaking warm, natural, human ${lang} and nothing but ${lang}.`,
    title ? `The interview was about the submission "${title}".` : "",
    situation,
    context.studentSpoke
      ? "Say now, out loud, a short human farewell (three to four sentences) that contains, in order: one warm, personal acknowledgement of the conversation you just had (no grade, no correctness feedback), an explicit thank-you for participating, and a farewell line with a well-wish."
      : "Say now, out loud, a short human farewell (two to three sentences): one warm line that you did not get to hear their thoughts this time, a thank-you for their time, and a farewell line with a well-wish.",
    grounding,
    "Do not ask questions, do not wait for a reply, do not mention tools or the system, and do not say you are an AI.",
  ]
    .filter(Boolean)
    .join(" ");
}
