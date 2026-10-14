/**
 * Pure checks over one transcribed student utterance (no React, no DOM).
 *
 * The live room runs every final student transcript through
 * `assessStudentUtterance` before treating it as an answer. Anything that is
 * clearly not the student answering in the interview language is rejected:
 *
 *   off_language  the text is written in another script than the interview
 *                 language (a Hebrew interview where a whole turn came out in
 *                 Latin or Cyrillic letters, or the other way round)
 *   noise         transcription artefacts: the classic phrases speech models
 *                 invent on silence / noise ("thank you for watching"), a
 *                 looping word, or an echo of the transcription hint
 *
 * A rejected utterance is recorded as a `discarded_utterance:<verdict>`
 * system line (the report ignores it) and the host is told, through a
 * system note, not to treat it as an answer. The thresholds are deliberately
 * lenient: the script check counts WORDS, so a Hebrew sentence whose content
 * words are Latin tool or author names passes as long as its frame is
 * Hebrew; an artefact phrase only counts when it is (nearly) the whole
 * turn; a prompt echo only when (nearly) the whole prompt comes back; and
 * short utterances are never judged at all.
 */
import type { InterviewLanguage } from "@/lib/student/interview-language";

export type UtteranceVerdict = "ok" | "off_language" | "noise";

export interface UtteranceGuardOptions {
  language: InterviewLanguage;
  /**
   * The transcription prompt the session was minted with. Speech models can
   * echo their prompt back on silence, so an utterance that merely repeats
   * it is treated as noise.
   */
  transcriptionHint?: string | null;
}

// Below this many words (with letters) an utterance is too short to judge
// ("כן", "ok", "gradient descent", a number): it is accepted as is.
const MIN_WORDS_TO_JUDGE = 4;
// With this many words or more, a tiny share of expected-script words is
// still off-language ("one Hebrew prefix in an English sentence").
const RATIO_MIN_WORDS = 6;
const MIN_EXPECTED_WORD_SHARE = 0.15;
// Looping transcripts ("the the the the …"): many tokens, few distinct ones.
const LOOP_MIN_TOKENS = 8;
const LOOP_MAX_UNIQUE_RATIO = 0.25;
// An artefact phrase must make up (nearly) the whole turn.
const PHRASE_MIN_COVER = 0.6;
// A prompt echo must reproduce (nearly) the whole prompt.
const ECHO_MIN_COVER = 0.8;

const EXPECTED_SCRIPT: Record<InterviewLanguage, RegExp> = {
  he: /[֐-׿]/u,
  ar: /[؀-ۿݐ-ݿࢠ-ࣿ]/u,
  en: /[A-Za-zÀ-ɏ]/u,
};

// Phrases speech-to-text models produce on silence, music or noise, in the
// three interview languages. Compared after normalisation (lowercase, no
// punctuation, no Arabic diacritics). Multi-word only: a single generic
// word ("music", "תרגום") can be a real one-word answer.
const HALLUCINATION_PHRASES: readonly string[] = [
  "thank you for watching",
  "thanks for watching",
  "thank you so much for watching",
  "subtitles by the amara org community",
  "subtitles by",
  "amara org",
  "please subscribe",
  "like and subscribe",
  "see you in the next video",
  "תודה שצפיתם",
  "תודה על הצפייה",
  "תרגום וכתוביות",
  "כתוביות על ידי",
  "اشتركوا في القناة",
  "ترجمة نانسي قنقر",
  "شكرا للمشاهدة",
  "شكرا على المشاهدة",
];

export function assessStudentUtterance(
  text: string,
  { language, transcriptionHint }: UtteranceGuardOptions,
): UtteranceVerdict {
  const raw = (text ?? "").trim();
  if (!raw) return "noise";

  const normalized = normalizeForGuard(raw);
  if (!normalized) return "noise";

  // Echo of the transcription prompt: only when (nearly) the whole prompt
  // comes back. The prompt is seeded with the title and key concepts, which
  // are exactly the words a terse on-topic answer uses, so a substring of it
  // is never evidence of an echo.
  if (transcriptionHint) {
    const hint = normalizeForGuard(transcriptionHint);
    if (
      hint.length >= 12 &&
      (normalized === hint ||
        normalized.includes(hint) ||
        (hint.includes(normalized) && normalized.length >= ECHO_MIN_COVER * hint.length))
    ) {
      return "noise";
    }
  }

  // Known artefact phrases, when they make up (nearly) the whole turn.
  for (const phrase of HALLUCINATION_PHRASES) {
    if (normalized === phrase) return "noise";
    if (normalized.includes(phrase) && phrase.length >= PHRASE_MIN_COVER * normalized.length) {
      return "noise";
    }
  }

  // Looping output.
  const tokens = normalized.split(" ").filter((t) => t.length > 0);
  if (tokens.length >= LOOP_MIN_TOKENS) {
    const unique = new Set(tokens).size;
    if (unique / tokens.length <= LOOP_MAX_UNIQUE_RATIO) return "noise";
  }

  // Script check, per word: a word counts for the interview language when it
  // contains at least one letter of its script. Unvowelled Hebrew / Arabic
  // words are short and Latin identifiers are long, so counting letters
  // would let one "TypeScript" outweigh a whole Hebrew sentence frame.
  const expectedScript = EXPECTED_SCRIPT[language];
  let letterWords = 0;
  let expectedWords = 0;
  for (const token of tokens) {
    if (!/\p{L}/u.test(token)) continue;
    letterWords += 1;
    if (expectedScript.test(token)) expectedWords += 1;
  }
  if (letterWords < MIN_WORDS_TO_JUDGE) return "ok";
  if (expectedWords === 0) return "off_language";
  if (
    letterWords >= RATIO_MIN_WORDS &&
    expectedWords / letterWords < MIN_EXPECTED_WORD_SHARE
  ) {
    return "off_language";
  }

  return "ok";
}

/** Lowercase, strip punctuation, Arabic diacritics and extra spaces. */
export function normalizeForGuard(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[.,!?;:()[\]{}"'`“”״׳\-–—…♪♫]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
