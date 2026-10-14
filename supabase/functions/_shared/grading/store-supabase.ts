/**
 * Supabase implementation of the pipeline's `GradingStore` and
 * `ConcurrencyGate`, on top of the RPCs in
 * `migrations/20260515000001_grading_engine.sql`. Takes the service-role
 * client as a structural parameter so the module itself never imports the
 * esm.sh client (keeps `pipeline.ts` runnable under Node for tests).
 */
import type { ConcurrencyGate, GradingStore, NewRun, PersistArgs, Pool, StoredRun } from "./pipeline.ts";
import { normalizePlan } from "./transcript.ts";
import type { FinalScore, InterviewBundle, Language, Narrative, QuestionEvaluation, TranscriptRow } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Sb = any;

function toLanguage(value: unknown): Language | null {
  return value === "he" || value === "en" || value === "ar" ? value : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function toStoredRun(row: Record<string, unknown>): StoredRun {
  return {
    id: row.id as string,
    runNo: row.run_no as number,
    status: row.status as string,
    inputHash: row.input_hash as string,
    evaluations: Array.isArray(row.evaluations) ? (row.evaluations as QuestionEvaluation[]) : [],
    result: (row.result as FinalScore | null) ?? null,
    narrative: (row.narrative as Narrative | null) ?? null,
  };
}

export function createSupabaseStore(sb: Sb): GradingStore {
  return {
    async loadBundle(interviewId: string): Promise<InterviewBundle | null> {
      const { data: interview } = await sb
        .from("interviews")
        .select("id, submission_id, assignment_id, student_id, language, status, metadata")
        .eq("id", interviewId)
        .maybeSingle();
      if (!interview) return null;

      const [
        { data: assignment },
        { data: analysis },
        { data: planRow },
        { data: messages },
        { data: chunks },
        { data: integrityEvents },
        { count: mintFailures },
      ] = await Promise.all([
        sb.from("assignments").select("title, language").eq("id", interview.assignment_id).maybeSingle(),
        sb
          .from("document_analyses")
          .select("summary, main_argument, key_concepts, claims")
          .eq("submission_id", interview.submission_id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb.from("interview_plans").select("plan").eq("interview_id", interviewId).maybeSingle(),
        sb
          .from("interview_messages")
          .select("id, speaker, message_type, content, plan_question_id, created_at, metadata")
          .eq("interview_id", interviewId)
          .order("created_at", { ascending: true }),
        sb
          .from("document_chunks")
          .select("chunk_index, content")
          .eq("submission_id", interview.submission_id)
          .order("chunk_index", { ascending: true }),
        sb
          .from("interview_integrity_events")
          .select("kind")
          .eq("interview_id", interviewId)
          .in("kind", ["disconnect", "offline", "session_resumed"]),
        sb
          .from("system_events")
          .select("id", { count: "exact", head: true })
          .eq("entity_type", "interview")
          .eq("entity_id", interviewId)
          .eq("event_type", "realtime.client_secret.failed"),
      ]);

      const attempts = Number((interview.metadata as { attempts?: unknown } | null)?.attempts ?? 1);
      const events = (integrityEvents ?? []) as Array<{ kind: string }>;
      const disconnects = events.filter((e) => e.kind === "disconnect" || e.kind === "offline").length;
      const resumes = Math.max(events.filter((e) => e.kind === "session_resumed").length, Number.isFinite(attempts) ? attempts - 1 : 0);
      const failures = mintFailures ?? 0;

      return {
        interviewId,
        submissionId: interview.submission_id,
        assignmentId: interview.assignment_id,
        studentId: interview.student_id,
        language: toLanguage(interview.language) ?? toLanguage(assignment?.language) ?? "he",
        assignmentTitle: assignment?.title ?? "",
        analysis: {
          summary: analysis?.summary ?? null,
          mainArgument: analysis?.main_argument ?? null,
          keyConcepts: asStringList(analysis?.key_concepts),
          claims: asStringList(analysis?.claims),
        },
        plan: normalizePlan(planRow?.plan ?? null),
        messages: ((messages ?? []) as TranscriptRow[]).map((m) => ({ ...m, metadata: (m.metadata ?? null) as Record<string, unknown> | null })),
        chunks: ((chunks ?? []) as Array<{ chunk_index: number; content: string }>).map((c) => ({ index: c.chunk_index, content: c.content })),
        technical: {
          disconnects,
          resumes,
          mintFailures: failures,
          technicalIssue: disconnects + resumes + failures > 0,
        },
      };
    },

    async findReusableRun(interviewId, inputHash) {
      const { data } = await sb
        .from("grading_runs")
        .select("id, run_no, status, input_hash, evaluations, result, narrative")
        .eq("interview_id", interviewId)
        .eq("input_hash", inputHash)
        .eq("status", "succeeded")
        .order("run_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? toStoredRun(data) : null;
    },

    async findResumableRun(interviewId, inputHash) {
      const { data } = await sb
        .from("grading_runs")
        .select("id, run_no, status, input_hash, evaluations, result, narrative")
        .eq("interview_id", interviewId)
        .eq("input_hash", inputHash)
        .eq("status", "running")
        .order("run_no", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? toStoredRun(data) : null;
    },

    async createRun(run: NewRun) {
      const { data, error } = await sb.rpc("create_grading_run", {
        p_interview_id: run.interviewId,
        p_submission_id: run.submissionId,
        p_job_id: run.jobId,
        p_input_hash: run.inputHash,
        p_versions: run.versions,
        p_models: run.models,
        p_params: run.params,
        p_provider: run.provider,
      });
      if (error || !data) throw new Error(`create_grading_run_failed: ${error?.message ?? "no row"}`);
      return { id: data.id as string, runNo: data.run_no as number };
    },

    async checkpoint(runId, evaluations) {
      await sb.rpc("checkpoint_grading_run", { p_run_id: runId, p_evaluations: evaluations });
    },

    async persistResult(args: PersistArgs) {
      const { data, error } = await sb.rpc("persist_grading_result", {
        p_run_id: args.runId,
        p_job_id: args.jobId,
        p_worker: null,
        p_run: {
          result: args.final,
          narrative: args.narrative,
          evaluations: args.evaluations,
          usage: args.usage,
          timings: args.timings,
          reused_from_run_id: args.reusedFromRunId,
          input_hash: args.inputHash,
          narrative_source: args.narrativeSource,
        },
        p_evaluations: args.answerEvaluationRows,
        p_report: args.reportRow,
      });
      if (error) throw new Error(`persist_grading_result_failed: ${error.message}`);
      if (data && data.ok === false) throw new Error(`persist_refused:${data.reason ?? "unknown"}`);

      // Usage log per stage (best effort, never blocks the result).
      const rows = Object.entries(args.usage)
        .filter(([, u]) => u.calls > 0)
        .map(([stage, u]) => ({
          user_id: null,
          entity_type: "interview",
          entity_id: args.interviewId,
          provider: "openai",
          model: stage,
          operation: stage === "narrative" ? "generate_report" : "evaluate_answer",
          input_tokens: u.inputTokens,
          output_tokens: u.outputTokens,
          estimated_cost_usd: Math.round(u.estimatedCostUsd * 10000) / 10000,
          metadata: { grading_run_id: args.runId, stage, calls: u.calls, latency_ms: u.latencyMs },
        }));
      if (rows.length) await sb.from("ai_usage_logs").insert(rows);
    },

    async failRun(runId, error) {
      await sb.rpc("fail_grading_run", { p_run_id: runId, p_error: error });
    },
  };
}

/** Postgres-backed gate: `acquire_ai_slot` / `release_ai_slot`. Fails open on RPC errors (logged). */
export function createSupabaseGate(sb: Sb, log?: (event: string, data?: Record<string, unknown>) => void): ConcurrencyGate {
  return {
    async acquire(pool: Pool, holder: string, ttlSeconds: number) {
      const { data, error } = await sb.rpc("acquire_ai_slot", { p_pool: pool, p_holder: holder, p_ttl_seconds: ttlSeconds });
      if (error) {
        log?.("gate.error", { pool, error: error.message });
        return { ok: true };
      }
      if (data && data.ok === false) {
        return { ok: false, retryAfterSeconds: Number(data.retry_after_seconds ?? 5) };
      }
      return { ok: true };
    },
    async release(pool: Pool, holder: string) {
      await sb.rpc("release_ai_slot", { p_pool: pool, p_holder: holder });
    },
  };
}
