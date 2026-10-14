/**
 * Picks the document passages worth showing the evaluator for one question.
 *
 * The document is CONTEXT for checking the student's claims, never a
 * substitute for what they said (the prompt repeats this). Selection is
 * lexical and deterministic: the chunk whose distinct normalised tokens
 * overlap most with the question's anchor, key points and wording wins.
 * No embeddings are involved, so the same inputs always select the same
 * passages (part of the reproducibility contract).
 */
import { tokenize } from "../overlap.ts";
import type { DocumentChunk, PlanQuestion } from "./types.ts";

export const CONTEXT_RULES = {
  maxChunks: 2,
  maxCharsPerChunk: 1200,
  maxTotalChars: 2200,
  /** Tokens shorter than this carry no signal (clitics, digits). */
  minTokenLength: 3,
} as const;

function tokenSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) if (t.norm.length >= CONTEXT_RULES.minTokenLength) out.add(t.norm);
  return out;
}

export interface SelectedPassage {
  chunkIndex: number;
  text: string;
  score: number;
}

export function selectPassages(question: PlanQuestion, chunks: DocumentChunk[]): SelectedPassage[] {
  if (chunks.length === 0) return [];
  const query = tokenSet([question.anchor, ...question.keyPoints, question.question, question.topic].join(" "));
  if (query.size === 0) return [];

  const scored = chunks.map((c) => {
    const tokens = tokenSet(c.content);
    let hits = 0;
    for (const t of query) if (tokens.has(t)) hits += 1;
    // Favour overlap share, with a small length-independent bonus for the
    // anchor sentence itself being present verbatim.
    const anchorBonus = question.anchor && c.content.includes(question.anchor) ? 0.5 : 0;
    return { chunk: c, score: hits / query.size + anchorBonus };
  });
  scored.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);

  const out: SelectedPassage[] = [];
  let total = 0;
  for (const s of scored) {
    if (out.length >= CONTEXT_RULES.maxChunks) break;
    if (s.score <= 0 && out.length > 0) break;
    const text = clip(s.chunk.content, CONTEXT_RULES.maxCharsPerChunk);
    if (total + text.length > CONTEXT_RULES.maxTotalChars && out.length > 0) break;
    out.push({ chunkIndex: s.chunk.index, text, score: Math.round(s.score * 1000) / 1000 });
    total += text.length;
  }
  return out;
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + " …";
}
