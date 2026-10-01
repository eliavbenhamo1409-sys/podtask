import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { buildRealtimeInstructions } from "../_shared/realtime-instructions.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

const REALTIME_MODEL = "gpt-realtime";
const REALTIME_VOICE_DEFAULT = "marin";
const EXPECTED_QUESTION_COUNT = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const apiKey = Deno.env.get("openai_realtime");
  if (!apiKey) return errorResponse("missing_secret_openai_realtime", 500);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId;
  if (typeof interviewId !== "string" || !/^[0-9a-f-]{36}$/i.test(interviewId)) {
    return errorResponse("invalid_interview_id", 400);
  }

  const sb = serviceClient();

  const { data: interview, error: interviewError } = await sb
    .from("interviews")
    .select("id, student_id, submission_id, assignment_id, language")
    .eq("id", interviewId)
    .maybeSingle();
  if (interviewError) return errorResponse("interview_lookup_failed", 500);
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const [{ data: assignment }, { data: plan }, { data: analysis }] =
    await Promise.all([
      sb
        .from("assignments")
        .select("id, title, language, interview_duration_minutes, settings")
        .eq("id", interview.assignment_id)
        .maybeSingle(),
      sb
        .from("interview_plans")
        .select("plan")
        .eq("interview_id", interview.id)
        .maybeSingle(),
      sb
        .from("document_analyses")
        .select(
          "summary, main_argument, key_concepts, claims, weak_points, interview_targets",
        )
        .eq("submission_id", interview.submission_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const language = (assignment?.language ?? interview.language ?? "he") as
    | "he"
    | "en";
  const voice =
    (assignment?.settings as { realtime_voice?: string } | null)
      ?.realtime_voice ?? REALTIME_VOICE_DEFAULT;

  // Pull the planned questions out of the plan blob. The host receives
  // the full list as part of its system prompt — it owns pacing and
  // moves between questions on its own (no per-question injection).
  const rawPlanQuestions = Array.isArray(
    (plan?.plan as { questions?: unknown[] } | null)?.questions,
  )
    ? (plan!.plan as { questions: unknown[] }).questions
    : [];
  const plannedQuestions = rawPlanQuestions
    .map((q) => {
      const obj = (q ?? {}) as {
        topic?: unknown;
        topic_he?: unknown;
        topic_en?: unknown;
        topicEn?: unknown;
        question?: unknown;
        question_he?: unknown;
        question_en?: unknown;
        questionEn?: unknown;
        text?: unknown;
      };
      const topic =
        typeof obj.topic === "string"
          ? obj.topic
          : typeof obj.topic_he === "string"
            ? obj.topic_he
            : typeof obj.topic_en === "string"
              ? obj.topic_en
              : typeof obj.topicEn === "string"
                ? obj.topicEn
                : "";
      const question =
        typeof obj.question === "string"
          ? obj.question
          : typeof obj.question_he === "string"
            ? obj.question_he
            : typeof obj.question_en === "string"
              ? obj.question_en
              : typeof obj.questionEn === "string"
                ? obj.questionEn
                : typeof obj.text === "string"
                  ? obj.text
                  : "";
      return { topic: topic.trim(), question: question.trim() };
    })
    .filter((q) => q.question.length > 0)
    .slice(0, EXPECTED_QUESTION_COUNT);

  const instructions = buildRealtimeInstructions({
    language,
    assignmentTitle: assignment?.title ?? "",
    interviewDurationMinutes: assignment?.interview_duration_minutes ?? 12,
    questions: plannedQuestions,
    analysis: analysis as {
      summary?: string;
      main_argument?: string;
      key_concepts?: unknown;
      claims?: unknown;
      weak_points?: unknown;
      interview_targets?: unknown;
    } | null,
  });

  const sessionConfig = {
    session: {
      type: "realtime",
      model: REALTIME_MODEL,
      // Enabling input.transcription is what makes the user audio buffer
      // emit `conversation.item.input_audio_transcription.delta/.completed`
      // events. Without this the user item arrives with empty content so
      // both the live pink caption AND the watchdog (which arms off the
      // assistant message-done event) never fire, leaving the on-screen
      // question stuck and the student answer missing from the DB.
      //
      // turn_detection tuning (server_vad):
      //   - threshold 0.72: noticeably less sensitive than the 0.5
      //     default. Wind, breath, keyboard clicks and ambient room
      //     noise stop tripping the speech-started gate, which prevents
      //     the host from "hearing" content the student never said and
      //     hallucinating a response to it.
      //   - silence_duration_ms 1800: holds the turn open through ~2s
      //     of silence so a student who pauses mid-thought doesn't get
      //     interrupted. The host only takes the floor once a real,
      //     sustained pause confirms the answer is finished.
      //   - prefix_padding_ms 350: includes a touch more pre-speech
      //     audio so the first syllable of the answer isn't clipped
      //     by the higher threshold.
      //   - create_response: true keeps the auto-respond behavior so
      //     the host still answers without the student having to
      //     press anything; interrupt_response: true keeps barge-in
      //     working when the student starts speaking over the host.
      audio: {
        input: {
          transcription: { model: "gpt-4o-transcribe" },
          turn_detection: {
            type: "server_vad",
            threshold: 0.72,
            prefix_padding_ms: 350,
            silence_duration_ms: 1800,
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice },
      },
      instructions,
      // The host now owns pacing — it walks through the planned questions
      // listed in its system prompt on its own.
      //
      // Compatibility note: we keep a no-op `ask_question_at_index` tool
      // exposed to avoid legacy-model behavior from turning into user-facing
      // "technical issue" apologies. Some model trajectories still attempt
      // that old tool name; returning a successful no-op keeps the dialogue
      // flowing naturally.
      tools: [
        {
          type: "function",
          name: "ask_question_at_index",
          description:
            "Compatibility no-op. Legacy assistant flows may call this tool name; calling it has no effect and should not be mentioned out loud.",
          parameters: {
            type: "object",
            additionalProperties: true,
            properties: {
              index: { type: "integer" },
              topic: { type: "string" },
              question: { type: "string" },
            },
          },
        },
        {
          type: "function",
          name: "finish_interview",
          description:
            "Ends the interview. Call it ONLY AFTER you have completely finished speaking your farewell (acknowledgement, thank-you, goodbye) — calling it mid-sentence cuts your audio off. reason='completed' after the planned questions, reason='ended_early' when the student asked to stop. If the system afterwards asks you for a farewell, say it in full.",
          parameters: {
            type: "object",
            additionalProperties: false,
            required: ["reason"],
            properties: {
              reason: {
                type: "string",
                enum: ["completed", "ended_early"],
              },
            },
          },
        },
      ],
      tool_choice: "auto",
    },
  };

  const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(sessionConfig),
  });

  if (!r.ok) {
    const errText = await r.text();
    await sb.from("system_events").insert({
      event_type: "realtime.client_secret.failed",
      actor_id: auth.userId,
      entity_type: "interview",
      entity_id: interview.id,
      payload: { severity: "error", status: r.status, body: errText.slice(0, 500) },
    });
    return errorResponse(`openai_error_${r.status}`, 502);
  }

  const data = (await r.json()) as {
    value: string;
    expires_at?: number;
    session?: { expires_at?: number };
  };
  const clientSecret = data.value;
  const expiresAtUnix =
    data.expires_at ?? data.session?.expires_at ?? Math.floor(Date.now() / 1000) + 60;
  const expiresAt = new Date(expiresAtUnix * 1000).toISOString();

  await sb.from("system_events").insert({
    event_type: "realtime.client_secret.created",
    actor_id: auth.userId,
    entity_type: "interview",
    entity_id: interview.id,
    payload: {
      severity: "info",
      model: REALTIME_MODEL,
      voice,
      question_count_in_prompt: plannedQuestions.length,
      expected_question_count: EXPECTED_QUESTION_COUNT,
    },
  });

  return jsonResponse({
    ok: true,
    clientSecret,
    expiresAt,
    model: REALTIME_MODEL,
    voice,
    language,
  });
});
