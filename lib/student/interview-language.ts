/**
 * The language an interview is conducted in. Chosen by the student in the
 * lobby and stored on `interviews.language`; the host speaks, listens and is
 * transcribed in this language only (see `create-realtime-session`).
 *
 * This is independent of the UI locale (he / en): a student can run the app
 * in Hebrew and be interviewed in Arabic.
 */
export type InterviewLanguage = "he" | "en" | "ar";

export const INTERVIEW_LANGUAGES: readonly InterviewLanguage[] = ["he", "en", "ar"];

export function isInterviewLanguage(value: unknown): value is InterviewLanguage {
  return value === "he" || value === "en" || value === "ar";
}

/** Coerces a stored / untyped value to a supported language (default `he`). */
export function normalizeInterviewLanguage(
  value: unknown,
  fallback: InterviewLanguage = "he",
): InterviewLanguage {
  return isInterviewLanguage(value) ? value : fallback;
}

/** Hebrew and Arabic are written right to left. */
export function isRtlInterviewLanguage(language: InterviewLanguage): boolean {
  return language === "he" || language === "ar";
}
