import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import {
  callResponses,
  DEFAULT_MODELS,
  OpenAIError,
  type ResponsesContentPart,
  type ResponsesMessage,
} from "../_shared/openai.ts";
import {
  loadSubmissionDocument,
  DocumentLoadError,
  type LoadedDocument,
} from "../_shared/document-loader.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

const QUESTION_COUNT = 5;

interface PreparationResult {
  parse: { markdown: string };
  analysis: {
    summary: string;
    main_argument: string;
    key_concepts: string[];
    claims: string[];
    methodology: string;
    weak_points: string[];
    complex_sections: string[];
    interview_targets: string[];
  };
  interview_plan: {
    questions: {
      id: string;
      topic: string;
      question: string;
      follow_ups: string[];
    }[];
  };
}

const PREPARATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parse", "analysis", "interview_plan"],
  properties: {
    parse: {
      type: "object",
      additionalProperties: false,
      required: ["markdown"],
      properties: {
        markdown: {
          type: "string",
          description:
            "A faithful markdown rendering of the document's structure and key passages. 1500-4000 characters.",
        },
      },
    },
    analysis: {
      type: "object",
      additionalProperties: false,
      required: [
        "summary",
        "main_argument",
        "key_concepts",
        "claims",
        "methodology",
        "weak_points",
        "complex_sections",
        "interview_targets",
      ],
      properties: {
        summary: {
          type: "string",
          description: "3-5 sentence neutral summary of the submission.",
        },
        main_argument: {
          type: "string",
          description: "The single primary thesis the submission makes.",
        },
        key_concepts: {
          type: "array",
          items: { type: "string" },
          description: "4-8 named concepts, frameworks, or terms the work relies on.",
        },
        claims: {
          type: "array",
          items: { type: "string" },
          description:
            "3-7 concrete claims/assertions the student makes, paraphrased.",
        },
        methodology: {
          type: "string",
          description:
            "Short description of how the student supports their argument (sources, cases, data). Empty string if no clear methodology.",
        },
        weak_points: {
          type: "array",
          items: { type: "string" },
          description:
            "3-6 places the argument is thin, unsupported, or open to challenge.",
        },
        complex_sections: {
          type: "array",
          items: { type: "string" },
          description:
            "2-5 passages or topics that are dense / likely to be probed.",
        },
        interview_targets: {
          type: "array",
          items: { type: "string" },
          description:
            "4-8 angles the interviewer should probe to test understanding.",
        },
      },
    },
    interview_plan: {
      type: "object",
      additionalProperties: false,
      required: ["questions"],
      properties: {
        questions: {
          type: "array",
          minItems: QUESTION_COUNT,
          maxItems: QUESTION_COUNT,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "topic", "question", "follow_ups"],
            properties: {
              id: { type: "string" },
              topic: { type: "string" },
              question: { type: "string" },
              follow_ups: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  const submissionId = body?.submissionId;
  if (typeof submissionId !== "string" || !/^[0-9a-f-]{36}$/i.test(submissionId)) {
    return errorResponse("invalid_submission_id", 400);
  }

  const sb = serviceClient();

  const { data: submission, error: subErr } = await sb
    .from("submissions")
    .select(
      "id, assignment_id, student_id, status, file_path, original_filename, mime_type, file_size_bytes",
    )
    .eq("id", submissionId)
    .maybeSingle();

  if (subErr || !submission) return errorResponse("submission_not_found", 404);
  if (submission.student_id !== auth.userId)
    return errorResponse("forbidden", 403);

  const { data: assignment } = await sb
    .from("assignments")
    .select("id, title, language, instructions")
    .eq("id", submission.assignment_id)
    .maybeSingle();

  // Idempotency: if we've already produced an interview_ready submission with
  // an interview row + plan, just return it. The processing UI may invoke
  // this function more than once.
  if (submission.status === "interview_ready") {
    const { data: existing } = await sb
      .from("interviews")
      .select("id")
      .eq("submission_id", submissionId)
      .maybeSingle();
    if (existing?.id) {
      return jsonResponse({
        ok: true,
        submissionId,
        interviewId: existing.id,
        skipped: true,
      });
    }
  }

  await sb.from("submissions").update({ status: "parsing" }).eq("id", submissionId);

  let loaded: LoadedDocument;
  try {
    loaded = await loadSubmissionDocument(sb, {
      filePath: submission.file_path,
      originalFilename: submission.original_filename,
      mimeType: submission.mime_type,
      fileSizeBytes:
        submission.file_size_bytes !== null && submission.file_size_bytes !== undefined
          ? Number(submission.file_size_bytes)
          : null,
    });
  } catch (err) {
    const code =
      err instanceof DocumentLoadError ? err.message : "document_load_failed";
    await markFailed(sb, submissionId, code, auth.userId);
    return errorResponse(code, err instanceof DocumentLoadError ? err.status : 500);
  }

  const language = (assignment?.language === "en" ? "en" : "he") as "he" | "en";
  const messages = buildPreparationMessages({
    language,
    assignmentTitle: assignment?.title ?? "",
    assignmentInstructions: assignment?.instructions ?? "",
    loaded,
  });

  let result: PreparationResult;
  try {
    result = await callResponses<PreparationResult>({
      model: DEFAULT_MODELS.plan,
      input: messages,
      schemaName: "submission_preparation",
      schema: PREPARATION_SCHEMA as unknown as Record<string, unknown>,
      operation: "prepare_submission",
    });
  } catch (err) {
    const code =
      err instanceof OpenAIError ? err.message : "openai_call_failed";
    const status = err instanceof OpenAIError ? err.status : 502;
    await markFailed(sb, submissionId, code, auth.userId);
    return errorResponse(code, status);
  }

  if (
    !result?.interview_plan?.questions ||
    result.interview_plan.questions.length !== QUESTION_COUNT
  ) {
    await markFailed(sb, submissionId, "openai_bad_question_count", auth.userId);
    return errorResponse("openai_bad_question_count", 502);
  }

  const parseMarkdown =
    result.parse?.markdown && result.parse.markdown.length > 0
      ? result.parse.markdown
      : loaded.kind === "text"
        ? loaded.text.slice(0, 4000)
        : "(PDF parsed by OpenAI; see analysis row.)";

  await sb.from("document_parses").insert({
    submission_id: submissionId,
    provider: "manual_text",
    markdown: parseMarkdown,
    page_count: null,
    metadata: {
      mime_type: loaded.mimeType,
      filename: loaded.filename,
      size_bytes: loaded.sizeBytes,
      kind: loaded.kind,
      truncated: loaded.kind === "text" ? loaded.truncated : false,
    },
  });
  await sb.from("submissions").update({ status: "parsed" }).eq("id", submissionId);

  await sb.from("document_chunks").insert({
    submission_id: submissionId,
    chunk_index: 0,
    content: parseMarkdown,
    metadata: { source: "openai_responses" },
  });

  await sb.from("submissions").update({ status: "analyzing" }).eq("id", submissionId);

  const analysis = result.analysis;
  await sb.from("document_analyses").insert({
    submission_id: submissionId,
    model: DEFAULT_MODELS.analyze,
    summary: analysis.summary,
    main_argument: analysis.main_argument,
    key_concepts: analysis.key_concepts,
    claims: analysis.claims,
    methodology: analysis.methodology
      ? { description: analysis.methodology }
      : null,
    weak_points: analysis.weak_points,
    complex_sections: analysis.complex_sections,
    interview_targets: analysis.interview_targets,
    raw_output: result as unknown as Record<string, unknown>,
  });
  await sb
    .from("submissions")
    .update({ status: "analysis_ready" })
    .eq("id", submissionId);

  const { data: existingInterview } = await sb
    .from("interviews")
    .select("id")
    .eq("submission_id", submissionId)
    .maybeSingle();

  let interviewId = existingInterview?.id;
  if (!interviewId) {
    const { data: created, error: intErr } = await sb
      .from("interviews")
      .insert({
        submission_id: submissionId,
        assignment_id: submission.assignment_id,
        student_id: submission.student_id,
        status: "ready",
        language,
      })
      .select("id")
      .single();
    if (intErr || !created) {
      await markFailed(sb, submissionId, "interview_create_failed", auth.userId);
      return errorResponse("interview_create_failed", 500);
    }
    interviewId = created.id;
  } else {
    await sb
      .from("interviews")
      .update({ status: "ready", language })
      .eq("id", interviewId);
  }

  const planQuestions = result.interview_plan.questions.map((q, idx) => ({
    id: q.id || `q${idx + 1}`,
    topic: q.topic,
    question: q.question,
    recommended_seconds: 75,
    follow_ups: q.follow_ups ?? [],
  }));

  await sb
    .from("interview_plans")
    .upsert(
      {
        interview_id: interviewId,
        model: DEFAULT_MODELS.plan,
        plan: { questions: planQuestions },
      },
      { onConflict: "interview_id" },
    );

  await sb.from("submissions").update({ status: "interview_ready" }).eq("id", submissionId);
  await sb.from("system_events").insert({
    actor_id: auth.userId,
    entity_type: "submission",
    entity_id: submissionId,
    event_type: "submission.interview_ready",
    payload: { interview_id: interviewId, question_count: planQuestions.length },
  });
  await sb.from("ai_usage_logs").insert([
    {
      user_id: auth.userId,
      entity_type: "submission",
      entity_id: submissionId,
      provider: "openai",
      model: DEFAULT_MODELS.parse,
      operation: "parse_document",
      estimated_cost_usd: 0,
    },
    {
      user_id: auth.userId,
      entity_type: "submission",
      entity_id: submissionId,
      provider: "openai",
      model: DEFAULT_MODELS.analyze,
      operation: "analyze_assignment",
      estimated_cost_usd: 0,
    },
    {
      user_id: auth.userId,
      entity_type: "interview",
      entity_id: interviewId,
      provider: "openai",
      model: DEFAULT_MODELS.plan,
      operation: "generate_interview_plan",
      estimated_cost_usd: 0,
    },
  ]);

  return jsonResponse({ ok: true, submissionId, interviewId });
});

function buildPreparationMessages({
  language,
  assignmentTitle,
  assignmentInstructions,
  loaded,
}: {
  language: "he" | "en";
  assignmentTitle: string;
  assignmentInstructions: string;
  loaded: LoadedDocument;
}): ResponsesMessage[] {
  const isHebrew = language === "he";
  const langDirective = isHebrew
    ? "Output every string field in Hebrew."
    : "Output every string field in English.";

  const system = [
    "You analyze a student's submitted assignment and prepare an interviewer brief.",
    "You return strict JSON matching the provided schema. Never include text outside the JSON.",
    langDirective,
    "Questions are for an oral exam: short (1-2 sentences), specific, grounded in the document, written in second person, and ordered:",
    "  1 opening that gets the student talking;",
    "  3 conceptual / definitional;",
    "  3 evidence / case-study probes that reference specific claims in the document;",
    "  2 counter-position / steelman questions;",
    "  1 synthesis / 'what would you change' closer.",
    "Each `follow_ups` entry is a one-sentence press if the student's answer is vague.",
    "The `parse.markdown` field is a faithful structural rendering of the source — quote real headings, sentences, numbers — never a summary.",
  ].join("\n");

  const userPreamble = [
    assignmentTitle ? `Assignment title: "${assignmentTitle}".` : "",
    assignmentInstructions
      ? `Assignment instructions: ${assignmentInstructions}`
      : "",
    `Required output language: ${isHebrew ? "Hebrew (he)" : "English (en)"}.`,
    `Required question count: ${QUESTION_COUNT}.`,
  ]
    .filter(Boolean)
    .join("\n");

  const userParts: ResponsesContentPart[] = [
    { type: "input_text", text: userPreamble },
  ];

  if (loaded.kind === "file") {
    userParts.push({ type: "input_file", file_id: loaded.fileId });
    userParts.push({
      type: "input_text",
      text: "The submission is the attached PDF. Use it as the single source of truth.",
    });
  } else {
    const truncationNote = loaded.truncated
      ? "\n[Document was truncated to fit the context window; analyze the visible portion.]"
      : "";
    userParts.push({
      type: "input_text",
      text: `Submission text follows between <<<DOC>>> markers.${truncationNote}\n<<<DOC>>>\n${loaded.text}\n<<<DOC>>>`,
    });
  }

  return [
    { role: "system", content: [{ type: "input_text", text: system }] },
    { role: "user", content: userParts },
  ];
}

interface SbServiceLite {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): Promise<unknown>;
    };
    insert(values: Record<string, unknown>): Promise<unknown>;
  };
}

async function markFailed(
  sb: SbServiceLite,
  submissionId: string,
  reason: string,
  userId: string,
): Promise<void> {
  await sb
    .from("submissions")
    .update({ status: "failed", failure_reason: reason })
    .eq("id", submissionId);
  await sb.from("system_events").insert({
    actor_id: userId,
    entity_type: "submission",
    entity_id: submissionId,
    event_type: "submission.preparation_failed",
    payload: { severity: "error", reason },
  });
}
