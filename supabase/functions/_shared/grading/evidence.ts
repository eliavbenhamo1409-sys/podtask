/**
 * Evidence verification: every quote the model cites must exist, verbatim
 * or near-verbatim, in the student's own turns for that question. A quote
 * that cannot be located is kept (it is part of the model's output) but
 * marked `verified: false`, and the question's evidence status drives the
 * second-pass and human-review rules in `pipeline.ts`.
 *
 * Matching is token based using the same normalisation as the integrity
 * overlap check (`../overlap.ts`): case, diacritics, Hebrew final letters,
 * one leading Hebrew clitic. A quote verifies when at least
 * `MIN_MATCH_RATIO` of its tokens appear as ONE contiguous run in a single
 * turn, so a model that trims or lightly paraphrases a sentence still
 * verifies, while an invented sentence does not.
 */
import { tokenize } from "../overlap.ts";
import type { Criterion, Turn, VerifiedEvidence } from "./types.ts";

export const EVIDENCE_RULES = {
  /** Quotes with fewer tokens than this are never verifiable (too generic). */
  minQuoteTokens: 3,
  /** Share of quote tokens that must match as one contiguous run. */
  minMatchRatio: 0.8,
  /** Quotes are truncated to this many tokens before matching. */
  maxQuoteTokens: 60,
} as const;

interface Match {
  ratio: number;
  turn: Turn | null;
  start: number | null;
  end: number | null;
}

/** Longest common contiguous token run between `quote` and `turn` (classic O(m*n) DP). */
function longestCommonRun(
  quote: string[],
  turnTokens: ReturnType<typeof tokenize>,
): { length: number; turnEnd: number } {
  const m = quote.length;
  const n = turnTokens.length;
  if (m === 0 || n === 0) return { length: 0, turnEnd: -1 };
  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  let best = 0;
  let bestEnd = -1;
  for (let i = 1; i <= m; i++) {
    const qi = quote[i - 1];
    for (let j = 1; j <= n; j++) {
      if (qi === turnTokens[j - 1].norm) {
        const v = prev[j - 1] + 1;
        cur[j] = v;
        if (v > best) {
          best = v;
          bestEnd = j - 1;
        }
      } else {
        cur[j] = 0;
      }
    }
    const t = prev;
    prev = cur;
    cur = t;
    cur.fill(0);
  }
  return { length: best, turnEnd: bestEnd };
}

export function locateQuote(quote: string, turns: Turn[]): Match {
  const quoteTokens = tokenize(quote)
    .map((t) => t.norm)
    .slice(0, EVIDENCE_RULES.maxQuoteTokens);
  const none: Match = { ratio: 0, turn: null, start: null, end: null };
  if (quoteTokens.length < EVIDENCE_RULES.minQuoteTokens) return none;
  let best = none;
  for (const turn of turns) {
    const turnTokens = tokenize(turn.content);
    const run = longestCommonRun(quoteTokens, turnTokens);
    if (run.length === 0) continue;
    const ratio = run.length / quoteTokens.length;
    if (ratio > best.ratio) {
      const endTok = turnTokens[run.turnEnd];
      const startTok = turnTokens[run.turnEnd - run.length + 1];
      best = { ratio, turn, start: startTok.start, end: endTok.end };
    }
    if (best.ratio >= 1) break;
  }
  return best;
}

export function verifyEvidence(
  evidence: Array<{ quote: string; criterion: Criterion }>,
  studentTurns: Turn[],
): VerifiedEvidence[] {
  return evidence.map((e) => {
    const quote = (e.quote ?? "").trim();
    const match = locateQuote(quote, studentTurns);
    const verified = match.ratio >= EVIDENCE_RULES.minMatchRatio;
    return {
      quote,
      criterion: e.criterion,
      verified,
      messageId: verified && match.turn ? match.turn.messageId : null,
      start: verified ? match.start : null,
      end: verified ? match.end : null,
      matchRatio: Math.round(match.ratio * 100) / 100,
    };
  });
}
