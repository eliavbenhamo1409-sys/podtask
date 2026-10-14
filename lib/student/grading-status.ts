"use client";

import { MOCK_MODE } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";
import { isUuidLike } from "@/lib/utils";

/**
 * Status of the grading job behind a finished interview, from the
 * `grading_status(interview_id)` RPC (owner or lecturer). Lets the report
 * page tell "still queued / running / retrying" apart from "gave up".
 */
export type GradingJobStatus = "queued" | "running" | "done" | "failed" | "dead";

export interface GradingStatus {
  job: {
    status: GradingJobStatus;
    stage: string;
    attempts: number;
    maxAttempts: number;
    runAfter: string | null;
    errorCode: string | null;
    updatedAt: string | null;
  } | null;
  report: { status: string; gradingRunId: string | null } | null;
}

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

function toJobStatus(value: unknown): GradingJobStatus {
  return value === "running" || value === "done" || value === "failed" || value === "dead" ? value : "queued";
}

export async function getGradingStatus(interviewId: string): Promise<GradingStatus | null> {
  if (MOCK_MODE || !isUuidLike(interviewId)) return null;
  const sb = createClient() as unknown as RpcClient;
  const { data, error } = await sb.rpc("grading_status", { p_interview_id: interviewId });
  if (error || !data || typeof data !== "object") return null;
  const raw = data as { job?: Record<string, unknown> | null; report?: Record<string, unknown> | null };
  const job = raw.job ?? null;
  const report = raw.report ?? null;
  return {
    job: job
      ? {
          status: toJobStatus(job.status),
          stage: String(job.stage ?? ""),
          attempts: Number(job.attempts ?? 0),
          maxAttempts: Number(job.max_attempts ?? 0),
          runAfter: typeof job.run_after === "string" ? job.run_after : null,
          errorCode: typeof job.error_code === "string" ? job.error_code : null,
          updatedAt: typeof job.updated_at === "string" ? job.updated_at : null,
        }
      : null,
    report: report
      ? {
          status: String(report.status ?? ""),
          gradingRunId: typeof report.grading_run_id === "string" ? report.grading_run_id : null,
        }
      : null,
  };
}
