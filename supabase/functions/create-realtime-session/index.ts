import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { buildRealtimeInstructions } from "../_shared/realtime-instructions.ts";
import {
  isPersonalCourseCode,
  resolveIntegritySettings,
} from "../_shared/integrity-settings.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

const REALTIME_MODEL = "gpt-realtime";
const REALTIME_VOICE_DEFAULT = "marin";
const EXPECTED_QUESTION_COUNT = 5;
// Input transcription is pinned to the interview language (ISO 639-1) so a
// noisy or silent microphone can never surface as text in a random language.
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
// Students mostly sit at a laptop; `far_field` is OpenAI's profile for that.
// Overridable per assignment via settings.noise_reduction ("near_field" /
// "far_field" / "off").
const NOISE_REDUCTION_DEFAULT: "near_field" | "far_field" = "far_field";
// Session minting is bounded per interview: a reconnect needs one, a loop
// does not. (One interview once minted 1,677 secrets before this guard.)
const MINT_WINDOW_MS = 10 * 60 * 1000;
const MAX_MINTS_PER_WINDOW = 8;
const MAX_MINTS_TOTAL = 40;

type InterviewLanguage = "he" | "en" | "ar";

function toLanguage(value: unknown): InterviewLanguage | null {
  return value === "he" || value === "en" || value === "ar" ? value : null;
}

/**
 * Short prompt for the transcription model: it biases the output towards
 * the interview language and the submission's vocabulary. Kept short on
 * purpose; the browser treats an utterance that merely echoes it as noise.
 */
function buildTranscriptionHint(
  language: InterviewLanguage,
  assignmentTitle: string,
  concepts: string[],
): string {
  const title = assignmentTitle.trim().slice(0, 80);
  const terms = concepts
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 40)
    .slice(0, 6)
    .join(", ");
  if (language === "he") {
    return [
      title ? `ראיון אקדמי בעברית על העבודה "${title}".` : "ראיון אקדמי בעברית על עבודה שהוגשה.",
      terms ? `מונחים: ${terms}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  if (language === "ar") {
    return [
      title ? `مقابلة أكاديمية باللغة العربية حول العمل "${title}".` : "مقابلة أكاديمية باللغة العربية حول عمل مقدَّم.",
      terms ? `مصطلحات: ${terms}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    title ? `Academic interview in English about the submission "${title}".` : "Academic interview in English about a submitted paper.",
    terms ? `Terms: ${terms}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function asStringArray(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

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
    .select("id, student_id, submission_id, assignment_id, language, status, metadata")
    .eq("id", interviewId)
    .maybeSingle();
  if (interviewError) return errorResponse("interview_lookup_failed", 500);
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  // Status guard: only an interview the server has started (interview-control
  // "start") can mint a voice session; a finished one never can.
  if (interview.status === "completed") return errorResponse("interview_completed", 409);
  if (interview.status !== "in_progress") return errorResponse("interview_not_started", 409);

  // Rate limit per interview (server-side event log, cannot be reset by the client).
  const since = new Date(Date.now() - MINT_WINDOW_MS).toISOString();
  const [{ count: recentMints }, { count: totalMints }] = await Promise.all([
    sb
      .from("system_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "interview")
      .eq("entity_id", interview.id)
      .eq("event_type", "realtime.client_secret.created")
      .gte("created_at", since),
    sb
      .from("system_events")
      .select("id", { count: "exact", head: true })
      .eq("entity_type", "interview")
      .eq("entity_id", interview.id)
      .eq("event_type", "realtime.client_secret.created"),
  ]);
  if ((recentMints ?? 0) >= MAX_MINTS_PER_WINDOW || (totalMints ?? 0) >= MAX_MINTS_TOTAL) {
    await sb.from("system_events").insert({
      event_type: "realtime.client_secret.rate_limited",
      actor_id: auth.userId,
      entity_type: "interview",
      entity_id: interview.id,
      payload: { severity: "warn", recent: recentMints ?? 0, total: totalMints ?? 0 },
    });
    return errorResponse("too_many_sessions", 429);
  }

  const [{ data: assignment }, { data: plan }, { data: analysis }] =
    await Promise.all([
      sb
        .from("assignments")
        .select("id, title, language, interview_duration_minutes, settings, course:courses ( code )")
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

  // The interview row carries the language the student chose in the lobby;
  // the assignment language is only the fallback for rows created before
  // that choice existed. The plan / analysis were generated in the
  // assignment language (he / en).
  const language: InterviewLanguage =
    toLanguage(interview.language) ?? toLanguage(assignment?.language) ?? "he";
  const planLanguage: "he" | "en" = assignment?.language === "en" ? "en" : "he";
  const settings = (assignment?.settings ?? null) as {
    realtime_voice?: string;
    noise_reduction?: string;
  } | null;
  const voice = settings?.realtime_voice ?? REALTIME_VOICE_DEFAULT;
  const noiseReduction =
    settings?.noise_reduction === "off"
      ? null
      : settings?.noise_reduction === "near_field" ||
          settings?.noise_reduction === "far_field"
        ? settings.noise_reduction
        : NOISE_REDUCTION_DEFAULT;

  const courseRaw = (assignment as { course?: { code: string } | { code: string }[] | null } | null)?.course;
  const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
  const integrity = resolveIntegritySettings(assignment?.settings, {
    personal: isPersonalCourseCode(course?.code),
  });

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
        id?: unknown;
        topic?: unknown;
        topic_he?: unknown;
        topic_en?: unknown;
        topicEn?: unknown;
        question?: unknown;
        question_he?: unknown;
        question_en?: unknown;
        questionEn?: unknown;
        text?: unknown;
        kind?: unknown;
        anchor?: unknown;
        key_points?: unknown;
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
      return {
        id: typeof obj.id === "string" ? obj.id : "",
        topic: topic.trim(),
        question: question.trim(),
        kind: typeof obj.kind === "string" ? obj.kind : undefined,
        anchor: typeof obj.anchor === "string" ? obj.anchor.trim() : undefined,
        keyPoints: asStringArray(obj.key_points),
      };
    })
    .filter((q) => q.question.length > 0)
    .slice(0, EXPECTED_QUESTION_COUNT);

  // Resume context: after a drop the room reloads and the host must pick up
  // where the conversation was, not start over. Derived from stored rows.
  const metadata = (interview.metadata ?? {}) as { attempts?: number };
  const attempt = typeof metadata.attempts === "number" ? metadata.attempts : 1;
  let resume: { questionNumber: number; answeredCount: number } | null = null;
  if (attempt > 1 && plannedQuestions.length > 0) {
    const { data: rows } = await sb
      .from("interview_messages")
      .select("speaker, message_type, plan_question_id, content")
      .eq("interview_id", interview.id)
      .order("created_at", { ascending: true });
    const ids = plannedQuestions.map((q) => q.id);
    let lastIdx = -1;
    const answered = new Set<string>();
    for (const row of (rows ?? []) as { speaker: string; message_type: string; plan_question_id: string | null; content: string | null }[]) {
      if (!row.plan_question_id) continue;
      const idx = ids.indexOf(row.plan_question_id);
      if (idx < 0) continue;
      if (row.speaker === "ai_host" && idx > lastIdx) lastIdx = idx;
      if (
        row.speaker === "student" &&
        row.message_type === "answer" &&
        (row.content ?? "").trim().length > 2 &&
        !/^\s*\[(SYSTEM NOTE|הודעת מערכת)\]/.test(row.content ?? "")
      ) {
        answered.add(row.plan_question_id);
      }
    }
    if (lastIdx >= 0 || answered.size > 0) {
      resume = {
        questionNumber: Math.max(1, lastIdx + 1),
        answeredCount: answered.size,
      };
    }
  }

  const analysisConcepts = Array.isArray(analysis?.key_concepts)
    ? (analysis!.key_concepts as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];
  // Vocabulary from the analysis only helps when it is in the interview
  // language; otherwise the hint is the generic one-liner.
  const transcriptionHint = buildTranscriptionHint(
    language,
    assignment?.title ?? "",
    planLanguage === language ? analysisConcepts : [],
  );

  const instructions = buildRealtimeInstructions({
    language,
    planLanguage,
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
    integrity: {
      silenceNudges: integrity.silenceNudgeSeconds > 0,
      ownWords: integrity.overlapCheck,
      hostFlags: integrity.hostFlags,
    },
    resume,
  });

  const tools: Record<string, unknown>[] = [
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
  ];
  if (integrity.hostFlags) {
    tools.push({
      type: "function",
      name: "flag_answer",
      description:
        "Silently notes one answer for the lecturer to look at later. Never changes the conversation and is never mentioned aloud. Use only after a clarifying question did not resolve the concern. category: contradiction (contradicts the submission or an earlier answer), generic_answer (does not engage with the question), cannot_explain_term (cannot explain a term the submission uses), verbatim_document (keeps reciting the document even after being asked for their own words), cannot_explain_decision (cannot explain a central decision of the work), technical_context (an unusual technical situation made the answer hard to judge), other. description: one factual sentence about what happened, no conclusions. quote: the student's words, short. confidence: how sure you are that the description is accurate (low/medium/high), not a judgement of the student.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["category", "description", "quote", "confidence"],
        properties: {
          category: {
            type: "string",
            enum: [
              "contradiction",
              "generic_answer",
              "cannot_explain_term",
              "verbatim_document",
              "cannot_explain_decision",
              "technical_context",
              "other",
            ],
          },
          description: { type: "string" },
          quote: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    });
  }

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
      //
      // transcription.language pins the speech-to-text model to the
      // interview language (it otherwise auto-detects per turn, and on
      // noise it invents text in whatever language it guesses);
      // transcription.prompt biases it towards the submission's vocabulary.
      // noise_reduction filters the input before VAD and the model, so
      // room noise is less likely to open a turn at all.
      audio: {
        input: {
          transcription: {
            model: TRANSCRIPTION_MODEL,
            language,
            prompt: transcriptionHint,
          },
          noise_reduction: noiseReduction ? { type: noiseReduction } : null,
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
      // The host owns pacing — it walks through the planned questions
      // listed in its system prompt on its own.
      //
      // Compatibility note: we keep a no-op `ask_question_at_index` tool
      // exposed to avoid legacy-model behavior from turning into user-facing
      // "technical issue" apologies. Some model trajectories still attempt
      // that old tool name; returning a successful no-op keeps the dialogue
      // flowing naturally.
      tools,
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
      language,
      plan_language: planLanguage,
      transcription_model: TRANSCRIPTION_MODEL,
      noise_reduction: noiseReduction ?? "off",
      question_count_in_prompt: plannedQuestions.length,
      expected_question_count: EXPECTED_QUESTION_COUNT,
      attempt,
      resumed: resume !== null,
      host_flags: integrity.hostFlags,
      silence_nudges: integrity.silenceNudgeSeconds > 0,
      own_words: integrity.overlapCheck,
    },
  });

  return jsonResponse({
    ok: true,
    clientSecret,
    expiresAt,
    model: REALTIME_MODEL,
    voice,
    language,
    transcriptionHint,
    resume,
  });
});
