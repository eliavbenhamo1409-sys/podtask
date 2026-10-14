"use client";

import { createClient } from "@/lib/supabase/client";
import {
  normalizeInterviewLanguage,
  type InterviewLanguage,
} from "@/lib/student/interview-language";

export interface RealtimeSessionToken {
  clientSecret: string;
  expiresAt: string;
  model: string;
  voice: string;
  /** The language the session was minted for (host speech + transcription). */
  language: InterviewLanguage;
  /** Prompt given to the transcription model; the room treats an echo of it as noise. */
  transcriptionHint: string | null;
}

export interface RealtimeSessionError {
  ok: false;
  error: string;
}

/**
 * Mints an ephemeral OpenAI Realtime client secret by calling the
 * `create-realtime-session` Supabase Edge Function. The function reads the
 * server-only `openai_realtime` secret and returns a short-lived `ek_*`
 * token plus the session model/voice/language we should use in the browser.
 */
export async function createRealtimeSession(
  interviewId: string,
): Promise<RealtimeSessionToken> {
  const sb = createClient();
  const { data, error } = await sb.functions.invoke<
    | ({ ok: true } & Omit<RealtimeSessionToken, "language" | "transcriptionHint"> & {
        language?: string;
        transcriptionHint?: string | null;
      })
    | RealtimeSessionError
  >("create-realtime-session", {
    body: { interviewId },
  });

  if (error) {
    throw new Error(`realtime_session_invoke_failed: ${error.message}`);
  }
  if (!data || !("ok" in data) || !data.ok) {
    const msg =
      data && "error" in data ? data.error : "realtime_session_unknown_error";
    throw new Error(msg);
  }

  return {
    clientSecret: data.clientSecret,
    expiresAt: data.expiresAt,
    model: data.model,
    voice: data.voice,
    language: normalizeInterviewLanguage(data.language),
    transcriptionHint:
      typeof data.transcriptionHint === "string" && data.transcriptionHint
        ? data.transcriptionHint
        : null,
  };
}
