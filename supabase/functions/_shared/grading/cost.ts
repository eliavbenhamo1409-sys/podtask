/**
 * Price table for cost estimates (USD per 1M tokens). These are list prices
 * as known when this file was written; they are an ESTIMATE for the usage
 * logs and the benchmark, not an invoice. Update when OpenAI changes pricing
 * or when a model is added to the benchmark.
 */
import type { Usage } from "./types.ts";

export interface ModelPrice {
  input: number;
  output: number;
  /** Cached-input price when the API reports cached tokens (not used yet). */
  cachedInput?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-4.1": { input: 2.0, output: 8.0, cachedInput: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cachedInput: 0.1 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4, cachedInput: 0.025 },
  "gpt-5": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
  "gpt-4o": { input: 2.5, output: 10.0, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
  // Realtime (voice) is priced per audio token; listed for the per-interview estimate only.
  "gpt-realtime:audio": { input: 32.0, output: 64.0, cachedInput: 0.4 },
  "gpt-realtime:text": { input: 4.0, output: 16.0, cachedInput: 0.4 },
  "gpt-4o-transcribe": { input: 6.0, output: 10.0 },
  mock: { input: 0, output: 0 },
};

export function priceFor(model: string): ModelPrice | null {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  // "gpt-4.1-2025-04-14" style snapshots fall back to the family price.
  const family = Object.keys(MODEL_PRICES).find((k) => model.startsWith(k));
  return family ? MODEL_PRICES[family] : null;
}

export function estimateCostUsd(model: string, usage: Usage | null): number {
  if (!usage) return 0;
  const p = priceFor(model);
  if (!p) return 0;
  const cost = (usage.inputTokens / 1_000_000) * p.input + (usage.outputTokens / 1_000_000) * p.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
