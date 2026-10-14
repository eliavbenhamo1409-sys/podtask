/**
 * Model providers for the grading engine.
 *
 *   createOpenAIProvider  Responses API with strict JSON schema, usage and
 *                         rate-limit headers captured, retries with
 *                         exponential backoff + jitter on 429 / 5xx /
 *                         network errors, honouring Retry-After.
 *   createMockProvider    deterministic, offline. Scores are derived from
 *                         how many of the question's key points the student's
 *                         words cover, so the whole pipeline (evidence
 *                         verification, scoring, persistence, queue) can be
 *                         exercised in tests and load runs with zero cost.
 *
 * Neither provider touches Deno / Node globals beyond `fetch`, `setTimeout`
 * and `performance`.
 */
import { tokenize } from "../overlap.ts";
import type { PromptMessage } from "./prompt.ts";
import type {
  Criterion,
  ModelEvaluation,
  Narrative,
  QuestionMaterial,
  Usage,
} from "./types.ts";
import { applicableCriteria } from "./rubric.ts";

export type ProviderOperation = "evaluate" | "verify" | "narrative";

export interface ProviderRequest {
  operation: ProviderOperation;
  model: string;
  input: PromptMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  /** Side information the mock provider uses; ignored by OpenAI. */
  meta?: { caseId?: string; material?: QuestionMaterial; pass?: 1 | 2 };
}

export interface ProviderResponse<T> {
  parsed: T;
  usage: Usage | null;
  responseId: string | null;
  model: string;
  latencyMs: number;
  rateLimit: Record<string, string> | null;
  attempts: number;
}

export interface GradingProvider {
  readonly name: string;
  call<T>(req: ProviderRequest): Promise<ProviderResponse<T>>;
}

export class ProviderError extends Error {
  status: number;
  retryAfterMs: number | null;
  body: string;
  constructor(message: string, status: number, body: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

const RATE_LIMIT_HEADERS = [
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-requests",
  "x-ratelimit-reset-tokens",
  "retry-after",
  "retry-after-ms",
];

function parseRetryAfter(headers: Headers): number | null {
  const ms = headers.get("retry-after-ms");
  if (ms && /^\d+$/.test(ms)) return Number.parseInt(ms, 10);
  const s = headers.get("retry-after");
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number.parseInt(s, 10) * 1000;
  const date = Date.parse(s);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function extractParsedJson(res: Record<string, unknown>): unknown {
  if (res.output_parsed !== undefined) return res.output_parsed;
  const output = res.output as Array<{ content?: Array<{ parsed?: unknown; text?: string }> }> | undefined;
  if (Array.isArray(output)) {
    for (const item of output) {
      for (const part of item?.content ?? []) {
        if (part.parsed !== undefined) return part.parsed;
        if (typeof part.text === "string" && part.text.trim()) {
          try {
            return JSON.parse(part.text);
          } catch {
            // try the next part
          }
        }
      }
    }
  }
  if (typeof res.output_text === "string" && res.output_text.trim()) {
    try {
      return JSON.parse(res.output_text);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  /** Base delay for exponential backoff (ms). */
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
}

export function createOpenAIProvider(opts: OpenAIProviderOptions): GradingProvider {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const maxDelay = opts.maxDelayMs ?? 20_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const baseUrl = (opts.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 90_000;

  return {
    name: "openai",
    async call<T>(req: ProviderRequest): Promise<ProviderResponse<T>> {
      const body = {
        model: req.model,
        input: req.input,
        text: { format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.schema } },
        temperature: req.temperature,
        max_output_tokens: req.maxOutputTokens,
      };
      const started = Date.now();
      let lastErr: ProviderError | null = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          const retryAfter = lastErr?.retryAfterMs ?? null;
          const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
          const jitter = backoff * (0.5 + random());
          await sleep(retryAfter !== null ? Math.min(maxDelay * 3, retryAfter + random() * 500) : jitter);
        }
        let r: Response;
        try {
          const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
          const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
          r = await fetchImpl(`${baseUrl}/v1/responses`, {
            method: "POST",
            headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: ctrl?.signal,
          });
          if (timer) clearTimeout(timer);
        } catch (err) {
          lastErr = new ProviderError("openai_network_error", 0, err instanceof Error ? err.message : String(err));
          continue;
        }
        const rateLimit: Record<string, string> = {};
        for (const h of RATE_LIMIT_HEADERS) {
          const v = r.headers.get(h);
          if (v) rateLimit[h] = v;
        }
        if (r.ok) {
          const json = (await r.json()) as Record<string, unknown>;
          const parsed = extractParsedJson(json);
          if (parsed === undefined) {
            throw new ProviderError("openai_responses_no_output", 502, JSON.stringify(json).slice(0, 600));
          }
          const u = json.usage as { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined;
          return {
            parsed: parsed as T,
            usage: u
              ? {
                  inputTokens: u.input_tokens ?? 0,
                  outputTokens: u.output_tokens ?? 0,
                  totalTokens: u.total_tokens ?? (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
                }
              : null,
            responseId: typeof json.id === "string" ? json.id : null,
            model: typeof json.model === "string" ? json.model : req.model,
            latencyMs: Date.now() - started,
            rateLimit: Object.keys(rateLimit).length ? rateLimit : null,
            attempts: attempt + 1,
          };
        }
        const text = await r.text().catch(() => "");
        lastErr = new ProviderError(`openai_responses_${r.status}`, r.status, text.slice(0, 600), parseRetryAfter(r.headers));
        if (!lastErr.retryable) throw lastErr;
      }
      throw lastErr ?? new ProviderError("openai_unknown", 502, "");
    },
  };
}

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

export interface MockProviderOptions {
  /** Simulated latency per call (ms). */
  delayMs?: number;
  /** Optional per-case overrides keyed by `meta.caseId` (and `${caseId}:pass2` for the second pass). */
  scenario?: Record<string, Partial<ModelEvaluation>>;
  /** Fail every call whose caseId matches (for retry / dead-letter tests). */
  failCaseIds?: string[];
  sleep?: (ms: number) => Promise<void>;
}

function keyPointCoverage(studentText: string, keyPoints: string[]): { ratio: number; missing: string[] } {
  const words = new Set(tokenize(studentText).map((t) => t.norm).filter((w) => w.length >= 3));
  if (keyPoints.length === 0) {
    const n = words.size;
    return { ratio: Math.min(1, n / 40), missing: [] };
  }
  let covered = 0;
  const missing: string[] = [];
  for (const point of keyPoints) {
    const toks = tokenize(point).map((t) => t.norm).filter((w) => w.length >= 3);
    if (toks.length === 0) continue;
    const hits = toks.filter((t) => words.has(t)).length;
    if (hits / toks.length >= 0.5) covered += 1;
    else missing.push(point);
  }
  return { ratio: keyPoints.length ? covered / keyPoints.length : 0, missing };
}

export function mockEvaluate(material: QuestionMaterial): ModelEvaluation {
  const text = material.studentTurns.map((t) => t.content).join(" ");
  const wordCount = tokenize(text).length;
  const { ratio, missing } = keyPointCoverage(text, material.question.keyPoints);
  const base = Math.round(ratio * 5);
  const applicable = new Set(applicableCriteria(material.question.kind));
  const scores: Record<Criterion, number> = {
    relevance: wordCount > 5 ? Math.max(1, base) : 0,
    accuracy: base,
    explanation: Math.min(5, Math.round(wordCount / 25), base + 1),
    consistency: wordCount > 5 ? 4 : 0,
    process: base,
    application: Math.max(0, base - 1),
  };
  for (const c of Object.keys(scores) as Criterion[]) if (!applicable.has(c)) scores[c] = 0;
  const status: ModelEvaluation["answer_status"] =
    wordCount < 5 ? "missing" : ratio >= 0.8 ? "correct" : ratio >= 0.4 ? "partially_correct" : "vague";
  const first = material.studentTurns[0]?.content ?? "";
  const quote = first.split(/(?<=[.!?。])\s+/)[0]?.split(/\s+/).slice(0, 12).join(" ") ?? "";
  return {
    answer_status: status,
    scores,
    correct_facts: ratio > 0 ? material.question.keyPoints.filter((p) => !missing.includes(p)) : [],
    errors: [],
    missing_points: missing,
    evidence: quote && wordCount >= 5 ? [{ quote, criterion: "accuracy" }] : [],
    rationale: `mock: ${Math.round(ratio * 100)}% of key points covered in ${wordCount} words.`,
    confidence: wordCount < 8 ? "low" : "high",
    uncertainty_reasons: wordCount < 8 ? ["very short answer"] : [],
  };
}

export function createMockProvider(opts: MockProviderOptions = {}): GradingProvider {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    name: "mock",
    async call<T>(req: ProviderRequest): Promise<ProviderResponse<T>> {
      const started = Date.now();
      if (opts.delayMs) await sleep(opts.delayMs);
      const caseId = req.meta?.caseId;
      if (caseId && opts.failCaseIds?.includes(caseId)) {
        throw new ProviderError("mock_failure", 503, "simulated outage", 1000);
      }
      let parsed: unknown;
      if (req.operation === "narrative") {
        const n: Narrative = {
          summary: "mock summary",
          strengths: ["mock strength"],
          weaknesses: ["mock weakness"],
          recommendations: ["mock recommendation", "mock recommendation 2"],
        };
        parsed = n;
      } else {
        const material = req.meta?.material;
        if (!material) throw new ProviderError("mock_missing_material", 400, "meta.material is required");
        const base = mockEvaluate(material);
        const key = req.meta?.pass === 2 ? `${caseId}:pass2` : caseId;
        const override = key ? opts.scenario?.[key] : undefined;
        parsed = override ? { ...base, ...override, scores: { ...base.scores, ...(override.scores ?? {}) } } : base;
      }
      const inputChars = req.input.reduce((s, m) => s + m.content.reduce((x, c) => x + c.text.length, 0), 0);
      return {
        parsed: parsed as T,
        usage: { inputTokens: Math.round(inputChars / 3), outputTokens: 350, totalTokens: Math.round(inputChars / 3) + 350 },
        responseId: null,
        model: "mock",
        latencyMs: Date.now() - started,
        rateLimit: null,
        attempts: 1,
      };
    },
  };
}
