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

// The planner writes a POOL of candidate questions; the interview uses a
// seeded selection of QUESTION_COUNT of them (see selectQuestions). The pool
// is stored under plan.pool and is never sent to the browser.
const POOL_SIZE = 12;
const QUESTION_COUNT = 5;
const CHUNK_CHARS = 1500;

type QuestionKind =
  | "opening"
  | "concept"
  | "evidence"
  | "process"
  | "counter"
  | "application"
  | "reflection"
  | "detail";

const QUESTION_KINDS: QuestionKind[] = [
  "opening",
  "concept",
  "evidence",
  "process",
  "counter",
  "application",
  "reflection",
  "detail",
];

interface PlannedQuestion {
  id: string;
  topic: string;
  kind: QuestionKind;
  question: string;
  anchor: string;
  key_points: string[];
  follow_ups: string[];
}

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
    questions: PlannedQuestion[];
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
          minItems: POOL_SIZE,
          maxItems: POOL_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "topic", "kind", "question", "anchor", "key_points", "follow_ups"],
            properties: {
              id: { type: "string" },
              topic: { type: "string", description: "2-4 word topic label." },
              kind: { type: "string", enum: QUESTION_KINDS },
              question: { type: "string" },
              anchor: {
                type: "string",
                description:
                  "A short verbatim excerpt (8-25 words) of the document this question is about, quoted exactly; empty string for the opening question.",
              },
              key_points: {
                type: "array",
                items: { type: "string" },
                description: "2-3 things a good answer would mention.",
              },
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
    .select("id, title, language, instructions, status")
    .eq("id", submission.assignment_id)
    .maybeSingle();
  if (assignment && assignment.status !== "published") {
    return errorResponse("assignment_closed", 403);
  }

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

  const pool = (result?.interview_plan?.questions ?? []).filter(
    (q) => q && typeof q.question === "string" && q.question.trim().length > 0,
  );
  if (pool.length < QUESTION_COUNT) {
    await markFailed(sb, submissionId, "openai_bad_question_count", auth.userId);
    return errorResponse("openai_bad_question_count", 502);
  }

  // The stored document text. For TXT / DOCX this is the file's own text
  // (exact, used by the overlap check); for PDFs the only text we have is
  // the model's markdown rendering, and the overlap check knows it is
  // approximate.
  const llmMarkdown =
    result.parse?.markdown && result.parse.markdown.length > 0
      ? result.parse.markdown
      : "";
  const documentText =
    loaded.kind === "text" && loaded.text.trim().length > 0
      ? loaded.text
      : llmMarkdown || "(PDF parsed by OpenAI; see analysis row.)";
  const documentSource = loaded.kind === "text" ? "raw_text" : "llm_markdown";

  await sb.from("document_parses").insert({
    submission_id: submissionId,
    provider: "manual_text",
    markdown: documentText,
    page_count: null,
    metadata: {
      mime_type: loaded.mimeType,
      filename: loaded.filename,
      size_bytes: loaded.sizeBytes,
      kind: loaded.kind,
      source: documentSource,
      llm_markdown: loaded.kind === "text" ? llmMarkdown.slice(0, 4000) : undefined,
      truncated: loaded.kind === "text" ? loaded.truncated : false,
    },
  });
  await sb.from("submissions").update({ status: "parsed" }).eq("id", submissionId);

  const chunks = chunkText(documentText, CHUNK_CHARS);
  await sb.from("document_chunks").delete().eq("submission_id", submissionId);
  await sb.from("document_chunks").insert(
    chunks.map((content, index) => ({
      submission_id: submissionId,
      chunk_index: index,
      content,
      metadata: { source: documentSource },
    })),
  );

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

  const normalizedPool = pool.map((q, idx) => ({
    id: q.id && /^[a-z0-9_-]{1,32}$/i.test(q.id) ? q.id : `q${idx + 1}`,
    topic: (q.topic ?? "").trim(),
    kind: QUESTION_KINDS.includes(q.kind) ? q.kind : "concept",
    question: q.question.trim(),
    anchor: typeof q.anchor === "string" ? q.anchor.trim().slice(0, 300) : "",
    key_points: Array.isArray(q.key_points)
      ? q.key_points.filter((p) => typeof p === "string" && p.trim()).slice(0, 4)
      : [],
    follow_ups: Array.isArray(q.follow_ups)
      ? q.follow_ups.filter((f) => typeof f === "string" && f.trim()).slice(0, 3)
      : [],
    recommended_seconds: 75,
  }));
  // Ids must be unique inside the pool.
  const seenIds = new Set<string>();
  for (const q of normalizedPool) {
    let id = q.id;
    let n = 1;
    while (seenIds.has(id)) id = `${q.id}_${n++}`;
    q.id = id;
    seenIds.add(id);
  }

  const seed = hashString(interviewId);
  const selected = selectQuestions(normalizedPool, seed, QUESTION_COUNT);

  const { error: planErr } = await sb
    .from("interview_plans")
    .upsert(
      {
        interview_id: interviewId,
        model: DEFAULT_MODELS.plan,
        plan: {
          questions: selected,
          pool: normalizedPool,
          selection: {
            strategy: "kind_mix_v1",
            seed,
            picked_ids: selected.map((q) => q.id),
            pool_size: normalizedPool.length,
          },
        },
      },
      { onConflict: "interview_id" },
    );
  if (planErr) {
    await markFailed(sb, submissionId, "plan_write_failed", auth.userId);
    return errorResponse("plan_write_failed", 500);
  }

  const { error: readyErr } = await sb
    .from("submissions")
    .update({ status: "interview_ready" })
    .eq("id", submissionId);
  if (readyErr) {
    await markFailed(sb, submissionId, "submission_update_failed", auth.userId);
    return errorResponse("submission_update_failed", 500);
  }
  await sb.from("system_events").insert({
    actor_id: auth.userId,
    entity_type: "submission",
    entity_id: submissionId,
    event_type: "submission.interview_ready",
    payload: {
      interview_id: interviewId,
      question_count: selected.length,
      pool_size: normalizedPool.length,
      document_source: documentSource,
    },
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

// ---------------------------------------------------------------------------
// Question selection: a seeded mix of kinds so every student gets the same
// STRUCTURE (one opening, then a spread of process / detail / counter /
// concept / evidence / application / reflection questions) but not the same
// questions, and the same interview always resolves to the same selection
// (the seed is the interview id, so a reload never reshuffles).
// ---------------------------------------------------------------------------

type NormalizedQuestion = {
  id: string;
  topic: string;
  kind: QuestionKind;
  question: string;
  anchor: string;
  key_points: string[];
  follow_ups: string[];
  recommended_seconds: number;
};

const KIND_PRIORITY: QuestionKind[] = [
  "process",
  "detail",
  "counter",
  "concept",
  "evidence",
  "application",
  "reflection",
];
const FLOW_ORDER: QuestionKind[] = [
  "opening",
  "concept",
  "detail",
  "evidence",
  "process",
  "counter",
  "application",
  "reflection",
];

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], rand: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function selectQuestions(
  pool: NormalizedQuestion[],
  seed: number,
  count: number,
): NormalizedQuestion[] {
  const rand = mulberry32(seed);
  const picked: NormalizedQuestion[] = [];
  const used = new Set<string>();

  const opening = pool.find((q) => q.kind === "opening") ?? pool[0];
  if (opening) {
    picked.push(opening);
    used.add(opening.id);
  }

  // Walk the kinds in a seeded order; one question per kind per pass.
  const kinds = seededShuffle(KIND_PRIORITY, rand);
  for (let pass = 0; pass < 3 && picked.length < count; pass++) {
    for (const kind of kinds) {
      if (picked.length >= count) break;
      const candidates = pool.filter((q) => q.kind === kind && !used.has(q.id));
      if (candidates.length === 0) continue;
      const choice = candidates[Math.floor(rand() * candidates.length)];
      picked.push(choice);
      used.add(choice.id);
    }
  }
  // Still short (pool with few kinds): fill with anything left.
  for (const q of seededShuffle(pool, rand)) {
    if (picked.length >= count) break;
    if (used.has(q.id)) continue;
    picked.push(q);
    used.add(q.id);
  }

  const order = (k: QuestionKind) => FLOW_ORDER.indexOf(k);
  const [first, ...rest] = picked;
  rest.sort((a, b) => order(a.kind) - order(b.kind));
  return [first, ...rest].slice(0, count);
}

function chunkText(text: string, size: number): string[] {
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    const para = p.trim();
    if (!para) continue;
    if (current.length + para.length + 2 > size && current) {
      chunks.push(current);
      current = "";
    }
    if (para.length > size) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < para.length; i += size) chunks.push(para.slice(i, i + size));
      continue;
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, size)];
}

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
    ? "Output every string field in Hebrew (except `anchor`, which is always quoted verbatim from the document in its own language)."
    : "Output every string field in English (except `anchor`, which is always quoted verbatim from the document in its own language).";

  const system = [
    "You analyze a student's submitted assignment and prepare an interviewer brief for a live oral interview about it.",
    "You return strict JSON matching the provided schema. Never include text outside the JSON.",
    langDirective,
    `Write a POOL of exactly ${POOL_SIZE} candidate questions. The interview will use a seeded selection of ${QUESTION_COUNT} of them, so each one must stand on its own.`,
    "Questions are for an oral exam: short (1-2 sentences), specific, grounded in THIS document, written in second person. Each question has a `kind`; write this mix:",
    "  1 opening: gets the student talking about what the work is about and why they chose it.",
    "  2 concept: explain a concept, definition or framework the work relies on, in their own words.",
    "  2 evidence: a specific claim, example, source or data point the document uses, and why it supports the argument.",
    "  2 process: how the work was actually done: choices made, data gathered, what was hard, what was left out, why X and not Y.",
    "  2 counter: a counter-position or weakness; can they defend or qualify their claim.",
    "  1 application: apply the idea to a new situation the document does not discuss.",
    "  1 reflection: what they would change, extend or do differently now.",
    "  1 detail: a specific number, figure, table, sentence or section of the document and what it means.",
    "`anchor` is a short verbatim excerpt (8-25 words) copied exactly from the document that the question is about (empty for the opening). `key_points` lists 2-3 things a good answer would mention. Each `follow_ups` entry is a one-sentence press if the answer is vague.",
    "Questions about process, choices and alternatives cannot be answered by reading the document aloud; prefer them where the document gives you material.",
    "The `parse.markdown` field is a faithful structural rendering of the source — quote real headings, sentences, numbers — never a summary.",
  ].join("\n");

  const userPreamble = [
    assignmentTitle ? `Assignment title: "${assignmentTitle}".` : "",
    assignmentInstructions
      ? `Assignment instructions: ${assignmentInstructions}`
      : "",
    `Required output language: ${isHebrew ? "Hebrew (he)" : "English (en)"}.`,
    `Required pool size: ${POOL_SIZE} questions.`,
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
