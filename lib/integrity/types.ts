/**
 * Client-side integrity types shared by the interview room, the monitors in
 * this folder and the student service. The server-side shapes live in
 * `supabase/functions/_shared/integrity-events.ts` (keep the kind list in
 * sync; the edge functions cannot import from `lib/`).
 *
 * Spec names → stored kinds:
 *   TAB_HIDDEN               visibility_hidden   (interval: opened when the tab
 *                                                 hides, closed when it returns)
 *   TAB_RETURNED             tab_returned        (point, carries the hidden id)
 *   WINDOW_BLUR              window_blur         (interval, emitted when it ends)
 *   CAMERA_DISCONNECTED      camera_off
 *   CAMERA_PERMISSION_DENIED camera_denied
 *   NO_FACE                  face_missing        (interval)
 *   MULTIPLE_FACES           multiple_faces      (interval)
 *   HEAD_AWAY                head_away           (interval)
 *   TRACKING_UNAVAILABLE     tracking_unavailable (interval)
 *   LIVE_WARNING             integrity_warning   (point: a warning sign was
 *                                                 shown on the self-view)
 */

export type IntegrityEventKind =
  | "visibility_hidden"
  | "tab_returned"
  | "window_blur"
  | "fullscreen_exit"
  | "fullscreen_enter"
  | "page_hidden"
  | "offline"
  | "camera_started"
  | "camera_denied"
  | "camera_unavailable"
  | "camera_off"
  | "camera_reconnected"
  | "camera_exemption"
  | "face_missing"
  | "multiple_faces"
  | "head_away"
  | "tracking_unavailable"
  | "integrity_warning"
  | "silence_nudge"
  | "own_words_prompt"
  | "mic_muted"
  | "disconnect"
  | "reconnect";

/**
 * One telemetry event. Interval kinds are sent twice with the SAME `eventId`:
 * once when they open (no `endedAt`) and once when they close (with
 * `endedAt` + `durationMs`). The server inserts the first and fills in the
 * end on the second, so a browser that dies mid-interval still leaves the
 * start behind, and a retried batch never produces a duplicate row.
 */
export interface IntegrityClientEvent {
  /** Client-generated UUID; assigned by the queue when missing. */
  eventId?: string;
  /** Monotonic per room load; orders events inside a batch. */
  seq?: number;
  kind: IntegrityEventKind;
  /** ISO timestamp. */
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  planQuestionId?: string | null;
  /** 0..1; only for detector-based kinds and only when it means something. */
  confidence?: number | null;
  payload?: Record<string, unknown>;
}

/** Why a student started a camera-required interview without a camera. */
export type CameraExemptionReason =
  | "accessibility"
  | "no_camera"
  | "permission_blocked"
  | "hardware_failure"
  | "other";

export const CAMERA_EXEMPTION_REASONS: readonly CameraExemptionReason[] = [
  "accessibility",
  "no_camera",
  "permission_blocked",
  "hardware_failure",
  "other",
];

export function newEventId(): string {
  const c = typeof globalThis.crypto !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // RFC 4122 v4 from Math.random: only reached in very old browsers.
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else if (i === 19) out += hex[(Math.random() * 4) | 8];
    else out += hex[(Math.random() * 16) | 0];
  }
  return out;
}

export type FlagCategory =
  | "contradiction"
  | "generic_answer"
  | "cannot_explain_term"
  | "verbatim_document"
  | "cannot_explain_decision"
  | "technical_context"
  | "other";

export interface HostFlagInput {
  category: FlagCategory | string;
  description: string;
  quote?: string | null;
  confidence?: "low" | "medium" | "high" | string;
  planQuestionId?: string | null;
}

/** Per-turn timing the room attaches to a persisted student answer. */
export interface TurnTimingMetadata {
  question_index?: number;
  latency_ms?: number;
  speech_ms?: number;
  host_turn_ended_at?: string;
  speech_started_at?: string;
  speech_stopped_at?: string;
  barge_in?: boolean;
  interruptions?: number;
  mute_toggles?: number;
  muted_during_turn?: boolean;
  nudged?: boolean;
  hidden_ms_since_last?: number;
  blur_count_since_last?: number;
}

/** Per-turn timing the room attaches to a persisted host line. */
export interface HostTurnMetadata {
  question_index?: number;
  playback_started_at?: string;
  playback_stopped_at?: string;
  stop_reason?: "stopped" | "cleared";
  response_id?: string;
}
