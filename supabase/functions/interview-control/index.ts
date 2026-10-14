// Edge Function: interview-control
//
// Every student-side state change of an interview goes through here with the
// service role, after an ownership + status check. The browser never writes
// `interviews`, `interview_consents`, `interview_integrity_events` or
// `interview_flags` directly (no RLS write policies exist for them).
//
//   action: "consent"  record the student's acknowledgement of the integrity notice
//   action: "start"    ready -> in_progress (or resume an in_progress interview);
//                      returns the question outline (ids + topics, no text),
//                      the resolved integrity settings and resume information
//   action: "events"   batch of client telemetry (tab / focus / camera / nudges)
//   action: "flag"     a review item raised by the host's `flag_answer` tool
//   action: "disconnect" the room is closing unexpectedly (pagehide / failure)
//
// Trust model: everything the browser reports is CLIENT telemetry. It is
// stored with source = "client" and the lecturer report says so. Server-side
// facts (resumes, session counts, timing derived from stored rows) are
// written with source = "server".
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import {
  isPersonalCourseCode,
  resolveIntegritySettings,
  type IntegritySettings,
} from "../_shared/integrity-settings.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const MAX_EVENTS_PER_BATCH = 50;
const MAX_PAYLOAD_CHARS = 2000;
const MAX_EVENT_DURATION_MS = 60 * 60 * 1000;

const EVENT_KINDS = new Set([
  "visibility_hidden",
  "window_blur",
  "fullscreen_exit",
  "fullscreen_enter",
  "page_hidden",
  "offline",
  "camera_started",
  "camera_denied",
  "camera_unavailable",
  "camera_off",
  "camera_reconnected",
  "face_missing",
  "multiple_faces",
  "silence_nudge",
  "own_words_prompt",
  "mic_muted",
  "disconnect",
  "reconnect",
]);

const FLAG_CATEGORIES = new Set([
  "contradiction",
  "generic_answer",
  "cannot_explain_term",
  "verbatim_document",
  "cannot_explain_decision",
  "technical_context",
  "other",
]);

const FLAG_CONFIDENCE = new Set(["low", "medium", "high"]);

interface InterviewRow {
  id: string;
  student_id: string;
  submission_id: string;
  assignment_id: string;
  status: string;
  language: string | null;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface AssignmentRow {
  id: string;
  status: string;
  settings: unknown;
  course: { code: string } | { code: string }[] | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return errorResponse("invalid_json", 400);
  const action = typeof body.action === "string" ? body.action : "";
  const interviewId = body.interviewId;
  if (typeof interviewId !== "string" || !UUID_RE.test(interviewId)) {
    return errorResponse("invalid_interview_id", 400);
  }

  const sb = serviceClient();
  const { data: interviewRaw, error: interviewError } = await sb
    .from("interviews")
    .select("id, student_id, submission_id, assignment_id, status, language, started_at, completed_at, metadata")
    .eq("id", interviewId)
    .maybeSingle();
  if (interviewError) return errorResponse("interview_lookup_failed", 500);
  if (!interviewRaw) return errorResponse("interview_not_found", 404);
  const interview = interviewRaw as InterviewRow;
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const { data: assignmentRaw } = await sb
    .from("assignments")
    .select("id, status, settings, course:courses ( code )")
    .eq("id", interview.assignment_id)
    .maybeSingle();
  const assignment = (assignmentRaw ?? null) as AssignmentRow | null;
  const courseRaw = assignment?.course;
  const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
  const personal = isPersonalCourseCode(course?.code);
  const settings = resolveIntegritySettings(assignment?.settings, { personal });

  switch (action) {
    case "consent":
      return handleConsent(sb, req, interview, settings, body, auth.userId);
    case "start":
      return handleStart(sb, interview, assignment, settings, auth.userId);
    case "events":
      return handleEvents(sb, interview, body);
    case "flag":
      return handleFlag(sb, interview, settings, body);
    case "disconnect":
      return handleDisconnect(sb, interview, body);
    default:
      return errorResponse("invalid_action", 400);
  }
});

type Sb = ReturnType<typeof serviceClient>;

function isRunning(status: string): boolean {
  return status === "in_progress";
}

/** Rows may still arrive for ~90 s after completion (final flush). */
function isRecentlyCompleted(interview: InterviewRow): boolean {
  if (interview.status !== "completed" || !interview.completed_at) return false;
  return Date.now() - new Date(interview.completed_at).getTime() < 90_000;
}

async function handleConsent(
  sb: Sb,
  req: Request,
  interview: InterviewRow,
  settings: IntegritySettings,
  body: Record<string, unknown>,
  userId: string,
) {
  if (interview.status === "completed" || interview.status === "cancelled") {
    return errorResponse("interview_completed", 409);
  }
  const version =
    typeof body.version === "string" && body.version.length <= 40
      ? body.version
      : settings.consentVersion;
  const locale = body.locale === "en" ? "en" : "he";
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;

  const { error } = await sb.from("interview_consents").insert({
    interview_id: interview.id,
    student_id: userId,
    version,
    locale,
    user_agent: userAgent,
  });
  // A second acknowledgement of the same version is fine (unique index).
  if (error && error.code !== "23505") return errorResponse("consent_insert_failed", 500);

  await sb.from("system_events").insert({
    actor_id: userId,
    entity_type: "interview",
    entity_id: interview.id,
    event_type: "consent.accepted",
    payload: { version, locale },
  });
  return jsonResponse({ ok: true, version });
}

interface PlanQuestion {
  id?: string;
  topic?: string;
  kind?: string;
  recommended_seconds?: number;
}

async function handleStart(
  sb: Sb,
  interview: InterviewRow,
  assignment: AssignmentRow | null,
  settings: IntegritySettings,
  userId: string,
) {
  if (interview.status === "completed") {
    return jsonResponse({ ok: false, error: "interview_completed", status: "completed" }, 409);
  }
  if (interview.status === "failed" || interview.status === "cancelled") {
    return jsonResponse({ ok: false, error: "interview_unavailable", status: interview.status }, 409);
  }
  if (assignment && assignment.status !== "published") {
    return jsonResponse({ ok: false, error: "assignment_closed" }, 403);
  }

  if (settings.requireConsent) {
    const { data: consent } = await sb
      .from("interview_consents")
      .select("id")
      .eq("interview_id", interview.id)
      .eq("version", settings.consentVersion)
      .maybeSingle();
    if (!consent) {
      return jsonResponse({ ok: false, error: "consent_required", version: settings.consentVersion }, 412);
    }
  }

  const { data: planRow } = await sb
    .from("interview_plans")
    .select("plan")
    .eq("interview_id", interview.id)
    .maybeSingle();
  const plan = (planRow?.plan ?? null) as { questions?: PlanQuestion[] } | null;
  const questions = Array.isArray(plan?.questions) ? plan!.questions! : [];
  if (questions.length === 0) {
    return jsonResponse({ ok: false, error: "plan_missing" }, 409);
  }
  const outline = questions.map((q, i) => ({
    id: typeof q.id === "string" && q.id ? q.id : `q${i + 1}`,
    topic: typeof q.topic === "string" ? q.topic : "",
    kind: typeof q.kind === "string" ? q.kind : null,
    recommendedSeconds:
      typeof q.recommended_seconds === "number" ? q.recommended_seconds : 75,
  }));

  const resumed = isRunning(interview.status);
  const metadata = (interview.metadata ?? {}) as Record<string, unknown>;
  const previousAttempts =
    typeof metadata.attempts === "number" && Number.isFinite(metadata.attempts)
      ? metadata.attempts
      : 0;
  const attempts = previousAttempts + 1;
  const now = new Date().toISOString();

  const { error: updateError } = await sb
    .from("interviews")
    .update({
      status: "in_progress",
      current_state: "host_intro",
      started_at: interview.started_at ?? now,
      metadata: {
        ...metadata,
        attempts,
        last_started_at: now,
        integrity: {
          camera: settings.camera,
          activity_monitoring: settings.activityMonitoring,
          silence_nudge_seconds: settings.silenceNudgeSeconds,
          overlap_check: settings.overlapCheck,
          host_flags: settings.hostFlags,
        },
      },
    })
    .eq("id", interview.id);
  if (updateError) return errorResponse("interview_start_failed", 500);

  // Where was the conversation when the room reloads? Derived from what was
  // actually stored, never from the client.
  let lastQuestionIndex = -1;
  let answeredQuestionIds: string[] = [];
  if (resumed) {
    const { data: rows } = await sb
      .from("interview_messages")
      .select("speaker, message_type, plan_question_id, content")
      .eq("interview_id", interview.id)
      .order("created_at", { ascending: true });
    const ids = outline.map((q) => q.id);
    const answered = new Set<string>();
    for (const row of (rows ?? []) as { speaker: string; message_type: string; plan_question_id: string | null; content: string | null }[]) {
      if (!row.plan_question_id) continue;
      const idx = ids.indexOf(row.plan_question_id);
      if (idx < 0) continue;
      if (row.speaker === "ai_host" && idx > lastQuestionIndex) lastQuestionIndex = idx;
      if (
        row.speaker === "student" &&
        row.message_type === "answer" &&
        (row.content ?? "").trim().length > 2 &&
        !/^\s*\[(SYSTEM NOTE|הודעת מערכת)\]/.test(row.content ?? "")
      ) {
        answered.add(row.plan_question_id);
      }
    }
    answeredQuestionIds = ids.filter((id) => answered.has(id));

    await sb.from("interview_integrity_events").insert({
      interview_id: interview.id,
      student_id: userId,
      plan_question_id: lastQuestionIndex >= 0 ? ids[lastQuestionIndex] : null,
      kind: "session_resumed",
      source: "server",
      started_at: now,
      payload: { attempt: attempts, last_question_index: lastQuestionIndex },
    });
  }

  await sb.from("system_events").insert({
    actor_id: userId,
    entity_type: "interview",
    entity_id: interview.id,
    event_type: resumed ? "interview.resumed" : "interview.started",
    payload: { attempt: attempts },
  });

  return jsonResponse({
    ok: true,
    status: "in_progress",
    resumed,
    attempt: attempts,
    outline,
    resume: { lastQuestionIndex, answeredQuestionIds },
    settings,
  });
}

function parseIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  // Reject timestamps far in the future (clock games); allow 5 min skew.
  if (t > Date.now() + 5 * 60_000) return null;
  return new Date(t).toISOString();
}

function compactPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > MAX_PAYLOAD_CHARS) return { truncated: true };
  return value as Record<string, unknown>;
}

async function handleEvents(sb: Sb, interview: InterviewRow, body: Record<string, unknown>) {
  if (!isRunning(interview.status) && !isRecentlyCompleted(interview)) {
    return jsonResponse({ ok: false, error: "interview_not_running" }, 409);
  }
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_BATCH) : [];
  const rows: Record<string, unknown>[] = [];
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    const kind = typeof e.kind === "string" ? e.kind : "";
    if (!EVENT_KINDS.has(kind)) continue;
    const startedAt = parseIso(e.startedAt) ?? new Date().toISOString();
    const endedAt = parseIso(e.endedAt);
    let durationMs: number | null =
      typeof e.durationMs === "number" && Number.isFinite(e.durationMs)
        ? Math.round(e.durationMs)
        : null;
    if (durationMs === null && endedAt) {
      durationMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
    }
    if (durationMs !== null) durationMs = Math.max(0, Math.min(MAX_EVENT_DURATION_MS, durationMs));
    rows.push({
      interview_id: interview.id,
      student_id: interview.student_id,
      plan_question_id:
        typeof e.planQuestionId === "string" && e.planQuestionId.length <= 64
          ? e.planQuestionId
          : null,
      kind,
      source: "client",
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      payload: compactPayload(e.payload),
    });
  }
  if (rows.length === 0) return jsonResponse({ ok: true, recorded: 0 });
  const { error } = await sb.from("interview_integrity_events").insert(rows);
  if (error) return errorResponse("events_insert_failed", 500);
  return jsonResponse({ ok: true, recorded: rows.length });
}

async function handleFlag(
  sb: Sb,
  interview: InterviewRow,
  settings: IntegritySettings,
  body: Record<string, unknown>,
) {
  if (!settings.hostFlags) return jsonResponse({ ok: true, recorded: 0, disabled: true });
  if (!isRunning(interview.status) && !isRecentlyCompleted(interview)) {
    return jsonResponse({ ok: false, error: "interview_not_running" }, 409);
  }
  const flag = body.flag && typeof body.flag === "object" ? (body.flag as Record<string, unknown>) : null;
  if (!flag) return errorResponse("invalid_flag", 400);
  const category = typeof flag.category === "string" && FLAG_CATEGORIES.has(flag.category)
    ? flag.category
    : "other";
  const description = typeof flag.description === "string" ? flag.description.trim().slice(0, 600) : "";
  if (!description) return errorResponse("invalid_flag_description", 400);
  const quote = typeof flag.quote === "string" ? flag.quote.trim().slice(0, 400) || null : null;
  const confidence = typeof flag.confidence === "string" && FLAG_CONFIDENCE.has(flag.confidence)
    ? flag.confidence
    : "low";
  const planQuestionId =
    typeof flag.planQuestionId === "string" && flag.planQuestionId.length <= 64
      ? flag.planQuestionId
      : null;

  const { data, error } = await sb
    .from("interview_flags")
    .insert({
      interview_id: interview.id,
      student_id: interview.student_id,
      plan_question_id: planQuestionId,
      category,
      description,
      quote,
      evidence: [],
      confidence,
      needs_human_review: true,
      limitations:
        "Raised by the AI host during the conversation. It is the host's impression of one answer, reported through the student's browser, not a verified finding.",
      source: "host_tool",
    })
    .select("id")
    .single();
  if (error || !data) return errorResponse("flag_insert_failed", 500);
  return jsonResponse({ ok: true, flagId: data.id });
}

async function handleDisconnect(sb: Sb, interview: InterviewRow, body: Record<string, unknown>) {
  if (!isRunning(interview.status)) return jsonResponse({ ok: true, recorded: 0 });
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 120) : "unknown";
  const planQuestionId =
    typeof body.planQuestionId === "string" && body.planQuestionId.length <= 64
      ? body.planQuestionId
      : null;
  await sb.from("interview_integrity_events").insert({
    interview_id: interview.id,
    student_id: interview.student_id,
    plan_question_id: planQuestionId,
    kind: "disconnect",
    source: "client",
    started_at: new Date().toISOString(),
    payload: { reason },
  });
  return jsonResponse({ ok: true, recorded: 1 });
}
