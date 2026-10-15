/**
 * Verbatim-overlap check between a spoken answer and the submitted document.
 *
 * Pure text processing, no model: the answer is tokenised, lightly
 * normalised (case, punctuation, Hebrew / Arabic diacritics, Hebrew final
 * letters, one leading Hebrew clitic on longer words) and compared with the
 * document through fixed-size token shingles. Two numbers come out:
 *
 *   score       share of the answer's shingles that also occur in the document
 *   longestRun  the longest run of consecutive answer tokens found verbatim
 *               in the document (the "read a whole sentence" signal)
 *
 * `isSignificantOverlap` turns them into a yes/no with conservative
 * thresholds: short answers are never judged, and a run of professional
 * terms does not count, only a long verbatim sequence or a large share of
 * the answer. The matched passage is returned so a reviewer can see it.
 *
 * Mirror of `supabase/functions/_shared/overlap.ts` for the live room; keep in sync.
 */

export interface OverlapResult {
  /** 0..1 share of answer shingles present in the document. */
  score: number;
  /** Longest verbatim run, in tokens. */
  longestRun: number;
  /** Number of answer tokens (after normalisation). */
  answerTokens: number;
  /** The document passage matching the longest run, in its original wording. */
  passage: string | null;
  /** The answer span matching the longest run, in its original wording. */
  answerExcerpt: string | null;
}

export interface OverlapOptions {
  /** Shingle size in tokens. */
  n?: number;
  /** Answers shorter than this (tokens) are never judged. */
  minAnswerTokens?: number;
}

export const OVERLAP_THRESHOLDS = {
  shingle: 6,
  minAnswerTokens: 25,
  /** A run at least this long is "a sentence read aloud". */
  significantRun: 12,
  /** Or this share of the answer's shingles matching the document. */
  significantScore: 0.35,
} as const;

interface Token {
  norm: string;
  start: number;
  end: number;
}

const HEBREW_FINALS: Record<string, string> = {
  "ך": "כ",
  "ם": "מ",
  "ן": "נ",
  "ף": "פ",
  "ץ": "צ",
};

// Hebrew niqqud + cantillation, Arabic harakat / tatweel.
const DIACRITICS = /[\u0591-\u05C7\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
const WORD_RE = /[\p{L}\p{N}]+(?:['’"״׳-][\p{L}\p{N}]+)*/gu;
const HEBREW_CLITICS = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ"]);

export function normalizeToken(raw: string): string {
  let t = raw.toLowerCase().replace(DIACRITICS, "").replace(/['’"״׳-]/g, "");
  t = t.replace(/[ךםןףץ]/g, (c) => HEBREW_FINALS[c] ?? c);
  // One leading Hebrew clitic (and-, the-, in-, to-, from-, that-, as-) on
  // words long enough to still be a word without it.
  if (t.length >= 4 && /[א-ת]/.test(t) && HEBREW_CLITICS.has(t[0])) {
    t = t.slice(1);
  }
  return t;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(WORD_RE)) {
    const norm = normalizeToken(m[0]);
    if (!norm) continue;
    out.push({ norm, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

function shingleKey(tokens: Token[], from: number, n: number): string {
  let key = tokens[from].norm;
  for (let i = 1; i < n; i++) key += " " + tokens[from + i].norm;
  return key;
}

/**
 * Pre-indexed document so many answers can be checked cheaply.
 */
export class DocumentIndex {
  readonly tokens: Token[];
  readonly text: string;
  private readonly n: number;
  private readonly positions = new Map<string, number[]>();

  constructor(text: string, n = OVERLAP_THRESHOLDS.shingle) {
    this.text = text;
    this.n = n;
    this.tokens = tokenize(text);
    for (let i = 0; i + n <= this.tokens.length; i++) {
      const key = shingleKey(this.tokens, i, n);
      const list = this.positions.get(key);
      if (list) list.push(i);
      else this.positions.set(key, [i]);
    }
  }

  get shingleSize(): number {
    return this.n;
  }

  lookup(key: string): number[] | undefined {
    return this.positions.get(key);
  }
}

export function computeOverlap(
  answer: string,
  doc: DocumentIndex,
  opts: OverlapOptions = {},
): OverlapResult {
  const n = doc.shingleSize;
  const minTokens = opts.minAnswerTokens ?? OVERLAP_THRESHOLDS.minAnswerTokens;
  const answerTokens = tokenize(answer);
  const empty: OverlapResult = {
    score: 0,
    longestRun: 0,
    answerTokens: answerTokens.length,
    passage: null,
    answerExcerpt: null,
  };
  if (answerTokens.length < Math.max(n, minTokens)) return empty;

  let matchedShingles = 0;
  let totalShingles = 0;
  let best = { len: 0, answerStart: 0, docStart: 0 };

  for (let i = 0; i + n <= answerTokens.length; i++) {
    totalShingles += 1;
    const hits = doc.lookup(shingleKey(answerTokens, i, n));
    if (!hits) continue;
    matchedShingles += 1;
    // Extend each hit forward to measure the verbatim run that starts here.
    for (const d of hits) {
      let len = n;
      while (
        i + len < answerTokens.length &&
        d + len < doc.tokens.length &&
        answerTokens[i + len].norm === doc.tokens[d + len].norm
      ) {
        len += 1;
      }
      if (len > best.len) best = { len, answerStart: i, docStart: d };
    }
  }

  const score = totalShingles ? matchedShingles / totalShingles : 0;
  if (best.len === 0) return { ...empty, score };

  const docFrom = doc.tokens[best.docStart];
  const docTo = doc.tokens[best.docStart + best.len - 1];
  const ansFrom = answerTokens[best.answerStart];
  const ansTo = answerTokens[best.answerStart + best.len - 1];
  return {
    score,
    longestRun: best.len,
    answerTokens: answerTokens.length,
    passage: doc.text.slice(docFrom.start, docTo.end),
    answerExcerpt: answer.slice(ansFrom.start, ansTo.end),
  };
}

export function isSignificantOverlap(result: OverlapResult): boolean {
  if (result.answerTokens < OVERLAP_THRESHOLDS.minAnswerTokens) return false;
  return (
    result.longestRun >= OVERLAP_THRESHOLDS.significantRun ||
    result.score >= OVERLAP_THRESHOLDS.significantScore
  );
}
