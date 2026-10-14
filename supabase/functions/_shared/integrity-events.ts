// Integrity Event Engine: validation and normalisation of client telemetry
// batches for `interview-control` (action "events"). Pure module, no Deno
// APIs, so the Node test suite in `tests/integrity/` can import it directly.
//
// Trust model: everything here arrives from the student's browser. Rows are
// stored with `source = "client"`; the lecturer report says so. An interval
// event (tab hidden, no face, ...) is sent twice under the same client
// `eventId`: once when it opens and once when it closes. The first copy is
// inserted, later copies only fill in `ended_at` / `duration_ms`, and a
// re-sent batch (retry after a network error, reload with a persisted
// buffer) never creates a second row thanks to the unique index on
// (interview_id, event_id).
//
// Keep EVENT_KINDS in sync with `lib/integrity/types.ts`.

export const EVENT_KINDS = [
  "visibility_hidden",
  "tab_returned",
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
  "camera_exemption",
  "face_missing",
  "multiple_faces",
  "head_away",
  "tracking_unavailable",
  "silence_nudge",
  "own_words_prompt",
  "mic_muted",
  "disconnect",
  "reconnect",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(EVENT_KINDS);

export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_PAYLOAD_CHARS = 2000;
export const MAX_EVENT_DURATION_MS = 60 * 60 * 1000;
/** Clock skew tolerated on client timestamps. */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
/** Events older than this relative to `now` are clamped (a wrong clock, not a time machine). */
export const MAX_PAST_MS = 24 * 60 * 60 * 1000;
/** Hard cap of stored rows per interview; the client drops beyond it. */
export const MAX_EVENTS_PER_INTERVIEW = 3000;

export const CAMERA_EXEMPTION_REASONS = [
  "accessibility",
  "no_camera",
  "permission_blocked",
  "hardware_failure",
  "other",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IntegrityEventRow {
  interview_id: string;
  student_id: string;
  event_id: string;
  client_seq: number | null;
  plan_question_id: string | null;
  kind: EventKind;
  source: "client";
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  confidence: number | null;
  payload: Record<string, unknown>;
}

/** A later copy of an interval event that carries its end. */
export interface IntegrityEventClose {
  event_id: string;
  ended_at: string;
  duration_ms: number;
  payload: Record<string, unknown>;
}

export interface NormalizedBatch {
  /** Rows to upsert with `ignoreDuplicates` (first copy wins). */
  inserts: IntegrityEventRow[];
  /** Ends to apply to already stored open intervals. */
  closes: IntegrityEventClose[];
  /** How many input items were dropped (unknown kind, malformed). */
  dropped: number;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function parseIso(value: unknown, now: number): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return null;
  // Reject timestamps far in the future (clock games); allow skew.
  if (t > now + MAX_FUTURE_SKEW_MS) return null;
  if (t < now - MAX_PAST_MS) return null;
  return new Date(t).toISOString();
}

export function compactPayload(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const json = JSON.stringify(value);
  if (json.length > MAX_PAYLOAD_CHARS) return { truncated: true };
  return value as Record<string, unknown>;
}

function clampDuration(ms: number): number {
  return Math.max(0, Math.min(MAX_EVENT_DURATION_MS, Math.round(ms)));
}

/**
 * Validates a batch from the browser. Every surviving event gets a UUID
 * `event_id` (the client's, or a fresh one for legacy clients), and events
 * that carry an end are additionally returned as `closes` so the handler
 * can fill in intervals that were inserted by an earlier batch.
 */
export function normalizeEventBatch(
  input: unknown,
  ctx: { interviewId: string; studentId: string; now: number; newId: () => string },
): NormalizedBatch {
  const events = Array.isArray(input) ? input.slice(0, MAX_EVENTS_PER_BATCH) : [];
  const inserts: IntegrityEventRow[] = [];
  const closes: IntegrityEventClose[] = [];
  const seenInBatch = new Map<string, number>();
  let dropped = 0;

  for (const raw of events) {
    if (!raw || typeof raw !== "object") {
      dropped += 1;
      continue;
    }
    const e = raw as Record<string, unknown>;
    const kind = typeof e.kind === "string" ? e.kind : "";
    if (!KIND_SET.has(kind)) {
      dropped += 1;
      continue;
    }
    const startedAt = parseIso(e.startedAt, ctx.now) ?? new Date(ctx.now).toISOString();
    const endedAt = parseIso(e.endedAt, ctx.now);
    let durationMs: number | null =
      typeof e.durationMs === "number" && Number.isFinite(e.durationMs)
        ? clampDuration(e.durationMs)
        : null;
    if (endedAt) {
      const span = new Date(endedAt).getTime() - new Date(startedAt).getTime();
      if (durationMs === null || Math.abs(durationMs - span) > 1000) durationMs = clampDuration(span);
    }
    const eventId = isUuid(e.eventId) ? e.eventId.toLowerCase() : ctx.newId();
    const payload = compactPayload(e.payload);
    const confidence =
      typeof e.confidence === "number" && Number.isFinite(e.confidence)
        ? Math.max(0, Math.min(1, e.confidence))
        : null;
    const row: IntegrityEventRow = {
      interview_id: ctx.interviewId,
      student_id: ctx.studentId,
      event_id: eventId,
      client_seq:
        typeof e.seq === "number" && Number.isFinite(e.seq) ? Math.max(0, Math.round(e.seq)) : null,
      plan_question_id:
        typeof e.planQuestionId === "string" && e.planQuestionId.length <= 64
          ? e.planQuestionId
          : null,
      kind: kind as EventKind,
      source: "client",
      started_at: startedAt,
      ended_at: endedAt,
      duration_ms: durationMs,
      confidence,
      payload,
    };

    // The same id twice in one batch (open + close): keep ONE insert that
    // already carries the end, so a single upsert stores the whole interval.
    const existing = seenInBatch.get(eventId);
    if (existing !== undefined) {
      if (endedAt) {
        inserts[existing] = { ...inserts[existing], ended_at: endedAt, duration_ms: durationMs, payload };
        closes.push({ event_id: eventId, ended_at: endedAt, duration_ms: durationMs ?? 0, payload });
      }
      continue;
    }
    seenInBatch.set(eventId, inserts.length);
    inserts.push(row);
    if (endedAt) {
      closes.push({ event_id: eventId, ended_at: endedAt, duration_ms: durationMs ?? 0, payload });
    }
  }
  // Dedupe closes by id (last wins).
  const byId = new Map<string, IntegrityEventClose>();
  for (const c of closes) byId.set(c.event_id, c);
  return { inserts, closes: [...byId.values()], dropped };
}

export interface CameraExemptionInput {
  reason: (typeof CAMERA_EXEMPTION_REASONS)[number];
  note: string | null;
}

export function parseCameraExemption(body: Record<string, unknown>): CameraExemptionInput | null {
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!(CAMERA_EXEMPTION_REASONS as readonly string[]).includes(reason)) return null;
  const note =
    typeof body.note === "string" ? body.note.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
  return { reason: reason as CameraExemptionInput["reason"], note };
}
