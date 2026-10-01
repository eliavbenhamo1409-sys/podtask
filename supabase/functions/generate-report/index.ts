// Edge Function: generate-report
//
// Scores a completed interview with gpt-4.1 and writes the `reports` row the
// /complete page polls for. The transcript is grouped by planned question;
// `system:` lines carry structured events written by the interview room:
//   skipped_question:N   — the student skipped planned question N (penalised)
//   replaced_question:N  — the student swapped question N once (no penalty)
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import {
  callResponses,
  DEFAULT_MODELS,
  OpenAIError,
  type ResponsesMessage,
} from "../_shared/openai.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

interface ReportResult {
  overall_score: number;
  overall_level: "low" | "medium" | "medium_high" | "high";
  rubric: {
    conceptual: number;
    reasoning: number;
    communication: number;
    evidence: number;
  };
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  evidence: string[];
  gaps: string[];
  summary: string;
}

const REPORT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "overall_score",
    "overall_level",
    "rubric",
    "strengths",
    "weaknesses",
    "recommendations",
    "evidence",
    "gaps",
    "summary",
  ],
  properties: {
    overall_score: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Holistic 0-100 grade for how well the student understands their submission.",
    },
    overall_level: {
      type: "string",
      enum: ["low", "medium", "medium_high", "high"],
    },
    rubric: {
      type: "object",
      additionalProperties: false,
      required: ["conceptual", "reasoning", "communication", "evidence"],
      properties: {
        conceptual: { type: "number", minimum: 0, maximum: 5 },
        reasoning: { type: "number", minimum: 0, maximum: 5 },
        communication: { type: "number", minimum: 0, maximum: 5 },
        evidence: { type: "number", minimum: 0, maximum: 5 },
      },
    },
    strengths: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    weaknesses: { type: "array", minItems: 3, maxItems: 6, items: { type: "string" } },
    recommendations: { type: "array", minItems: 3, maxItems: 5, items: { type: "string" } },
    evidence: { type: "array", minItems: 0, maxItems: 6, items: { type: "string" } },
    gaps: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
    summary: { type: "string", description: "4-6 sentence narrative." },
  },
} as const;

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
    .select("id, submission_id, assignment_id, student_id, language")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const [{ data: assignment }, { data: analysis }, { data: planRow }, { data: messages }] =
    await Promise.all([
      sb.from("assignments").select("id, title, language").eq("id", interview.assignment_id).maybeSingle(),
      sb.from("document_analyses").select("summary, main_argument, key_concepts, interview_targets, weak_points").eq("submission_id", interview.submission_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      sb.from("interview_plans").select("plan").eq("interview_id", interviewId).maybeSingle(),
      sb.from("interview_messages").select("speaker, message_type, content, plan_question_id, created_at").eq("interview_id", interviewId).order("created_at", { ascending: true }),
    ]);

  const rows = (messages ?? []) as MessageRow[];
  const plan = (planRow?.plan ?? null) as { questions?: PlanQ[] } | null;
  const transcript = buildTranscript(rows, plan);
  const { skipped, replaced } = collectQuestionEvents(rows);

  const language = (assignment?.language === "en" ? "en" : interview.language === "en" ? "en" : "he") as "he" | "en";

  let report: ReportResult;
  try {
    report = await callResponses<ReportResult>({
      model: DEFAULT_MODELS.score,
      input: buildScoringMessages({
        language,
        assignmentTitle: assignment?.title ?? "",
        analysis: (analysis ?? null) as ScoringAnalysis | null,
        plan,
        transcript,
        skipped,
        replaced,
      }),
      schemaName: "interview_report",
      schema: REPORT_SCHEMA as unknown as Record<string, unknown>,
      operation: "generate_report",
      temperature: 0.2,
    });
  } catch (err) {
    const code = err instanceof OpenAIError ? err.message : "openai_call_failed";
    const status = err instanceof OpenAIError ? err.status : 502;
    await sb.from("system_events").insert({
      actor_id: auth.userId,
      entity_type: "interview",
      entity_id: interviewId,
      event_type: "report.generation_failed",
      payload: { severity: "error", reason: code },
    });
    return errorResponse(code, status);
  }

  const reportRow = {
    submission_id: interview.submission_id,
    interview_id: interview.id,
    student_id: interview.student_id,
    assignment_id: interview.assignment_id,
    overall_level: report.overall_level,
    summary: report.summary,
    rubric_result: {
      ...report.rubric,
      overall_score: report.overall_score,
      skipped_questions: skipped,
      replaced_questions: replaced,
    },
    gaps: report.gaps,
    evidence: report.evidence,
    recommendations: [
      ...report.strengths.map((s) => ({ kind: "strength", text: s })),
      ...report.weaknesses.map((w) => ({ kind: "weakness", text: w })),
      ...report.recommendations.map((r) => ({ kind: "recommendation", text: r })),
    ],
    pdf_path: null,
    status: "ready" as const,
  };

  const { data: existing } = await sb.from("reports").select("id").eq("submission_id", interview.submission_id).maybeSingle();

  let reportId = existing?.id;
  if (reportId) {
    const { error } = await sb.from("reports").update(reportRow).eq("id", reportId);
    if (error) return errorResponse("report_update_failed", 500);
  } else {
    const { data: created, error } = await sb.from("reports").insert(reportRow).select("id").single();
    if (error || !created) return errorResponse("report_create_failed", 500);
    reportId = created.id;
  }

  await sb.from("submissions").update({ status: "report_ready" }).eq("id", interview.submission_id);

  await sb.from("system_events").insert({
    actor_id: auth.userId,
    entity_type: "report",
    entity_id: reportId,
    event_type: "report.generated",
    payload: {
      overall_score: report.overall_score,
      overall_level: report.overall_level,
      skipped_questions: skipped,
      replaced_questions: replaced,
    },
  });

  await sb.from("ai_usage_logs").insert({
    user_id: auth.userId,
    entity_type: "report",
    entity_id: reportId,
    provider: "openai",
    model: DEFAULT_MODELS.score,
    operation: "generate_report",
    estimated_cost_usd: 0,
  });

  return jsonResponse({ ok: true, reportId, report });
});

interface MessageRow {
  speaker: string;
  message_type: string;
  content: string | null;
  plan_question_id: string | null;
}
interface PlanQ { id?: string; topic?: string; question?: string; }
interface ScoringAnalysis { summary?: string | null; main_argument?: string | null; key_concepts?: unknown; interview_targets?: unknown; weak_points?: unknown; }

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/** Pull the structured skip / swap events the interview room records. */
function collectQuestionEvents(rows: MessageRow[]): { skipped: number[]; replaced: number[] } {
  const skipped = new Set<number>();
  const replaced = new Set<number>();
  for (const row of rows) {
    if (row.speaker !== "system") continue;
    const m = /^(skipped|replaced)_question:(\d{1,2})$/.exec((row.content ?? "").trim());
    if (!m) continue;
    const n = Number.parseInt(m[2], 10);
    if (!Number.isFinite(n)) continue;
    (m[1] === "skipped" ? skipped : replaced).add(n);
  }
  return {
    skipped: [...skipped].sort((a, b) => a - b),
    replaced: [...replaced].sort((a, b) => a - b),
  };
}

function buildTranscript(rows: MessageRow[], plan: { questions?: PlanQ[] } | null): string {
  const planLookup = new Map<string, { index: number; topic: string }>();
  (plan?.questions ?? []).forEach((q, i) => {
    if (q?.id) planLookup.set(q.id, { index: i, topic: q.topic ?? "" });
  });

  // Group by plan_question_id (preserving insertion order). Messages with no
  // plan_question_id (greetings, asides) bucket into "_unbound".
  const groups = new Map<string, { header: string; lines: string[]; sortIndex: number }>();
  let unboundCounter = 0;

  for (const row of rows) {
    const text = (row.content ?? "").trim();
    if (!text) continue;
    const key = row.plan_question_id ?? "_unbound";
    if (!groups.has(key)) {
      if (key === "_unbound") {
        groups.set(key, { header: "Free-form / greeting", lines: [], sortIndex: -1 });
      } else {
        const meta = planLookup.get(key);
        if (meta) {
          groups.set(key, { header: `Q${meta.index + 1} [${meta.topic}]`, lines: [], sortIndex: meta.index });
        } else {
          unboundCounter += 1;
          groups.set(key, { header: `Q? (id=${key})`, lines: [], sortIndex: 1000 + unboundCounter });
        }
      }
    }
    const g = groups.get(key)!;
    const speakerLabel = row.speaker === "ai_host" ? "host" : row.speaker === "student" ? "student" : row.speaker;
    g.lines.push(`${speakerLabel}: ${text}`);
  }

  const ordered = [...groups.values()].sort((a, b) => a.sortIndex - b.sortIndex);
  return ordered.map((g) => `--- ${g.header}\n${g.lines.join("\n")}`).join("\n\n");
}

function buildScoringMessages({ language, assignmentTitle, analysis, plan, transcript, skipped, replaced }: {
  language: "he" | "en";
  assignmentTitle: string;
  analysis: ScoringAnalysis | null;
  plan: { questions?: PlanQ[] } | null;
  transcript: string;
  skipped: number[];
  replaced: number[];
}): ResponsesMessage[] {
  const isHebrew = language === "he";
  const langDirective = isHebrew ? "Output every string field in Hebrew." : "Output every string field in English.";
  const totalPlanned = plan?.questions?.length ?? 0;

  const system = [
    "You grade an oral interview a student gave about their own submitted assignment.",
    "You return strict JSON matching the provided schema. Never include text outside the JSON.",
    langDirective,
    "Grading rubric (each 0-5):",
    "  - conceptual: depth of grasp of the document's concepts and definitions.",
    "  - reasoning: argument quality, ability to handle counter-positions.",
    "  - communication: clarity, structure, lack of filler.",
    "  - evidence: ability to ground claims in real cases / sources / data from the document.",
    "Map overall_score to overall_level: 0-49 low, 50-69 medium, 70-84 medium_high, 85-100 high.",
    "Strengths/weaknesses/recommendations are concrete (no platitudes), refer to specific moments in the transcript when possible.",
    "The transcript is grouped by planned question. Use the per-question groupings to comment on specific answers.",
    "Lines that start with `system:` are events recorded by the interview software, not speech:",
    "  - `skipped_question:N` means the student chose to skip planned question N without answering it. Treat that question as unanswered: it earns no credit, so lower overall_score and the rubric scores in proportion to the share of the plan it represents (one skipped question out of five costs roughly a fifth of the available credit), list the skip explicitly under weaknesses, and never infer understanding of that question's topic from elsewhere.",
    "  - `replaced_question:N` means the student asked once for a different question on the same material. This is allowed and carries no penalty; grade the replacement answer normally.",
    "If the transcript is essentially empty (e.g., no student answers), give the lowest scores and explain the lack of evidence.",
  ].join("\n");

  const sections: string[] = [];
  if (assignmentTitle) sections.push(`Assignment title: "${assignmentTitle}".`);
  if (analysis?.summary) sections.push(`Document summary: ${analysis.summary}`);
  if (analysis?.main_argument) sections.push(`Main argument: ${analysis.main_argument}`);
  const concepts = asStringList(analysis?.key_concepts);
  if (concepts.length) sections.push(`Key concepts: ${concepts.slice(0, 8).join("; ")}`);
  const targets = asStringList(analysis?.interview_targets);
  if (targets.length) sections.push(`Interview targets: ${targets.slice(0, 8).join("; ")}`);
  const weak = asStringList(analysis?.weak_points);
  if (weak.length) sections.push(`Known weaknesses in submission: ${weak.slice(0, 6).join("; ")}`);

  const planText = (plan?.questions ?? [])
    .map((q, i) => `  ${i + 1}. [${q.topic ?? ""}] ${q.question ?? ""}`)
    .join("\n");
  if (planText) sections.push(`Planned questions:\n${planText}`);

  if (skipped.length) {
    sections.push(
      `Skipped planned questions (no credit): ${skipped.length} of ${totalPlanned || "?"} — ${skipped.map((n) => `Q${n}`).join(", ")}.`,
    );
  }
  if (replaced.length) {
    sections.push(`Swapped questions (no penalty): ${replaced.map((n) => `Q${n}`).join(", ")}.`);
  }

  sections.push(
    transcript.length
      ? `Interview transcript (grouped by planned question):\n${transcript}`
      : "Interview transcript: (no messages were captured)",
  );

  return [
    { role: "system", content: [{ type: "input_text", text: system }] },
    { role: "user", content: [{ type: "input_text", text: sections.join("\n\n") }] },
  ];
}
