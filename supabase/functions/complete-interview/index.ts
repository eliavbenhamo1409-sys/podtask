// Edge Function: complete-interview
//
// Closes an interview: marks it completed (idempotent: a second call never
// regresses the submission or rewrites the timestamps), runs the server-side
// integrity analysis (`_shared/integrity.ts`), then triggers the scoring
// report and the per-question evaluation server-to-server, forwarding the
// student's Authorization header so both validate ownership as usual.
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import {
  analyzeOverlap,
  analyzeSession,
  analyzeTiming,
  type FlagInsert,
  type MessageRow,
} from "../_shared/integrity.ts";
import {
  isPersonalCourseCode,
  resolveIntegritySettings,
} from "../_shared/integrity-settings.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  const { interviewId, durationSeconds } = body ?? {};
  if (typeof interviewId !== "string") return errorResponse("invalid_interview_id");

  const sb = serviceClient();
  const { data: interview } = await sb
    .from("interviews")
    .select("id, submission_id, assignment_id, student_id, status, started_at, completed_at, metadata")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  if (interview.status === "completed") {
    return jsonResponse({ ok: true, reportTriggered: false, alreadyCompleted: true });
  }
  if (interview.status !== "in_progress") {
    return jsonResponse({ ok: false, error: "interview_not_running" }, 409);
  }

  const completedAt = new Date().toISOString();
  const duration =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
      ? Math.max(0, Math.min(6 * 3600, Math.round(durationSeconds)))
      : interview.started_at
        ? Math.round((Date.now() - new Date(interview.started_at).getTime()) / 1000)
        : null;

  const { error: updateError } = await sb
    .from("interviews")
    .update({
      status: "completed",
      current_state: "completed",
      completed_at: completedAt,
      duration_seconds: duration,
    })
    .eq("id", interviewId)
    .eq("status", "in_progress");
  if (updateError) return errorResponse("interview_update_failed", 500);

  await sb
    .from("submissions")
    .update({ status: "interview_completed" })
    .eq("id", interview.submission_id)
    .neq("status", "report_ready");

  await sb.from("system_events").insert({
    actor_id: auth.userId,
    entity_type: "interview",
    entity_id: interviewId,
    event_type: "interview.completed",
    payload: { duration_seconds: duration },
  });

  // ---- Integrity analysis (server-side facts; never blocks completion) ----
  let settings = resolveIntegritySettings(null, { personal: true });
  try {
    const { data: assignment } = await sb
      .from("assignments")
      .select("settings, course:courses ( code )")
      .eq("id", interview.assignment_id)
      .maybeSingle();
    const courseRaw = (assignment as { course?: { code: string } | { code: string }[] | null } | null)?.course;
    const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
    settings = resolveIntegritySettings(assignment?.settings, {
      personal: isPersonalCourseCode(course?.code),
    });
    await runIntegrityAnalysis(sb, {
      interviewId,
      studentId: interview.student_id,
      submissionId: interview.submission_id,
      startedAt: interview.started_at,
      completedAt,
      overlapCheck: settings.overlapCheck,
      metadata: (interview.metadata ?? {}) as Record<string, unknown>,
    });
  } catch (err) {
    await sb.from("system_events").insert({
      actor_id: auth.userId,
      entity_type: "interview",
      entity_id: interviewId,
      event_type: "integrity.analysis_failed",
      payload: { severity: "warn", reason: err instanceof Error ? err.message : "unknown" },
    });
  }

  // ---- Scoring + per-question evaluation, in parallel -----------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const [reportTriggered, evaluationTriggered] = await Promise.all([
    invokeSibling(sb, "generate-report", interviewId, authHeader, auth.userId),
    settings.perAnswerEvaluation
      ? invokeSibling(sb, "evaluate-answer", interviewId, authHeader, auth.userId)
      : Promise.resolve(false),
  ]);

  return jsonResponse({ ok: true, reportTriggered, evaluationTriggered });
});

type Sb = ReturnType<typeof serviceClient>;

async function runIntegrityAnalysis(
  sb: Sb,
  args: {
    interviewId: string;
    studentId: string;
    submissionId: string;
    startedAt: string | null;
    completedAt: string;
    overlapCheck: boolean;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const [{ count: mintCount }, { data: messages }, { data: parse }] = await Promise.all([
    sb
      .from("system_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "interview")
      .eq("entity_id", args.interviewId)
      .eq("event_type", "realtime.client_secret.created"),
    sb
      .from("interview_messages")
      .select("id, speaker, message_type, content, plan_question_id, created_at, started_at, ended_at, metadata")
      .eq("interview_id", args.interviewId)
      .order("created_at", { ascending: true }),
    sb
      .from("document_parses")
      .select("markdown, metadata")
      .eq("submission_id", args.submissionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const rows = (messages ?? []) as MessageRow[];
  const flags: FlagInsert[] = [
    ...analyzeSession({
      interviewId: args.interviewId,
      studentId: args.studentId,
      mintCount: mintCount ?? 0,
      startedAt: args.startedAt,
      completedAt: args.completedAt,
      messages: rows,
    }),
  ];
  const timing = analyzeTiming(args.interviewId, args.studentId, rows);
  flags.push(...timing.flags);

  if (args.overlapCheck && parse?.markdown) {
    const source =
      (parse.metadata as { source?: string } | null)?.source === "raw_text"
        ? "raw_text"
        : "llm_markdown";
    flags.push(
      ...analyzeOverlap(args.interviewId, args.studentId, parse.markdown, rows, source),
    );
  }

  // Replace earlier server-side flags (a re-run never duplicates them).
  await sb
    .from("interview_flags")
    .delete()
    .eq("interview_id", args.interviewId)
    .in("source", ["server_overlap", "server_timing", "server_session"]);
  if (flags.length) {
    await sb.from("interview_flags").insert(flags);
  }

  await sb
    .from("interviews")
    .update({
      metadata: {
        ...args.metadata,
        integrity_summary: {
          sessions_minted: mintCount ?? 0,
          answers: timing.summary.answers,
          answers_with_timing: timing.summary.withTiming,
          median_latency_ms: timing.summary.medianLatencyMs,
          max_latency_ms: timing.summary.maxLatencyMs,
          barge_ins: timing.summary.bargeIns,
          server_flags: flags.length,
          analyzed_at: args.completedAt,
        },
      },
    })
    .eq("id", args.interviewId);
}

async function invokeSibling(
  sb: Sb,
  name: string,
  interviewId: string,
  authHeader: string,
  userId: string,
): Promise<boolean> {
  const url = buildFunctionUrl(name);
  if (!url) return false;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ interviewId }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      await sb.from("system_events").insert({
        actor_id: userId,
        entity_type: "interview",
        entity_id: interviewId,
        event_type: `${name}.invoke_failed`,
        payload: { severity: "warn", status: r.status, body: text.slice(0, 400) },
      });
    }
    return r.ok;
  } catch (err) {
    await sb.from("system_events").insert({
      actor_id: userId,
      entity_type: "interview",
      entity_id: interviewId,
      event_type: `${name}.invoke_failed`,
      payload: { severity: "warn", reason: err instanceof Error ? err.message : "unknown" },
    });
    return false;
  }
}

/**
 * Builds the absolute URL to a sibling Edge Function. Edge Functions run
 * inside Supabase and `SUPABASE_URL` always resolves to the project root,
 * so `<SUPABASE_URL>/functions/v1/<name>` is the canonical address.
 */
function buildFunctionUrl(name: string): string | null {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/functions/v1/${name}`;
}
