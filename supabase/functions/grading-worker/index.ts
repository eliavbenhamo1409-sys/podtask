// Edge Function: grading-worker
//
// Pulls grading jobs from `grading_jobs` (atomic claim with a lease) and runs
// the grading engine (`_shared/grading/pipeline.ts`) for each one. Invoked:
//   - by `complete-interview` right after an interview is completed (kick,
//     `{ interviewId }`), so the student does not wait for the next tick;
//   - by pg_cron every 10 s through pg_net (`{ mode: "tick", limit }`), which
//     is the delivery guarantee: anything the kick missed, a crashed worker
//     left behind (expired lease) or a failed attempt (backoff) is retried.
//
// Service role only: the gateway verifies the JWT signature, this function
// verifies the role claim. Every write is idempotent (unique job per
// interview, run snapshots, report upsert), so a redelivered job never
// produces a second report or a different score for the same input.
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { OPENAI_KEY_NAME } from "../_shared/openai.ts";
import { CapacityError, gradeInterview, type PipelineOptions } from "../_shared/grading/pipeline.ts";
import { createMockProvider, createOpenAIProvider, ProviderError } from "../_shared/grading/provider.ts";
import { createSupabaseGate, createSupabaseStore } from "../_shared/grading/store-supabase.ts";
import type { GradingModels, GradingParams } from "../_shared/grading/types.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

const DEFAULT_LIMIT = 2;
const HEARTBEAT_MS = 45_000;

interface JobRow {
  id: string;
  interview_id: string;
  submission_id: string;
  attempts: number;
  max_attempts: number;
  options: Record<string, unknown> | null;
  lease_until: string;
}

interface GradingConfigRow {
  queue_enabled: boolean;
  worker_batch: number;
  lease_seconds: number;
  engine: { models?: Partial<GradingModels>; params?: Partial<GradingParams>; provider?: string } | null;
}

/** True when the bearer token is the project's service-role JWT. */
function isServiceRole(req: Request): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && token === serviceKey) return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);
  if (!isServiceRole(req)) return errorResponse("forbidden", 403);

  const body = (await req.json().catch(() => ({}))) as { interviewId?: unknown; limit?: unknown; mode?: unknown };
  const interviewId = typeof body.interviewId === "string" && /^[0-9a-f-]{36}$/i.test(body.interviewId) ? body.interviewId : null;

  const sb = serviceClient();
  const workerId = `edge:${crypto.randomUUID().slice(0, 8)}`;
  const { data: configRow } = await sb
    .from("grading_config")
    .select("queue_enabled, worker_batch, lease_seconds, engine")
    .eq("id", 1)
    .maybeSingle();
  const config = (configRow ?? { queue_enabled: true, worker_batch: DEFAULT_LIMIT, lease_seconds: 180, engine: {} }) as GradingConfigRow;
  if (!config.queue_enabled) return jsonResponse({ ok: true, worker: workerId, processed: [], disabled: true });

  const limit = interviewId ? 1 : Math.max(1, Math.min(10, Number(body.limit) || config.worker_batch || DEFAULT_LIMIT));
  const { data: jobs, error: claimError } = await sb.rpc("claim_grading_jobs", {
    p_worker: workerId,
    p_limit: limit,
    p_interview_id: interviewId,
    p_lease_seconds: config.lease_seconds,
  });
  if (claimError) return errorResponse(`claim_failed:${claimError.message}`, 500);
  const claimed = (jobs ?? []) as JobRow[];
  if (claimed.length === 0) return jsonResponse({ ok: true, worker: workerId, processed: [] });

  const store = createSupabaseStore(sb);
  const gate = createSupabaseGate(sb, (event, data) => console.warn(event, data));
  const engine = config.engine ?? {};

  const results = await Promise.all(claimed.map((job) => processJob(sb, store, gate, workerId, job, engine, config.lease_seconds)));
  return jsonResponse({ ok: true, worker: workerId, processed: results });
});

type Sb = ReturnType<typeof serviceClient>;

async function processJob(
  sb: Sb,
  store: ReturnType<typeof createSupabaseStore>,
  gate: ReturnType<typeof createSupabaseGate>,
  workerId: string,
  job: JobRow,
  engine: NonNullable<GradingConfigRow["engine"]>,
  leaseSeconds: number,
): Promise<Record<string, unknown>> {
  const options = (job.options ?? {}) as { provider?: string; force?: boolean; mock_delay_ms?: number };
  const providerName = options.provider === "mock" ? "mock" : engine.provider === "mock" ? "mock" : "openai";
  const started = Date.now();
  const heartbeat = setInterval(() => {
    Promise.resolve(sb.rpc("extend_grading_lease", { p_job_id: job.id, p_worker: workerId, p_seconds: leaseSeconds })).catch(() => {});
  }, HEARTBEAT_MS);

  const log = (event: string, data?: Record<string, unknown>) => {
    console.log(JSON.stringify({ event, job: job.id, interview: job.interview_id, ...(data ?? {}) }));
    if (event === "run.created" || event === "run.resumed") {
      Promise.resolve(sb.rpc("set_grading_stage", { p_job_id: job.id, p_worker: workerId, p_stage: "evaluating" })).catch(() => {});
    } else if (event === "question.verified") {
      Promise.resolve(sb.rpc("set_grading_stage", { p_job_id: job.id, p_worker: workerId, p_stage: "verifying" })).catch(() => {});
    }
  };

  try {
    let provider: PipelineOptions["provider"];
    if (providerName === "mock") {
      provider = createMockProvider({ delayMs: Math.max(0, Math.min(30_000, Number(options.mock_delay_ms) || 0)) });
    } else {
      const apiKey = Deno.env.get(OPENAI_KEY_NAME);
      if (!apiKey) throw new Error(`missing_secret_${OPENAI_KEY_NAME}`);
      provider = createOpenAIProvider({ apiKey });
    }
    const result = await gradeInterview(store, job.interview_id, {
      provider,
      gate,
      jobId: job.id,
      force: options.force === true,
      models: engine.models,
      params: engine.params,
      log,
    });
    clearInterval(heartbeat);
    return {
      job: job.id,
      interview: job.interview_id,
      ok: true,
      runId: result.runId,
      reused: result.reused,
      overall: result.final.overallScore,
      requiresHumanReview: result.final.requiresHumanReview,
      ms: Date.now() - started,
    };
  } catch (err) {
    clearInterval(heartbeat);
    const message = err instanceof Error ? err.message : String(err);
    let retryAfter: number | null = null;
    let dead = false;
    if (err instanceof CapacityError) {
      retryAfter = Math.max(5, err.retryAfterSeconds);
    } else if (err instanceof ProviderError) {
      if (err.status === 429) retryAfter = Math.max(10, Math.ceil((err.retryAfterMs ?? 20_000) / 1000));
      else if (!err.retryable) dead = true;
    } else if (/^(interview_not_found|plan_missing|missing_secret_)/.test(message)) {
      dead = true;
    }
    const { data: status } = await sb.rpc("fail_grading_job", {
      p_job_id: job.id,
      p_worker: workerId,
      p_error: message,
      p_retry_after_seconds: retryAfter,
      p_dead: dead,
    });
    await sb.from("system_events").insert({
      actor_id: null,
      entity_type: "interview",
      entity_id: job.interview_id,
      event_type: status === "dead" ? "grading.dead" : "grading.attempt_failed",
      payload: { severity: status === "dead" ? "error" : "warn", reason: message.slice(0, 400), attempts: job.attempts, retry_after: retryAfter },
    });
    return { job: job.id, interview: job.interview_id, ok: false, error: message, status, ms: Date.now() - started };
  }
}
