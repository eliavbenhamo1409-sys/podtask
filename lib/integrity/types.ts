/**
 * Client-side integrity types shared by the interview room, the monitors in
 * this folder and the student service. The server-side shapes live in
 * `supabase/functions/interview-control/index.ts`.
 */

export type IntegrityEventKind =
  | "visibility_hidden"
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
  | "face_missing"
  | "multiple_faces"
  | "silence_nudge"
  | "own_words_prompt"
  | "mic_muted"
  | "disconnect"
  | "reconnect";

export interface IntegrityClientEvent {
  kind: IntegrityEventKind;
  /** ISO timestamp. */
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  planQuestionId?: string | null;
  payload?: Record<string, unknown>;
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
