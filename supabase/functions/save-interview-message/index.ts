// Edge Function: save-interview-message
//
// The only write path for `interview_messages` (the student's direct RLS
// insert was removed in 20260514000002_integrity_lockdown.sql). Checks:
//   - the caller owns the interview,
//   - the interview is running (or finished less than 90 s ago: the final
//     farewell lines race the completion call),
//   - the row is idempotent: `clientId` becomes metadata.client_id and a
//     unique index makes the second delivery of the same turn a no-op.
// Timing metadata reported by the room is stored as-is under metadata with
// source = "client"; the lecturer report treats it as client telemetry.
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

const SPEAKERS = new Set(["ai_host", "student", "system"]);
const TYPES = new Set(["question", "answer", "followup", "system", "summary"]);
const MAX_CONTENT_CHARS = 8000;
const MAX_METADATA_CHARS = 3000;
const COMPLETION_GRACE_MS = 90_000;

const METADATA_NUMBER_KEYS = new Set([
  "question_index",
  "latency_ms",
  "speech_ms",
  "host_turn_ms",
  "pause_before_ms",
  "interruptions",
  "mute_toggles",
  "barge_in_count",
  "hidden_ms_since_last",
  "blur_count_since_last",
]);
const METADATA_BOOL_KEYS = new Set(["barge_in", "muted_during_turn", "nudged"]);
const METADATA_STRING_KEYS = new Set([
  "kind",
  "host_turn_ended_at",
  "speech_started_at",
  "speech_stopped_at",
  "playback_started_at",
  "playback_stopped_at",
  "stop_reason",
  "response_id",
]);

function parseIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t) || t > Date.now() + 5 * 60_000) return null;
  return new Date(t).toISOString();
}

function sanitizeMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (JSON.stringify(raw).length > MAX_METADATA_CHARS) return { truncated: true };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (METADATA_NUMBER_KEYS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      out[key] = Math.round(value);
    } else if (METADATA_BOOL_KEYS.has(key) && typeof value === "boolean") {
      out[key] = value;
    } else if (METADATA_STRING_KEYS.has(key) && typeof value === "string") {
      out[key] = value.slice(0, 80);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  if (!body) return errorResponse("invalid_json", 400);

  const {
    interviewId,
    speaker,
    messageType,
    content,
    audioPath,
    planQuestionId,
    clientId,
    startedAt,
    endedAt,
    metadata,
  } = body;
  if (typeof interviewId !== "string") return errorResponse("invalid_interview_id");
  if (!SPEAKERS.has(speaker)) return errorResponse("invalid_speaker");
  if (!TYPES.has(messageType)) return errorResponse("invalid_message_type");
  if (content !== undefined && typeof content !== "string") return errorResponse("invalid_content");
  if (typeof content === "string" && content.length > MAX_CONTENT_CHARS) {
    return errorResponse("content_too_long");
  }
  if (
    planQuestionId !== undefined &&
    planQuestionId !== null &&
    typeof planQuestionId !== "string"
  ) {
    return errorResponse("invalid_plan_question_id");
  }
  if (clientId !== undefined && (typeof clientId !== "string" || clientId.length > 80)) {
    return errorResponse("invalid_client_id");
  }

  const sb = serviceClient();
  const { data: interview } = await sb
    .from("interviews")
    .select("student_id, status, completed_at")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const running = interview.status === "in_progress";
  const recentlyCompleted =
    interview.status === "completed" &&
    !!interview.completed_at &&
    Date.now() - new Date(interview.completed_at).getTime() < COMPLETION_GRACE_MS;
  if (!running && !recentlyCompleted) {
    return jsonResponse({ ok: false, error: "interview_not_running" }, 409);
  }

  const meta = sanitizeMetadata(metadata);
  meta.source = "client";
  if (typeof clientId === "string" && clientId) meta.client_id = clientId;

  const row = {
    interview_id: interviewId,
    speaker,
    message_type: messageType,
    content: content ?? null,
    audio_path: typeof audioPath === "string" ? audioPath : null,
    plan_question_id:
      typeof planQuestionId === "string" && planQuestionId.length ? planQuestionId : null,
    started_at: parseIso(startedAt) ?? new Date().toISOString(),
    ended_at: parseIso(endedAt),
    metadata: meta,
  };

  const { data, error } = await sb
    .from("interview_messages")
    .insert(row)
    .select("id")
    .single();
  if (error) {
    // Same turn delivered twice (both Realtime final events): keep the first.
    if (error.code === "23505" && typeof clientId === "string") {
      const { data: existing } = await sb
        .from("interview_messages")
        .select("id")
        .eq("interview_id", interviewId)
        .eq("metadata->>client_id", clientId)
        .maybeSingle();
      return jsonResponse({ ok: true, messageId: existing?.id ?? null, duplicate: true });
    }
    return errorResponse("insert_failed", 500);
  }
  if (!data) return errorResponse("insert_failed", 500);

  return jsonResponse({ ok: true, messageId: data.id });
});
