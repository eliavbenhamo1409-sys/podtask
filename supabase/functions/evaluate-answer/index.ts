// Edge Function: evaluate-answer
//
// Per-question KNOWLEDGE evaluation of a finished interview, written to
// `answer_evaluations` (one row per planned question that got an answer).
// Called server-to-server by `complete-interview` with the student's
// Authorization header forwarded; the student may also call it for their own
// interview (idempotent: previous rows for the interview are replaced).
//
// Strict separation: this function judges understanding only. It is told
// nothing about telemetry or flags and is instructed never to speculate
// about assistance. Integrity signals live in `interview_flags` /
// `interview_integrity_events` and are produced elsewhere.
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import {
  callResponses,
  DEFAULT_MODELS,
  OpenAIError,
  type ResponsesMessage,
} from "../_shared/openai.ts";
import { isDirective } from "../_shared/integrity.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

const EVALUATION_MODEL = DEFAULT_MODELS.analyze; // gpt-4.1-mini

interface QuestionEvaluation {
  question_id: string;
  understanding_level: "low" | "medium" | "medium_high" | "high";
  relevance: number;
  accuracy: number;
  explanation: number;
  consistency: number;
  process: number;
  application: number;
  evidence: string[];
  gaps: string[];
  summary: string;
}

interface EvaluationResult {
  evaluations: QuestionEvaluation[];
}

const SCORE = { type: "number", minimum: 0, maximum: 5 } as const;

const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["evaluations"],
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "question_id",
          "understanding_level",
          "relevance",
          "accuracy",
          "explanation",
          "consistency",
          "process",
          "application",
          "evidence",
          "gaps",
          "summary",
        ],
        properties: {
          question_id: { type: "string" },
          understanding_level: {
            type: "string",
            enum: ["low", "medium", "medium_high", "high"],
          },
          relevance: SCORE,
          accuracy: SCORE,
          explanation: SCORE,
          consistency: SCORE,
          process: SCORE,
          application: SCORE,
          evidence: { type: "array", items: { type: "string" } },
          gaps: { type: "array", items: { type: "string" } },
          summary: { type: "string" },
        },
      },
    },
  },
} as const;

interface PlanQ {
  id?: string;
  topic?: string;
  question?: string;
  key_points?: string[];
}

interface MessageRow {
  id: string;
  speaker: string;
  message_type: string;
  content: string | null;
  plan_question_id: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId;
  if (typeof interviewId !== "string" || !/^[0-9a-f-]{36}$/i.test(interviewId)) {
    return errorResponse("invalid_interview_id");
  }

  const sb = serviceClient();
  const { data: interview } = await sb
    .from("interviews")
    .select("id, submission_id, assignment_id, student_id, language, status")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);
  if (interview.status !== "completed") return errorResponse("interview_not_completed", 409);

  const [{ data: assignment }, { data: analysis }, { data: planRow }, { data: messages }] =
    await Promise.all([
      sb.from("assignments").select("title, language").eq("id", interview.assignment_id).maybeSingle(),
      sb
        .from("document_analyses")
        .select("summary, main_argument, key_concepts, claims")
        .eq("submission_id", interview.submission_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb.from("interview_plans").select("plan").eq("interview_id", interviewId).maybeSingle(),
      sb
        .from("interview_messages")
        .select("id, speaker, message_type, content, plan_question_id")
        .eq("interview_id", interviewId)
        .order("created_at", { ascending: true }),
    ]);

  const plan = (planRow?.plan ?? null) as { questions?: PlanQ[] } | null;
  const questions = (plan?.questions ?? []).filter((q) => q?.id && q?.question);
  const rows = (messages ?? []) as MessageRow[];

  // Group the conversation by planned question, dropping the room's
  // steering notes (they are not speech).
  const byQuestion = new Map<string, { host: string[]; student: string[]; firstAnswerId: string | null }>();
  for (const q of questions) byQuestion.set(q.id!, { host: [], student: [], firstAnswerId: null });
  for (const row of rows) {
    if (!row.plan_question_id || !byQuestion.has(row.plan_question_id)) continue;
    const text = (row.content ?? "").trim();
    if (!text || isDirective(text)) continue;
    const g = byQuestion.get(row.plan_question_id)!;
    if (row.speaker === "ai_host") g.host.push(text);
    else if (row.speaker === "student") {
      g.student.push(text);
      if (!g.firstAnswerId) g.firstAnswerId = row.id;
    }
  }
  const answered = questions.filter((q) => (byQuestion.get(q.id!)?.student.length ?? 0) > 0);
  if (answered.length === 0) {
    await sb.from("answer_evaluations").delete().eq("interview_id", interviewId);
    return jsonResponse({ ok: true, evaluated: 0 });
  }

  const language = toLanguage(interview.language) ?? toLanguage(assignment?.language) ?? "he";
  const languageName = language === "he" ? "Hebrew" : language === "ar" ? "Arabic" : "English";

  const system = [
    "You evaluate, question by question, how well a student understands their own submitted assignment, based on an oral interview transcript.",
    "You return strict JSON matching the schema. Never include text outside the JSON.",
    `Write every string field in ${languageName}.`,
    "Scores are 0-5 and judge KNOWLEDGE ONLY:",
    "  - relevance: the answer addresses what was asked.",
    "  - accuracy: correct with respect to the submission and the course material it cites.",
    "  - explanation: the student can explain the idea in their own words, not just name it.",
    "  - consistency: fits the submission and the student's other answers.",
    "  - process: understanding of how the work was done (choices, data, steps, trade-offs).",
    "  - application: can use the idea in a new situation or defend it against a counter-position.",
    "understanding_level: low (0-1.9 average), medium (2-2.9), medium_high (3-3.9), high (4-5).",
    "evidence: 1-3 short verbatim quotes from the student's answers that support your scores. gaps: 0-3 concrete things that were missing or wrong. summary: one or two sentences.",
    "A polished, fluent answer is not evidence of anything other than a polished answer; a hesitant answer with the right ideas still earns the scores its content deserves. Never speculate about outside help, reading or tools, and never mention timing, pauses or style.",
    "Grade only what the student actually said about THIS submission. Never attribute to the student anything that is not in the transcript, and never fill gaps from the document summary.",
    "Return exactly one evaluation per question_id listed, in the same order.",
  ].join("\n");

  const context: string[] = [];
  if (assignment?.title) context.push(`Assignment title: "${assignment.title}".`);
  if (analysis?.summary) context.push(`Document summary: ${analysis.summary}`);
  if (analysis?.main_argument) context.push(`Main argument: ${analysis.main_argument}`);
  const concepts = asStringList(analysis?.key_concepts);
  if (concepts.length) context.push(`Key concepts: ${concepts.slice(0, 8).join("; ")}`);
  const claims = asStringList(analysis?.claims);
  if (claims.length) context.push(`Claims in the submission: ${claims.slice(0, 6).join("; ")}`);

  const blocks = answered.map((q, i) => {
    const g = byQuestion.get(q.id!)!;
    const points = Array.isArray(q.key_points) ? q.key_points.filter((p) => typeof p === "string") : [];
    return [
      `### question_id: ${q.id}`,
      `Planned question ${i + 1} [${q.topic ?? ""}]: ${q.question}`,
      points.length ? `Expected key points: ${points.join("; ")}` : "",
      `Host said: ${g.host.join(" / ").slice(0, 1500)}`,
      `Student answered: ${g.student.join(" / ").slice(0, 4000)}`,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const input: ResponsesMessage[] = [
    { role: "system", content: [{ type: "input_text", text: system }] },
    {
      role: "user",
      content: [
        { type: "input_text", text: `${context.join("\n")}\n\n${blocks.join("\n\n")}` },
      ],
    },
  ];

  let result: EvaluationResult;
  try {
    result = await callResponses<EvaluationResult>({
      model: EVALUATION_MODEL,
      input,
      schemaName: "answer_evaluations",
      schema: EVALUATION_SCHEMA as unknown as Record<string, unknown>,
      operation: "evaluate_answer",
      temperature: 0.1,
    });
  } catch (err) {
    const code = err instanceof OpenAIError ? err.message : "openai_call_failed";
    const status = err instanceof OpenAIError ? err.status : 502;
    await sb.from("system_events").insert({
      actor_id: auth.userId,
      entity_type: "interview",
      entity_id: interviewId,
      event_type: "evaluation.failed",
      payload: { severity: "error", reason: code },
    });
    return errorResponse(code, status);
  }

  const wanted = new Set(answered.map((q) => q.id!));
  const seen = new Set<string>();
  const inserts = [];
  for (const e of result.evaluations ?? []) {
    if (!wanted.has(e.question_id) || seen.has(e.question_id)) continue;
    seen.add(e.question_id);
    inserts.push({
      interview_id: interviewId,
      message_id: byQuestion.get(e.question_id)?.firstAnswerId ?? null,
      question_id: e.question_id,
      model: EVALUATION_MODEL,
      understanding_level: e.understanding_level,
      clarity_score: clamp(e.explanation),
      conceptual_score: clamp(e.accuracy),
      reasoning_score: clamp(e.application),
      consistency_score: clamp(e.consistency),
      evidence: e.evidence.slice(0, 3),
      gaps: e.gaps.slice(0, 3),
      recommended_next_action: null,
      recommended_followup: null,
      raw_output: {
        relevance: clamp(e.relevance),
        accuracy: clamp(e.accuracy),
        explanation: clamp(e.explanation),
        consistency: clamp(e.consistency),
        process: clamp(e.process),
        application: clamp(e.application),
        summary: e.summary,
      },
    });
  }

  await sb.from("answer_evaluations").delete().eq("interview_id", interviewId);
  if (inserts.length) {
    const { error } = await sb.from("answer_evaluations").insert(inserts);
    if (error) return errorResponse("insert_failed", 500);
  }

  await sb.from("ai_usage_logs").insert({
    user_id: auth.userId,
    entity_type: "interview",
    entity_id: interviewId,
    provider: "openai",
    model: EVALUATION_MODEL,
    operation: "evaluate_answer",
    estimated_cost_usd: 0,
  });

  return jsonResponse({ ok: true, evaluated: inserts.length });
});

function clamp(n: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}

function toLanguage(value: unknown): "he" | "en" | "ar" | null {
  return value === "he" || value === "en" || value === "ar" ? value : null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}
