/**
 * Prompts and strict JSON schemas for the two model calls of the engine:
 *
 *   evaluation  one call per planned question, returns criterion scores
 *               with evidence (PROMPT_VERSION governs this text);
 *   narrative   one call per interview, explains the COMPUTED scores and is
 *               not allowed to change them.
 *
 * Both are language-aware: instructions are English, free-text findings are
 * written in the interview language, quotes are verbatim.
 */
import { renderRubric, applicableCriteria, KIND_PURPOSE } from "./rubric.ts";
import { conversationLines } from "./transcript.ts";
import type { SelectedPassage } from "./context.ts";
import type {
  FinalScore,
  InterviewBundle,
  Language,
  Narrative,
  QuestionEvaluation,
  QuestionMaterial,
} from "./types.ts";

export const PROMPT_VERSION = "v1";

export interface PromptMessage {
  role: "system" | "user";
  content: Array<{ type: "input_text"; text: string }>;
}

const SCORE_FIELD = { type: "integer", minimum: 0, maximum: 5 } as const;

export const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "answer_status",
    "scores",
    "correct_facts",
    "errors",
    "missing_points",
    "evidence",
    "rationale",
    "confidence",
    "uncertainty_reasons",
  ],
  properties: {
    answer_status: {
      type: "string",
      enum: ["correct", "partially_correct", "vague", "incorrect", "missing", "unassessable"],
    },
    scores: {
      type: "object",
      additionalProperties: false,
      required: ["relevance", "accuracy", "explanation", "consistency", "process", "application"],
      properties: {
        relevance: SCORE_FIELD,
        accuracy: SCORE_FIELD,
        explanation: SCORE_FIELD,
        consistency: SCORE_FIELD,
        process: SCORE_FIELD,
        application: SCORE_FIELD,
      },
    },
    correct_facts: { type: "array", items: { type: "string" } },
    errors: { type: "array", items: { type: "string" } },
    missing_points: { type: "array", items: { type: "string" } },
    evidence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quote", "criterion"],
        properties: {
          quote: { type: "string" },
          criterion: {
            type: "string",
            enum: ["relevance", "accuracy", "explanation", "consistency", "process", "application"],
          },
        },
      },
    },
    rationale: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    uncertainty_reasons: { type: "array", items: { type: "string" } },
  },
} as const;

export const NARRATIVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "weaknesses", "recommendations"],
  properties: {
    summary: { type: "string" },
    strengths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
    weaknesses: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
    recommendations: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" } },
  },
} as const;

export function languageName(language: Language): string {
  return language === "he" ? "Hebrew" : language === "ar" ? "Arabic" : "English";
}

export interface EvaluationPromptArgs {
  bundle: Pick<InterviewBundle, "language" | "assignmentTitle" | "analysis">;
  material: QuestionMaterial;
  passages: SelectedPassage[];
}

export function buildEvaluationMessages(args: EvaluationPromptArgs): PromptMessage[] {
  const { bundle, material, passages } = args;
  const q = material.question;
  const lang = languageName(bundle.language);
  const applicable = applicableCriteria(q.kind);

  const system = [
    "You are an examiner evaluating ONE spoken answer from an oral interview in which a student is asked about an assignment they submitted. Your judgement feeds a fixed rubric; the final grade is computed by software from the criterion scores you return, so score each criterion on its own anchors and nothing else.",
    "Return strict JSON matching the schema. Never include text outside the JSON.",
    `Write correct_facts, errors, missing_points, rationale and uncertainty_reasons in ${lang}. Quotes in evidence are copied VERBATIM from the student's lines (same language, same words), never from the host or the document.`,
    "",
    "RUBRIC (score 0-5 per criterion using exactly these anchors):",
    renderRubric(q.kind),
    "",
    `Applicable criteria for this question: ${applicable.join(", ")}. Return 0 for the others; the software ignores them.`,
    "",
    "RULES",
    "1. Grade only what the student actually SAID in the lines marked `student:` for this question. The document passages and the summary are context for checking claims; they never stand in for the spoken answer. Never attribute to the student anything that appears only in the document.",
    "2. Fluency, length, confidence, polish and professional vocabulary are not evidence of understanding. A short answer with the right ideas scores on content; a long, well-phrased answer with the wrong idea scores low on accuracy and explanation. Terminology without explanation stays at anchor 1 for explanation.",
    "3. Never penalise accent, hesitation, repetition, dialect, speech rate, or obvious transcription errors (a mis-heard word that is clearly the right term in context counts as the right term).",
    "4. The host's later lines are follow-ups. If the student corrects an earlier mistake in a later line, score the final understanding and list the original mistake in errors. If a later line contradicts an earlier one without resolution, lower consistency and say so.",
    "5. Do not penalise the absence of something the question did not ask for. Application is judged only when the question or a follow-up asked for it (it is already marked not applicable otherwise).",
    "6. Every applicable criterion scored 3 or higher must be supported by at least one verbatim evidence quote from the student. If you cannot quote supporting words, lower the score or set confidence to low and explain in uncertainty_reasons. Never invent or paraphrase quotes.",
    "7. answer_status: correct (addresses the question accurately), partially_correct (some right, some wrong or missing), vague (on topic but no checkable content), incorrect (addresses it with a wrong core idea), missing (no relevant content at all), unassessable (the lines are garbled, truncated or clearly not an answer, e.g. a transcription artefact; then score everything 0 and explain).",
    "8. Decide between these cases explicitly: a correct answer, a partially correct one, a vague one, a wrong one, a missing one, and one that cannot be assessed reliably. State the deciding fact in rationale (2-4 sentences).",
    "9. Never speculate about outside help, reading, timing or tools. That is handled elsewhere and must not influence any score.",
  ].join("\n");

  const context: string[] = [];
  if (bundle.assignmentTitle) context.push(`Assignment: "${bundle.assignmentTitle}".`);
  if (bundle.analysis.summary) context.push(`Submission summary: ${bundle.analysis.summary}`);
  if (bundle.analysis.mainArgument) context.push(`Main argument: ${bundle.analysis.mainArgument}`);
  if (passages.length) {
    context.push(
      "Document passages related to this question (context only):\n" +
        passages.map((p, i) => `[passage ${i + 1}] ${p.text}`).join("\n"),
    );
  }
  if (q.anchor) context.push(`Anchor sentence in the document: "${q.anchor}"`);

  const questionBlock = [
    `QUESTION ${q.index + 1} (kind: ${q.kind}; topic: ${q.topic || "n/a"})`,
    `Purpose: ${KIND_PURPOSE[q.kind]}`,
    `Planned wording: ${q.question}`,
    q.keyPoints.length ? `Expected key points: ${q.keyPoints.map((p, i) => `(${i + 1}) ${p}`).join(" ")}` : "",
    material.replaced
      ? "Note: the student asked once for a different question in this slot; the host improvised a replacement on the same material. Judge the answer against the host's actual wording below, not the planned one."
      : "",
    material.discardedTurns > 0
      ? `Note: ${material.discardedTurns} spoken turn(s) for this question were rejected by the transcription guard and are not shown; do not treat the gap as a wrong answer.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const lines = conversationLines(material);
  const conversation = lines.length
    ? lines.map((l) => `${l.role}: ${l.content.slice(0, 4000)}`).join("\n")
    : "(no lines captured for this question)";

  return [
    { role: "system", content: [{ type: "input_text", text: system }] },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: `${context.join("\n\n")}\n\n${questionBlock}\n\nCONVERSATION FOR THIS QUESTION (in order):\n${conversation}`,
        },
      ],
    },
  ];
}

export interface NarrativePromptArgs {
  bundle: Pick<InterviewBundle, "language" | "assignmentTitle" | "plan">;
  final: FinalScore;
  evaluations: QuestionEvaluation[];
}

export function buildNarrativeMessages(args: NarrativePromptArgs): PromptMessage[] {
  const { bundle, final, evaluations } = args;
  const lang = languageName(bundle.language);
  const system = [
    "You write the feedback section of a report about an oral interview in which a student explained their own submitted assignment.",
    `Write every string in ${lang}. Return strict JSON matching the schema; no text outside the JSON.`,
    "The grades below were computed by a fixed rubric and are FINAL. Your job is to explain them to the student and the lecturer: what was demonstrated, what was wrong or missing, and what to do next. Never state, imply or suggest a different grade, never say the grade should be higher or lower, and never mention numbers other than the ones given.",
    "Be concrete: refer to the specific questions and the student's own words quoted below. No platitudes. Strengths and weaknesses must each reflect the evidence; if there is little to praise, say so plainly in one short strength rather than inventing one.",
    "Address the student in the second person. Do not mention timing, pauses, tools, outside help or integrity; that is handled elsewhere.",
    "Never attribute to the student anything that is not in the quoted material.",
  ].join("\n");

  const header = [
    bundle.assignmentTitle ? `Assignment: "${bundle.assignmentTitle}".` : "",
    `Overall score: ${final.overallScore}/100 (level: ${final.overallLevel}).`,
    `Dimensions (0-5): ${Object.entries(final.dimensions)
      .map(([k, v]) => `${k}=${v === null ? "n/a" : v}`)
      .join(", ")}.`,
    final.skippedQuestions.length ? `Skipped questions (no credit): ${final.skippedQuestions.map((n) => `Q${n}`).join(", ")}.` : "",
    final.replacedQuestions.length ? `Replaced questions (no penalty): ${final.replacedQuestions.map((n) => `Q${n}`).join(", ")}.` : "",
    final.excludedQuestions.length ? `Questions excluded from the grade (not assessable): ${final.excludedQuestions.map((n) => `Q${n}`).join(", ")}.` : "",
    final.requiresHumanReview ? `The report is marked for lecturer review (${final.reviewReasons.join(", ")}); say in the summary that a lecturer will look at it.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const perQuestion = evaluations
    .map((e) => {
      const q = bundle.plan.find((p) => p.id === e.questionId);
      const o = e.outcome;
      const quotes = o.verifiedEvidence.filter((v) => v.verified).slice(0, 3).map((v) => `"${v.quote}"`);
      return [
        `Q${e.ordinal} [${e.kind}] ${q?.question ?? ""}`,
        `  status: ${e.coverage === "answered" ? o.status : e.coverage}; score: ${o.questionScore ?? "n/a"}`,
        o.correctFacts.length ? `  correct: ${o.correctFacts.join(" | ")}` : "",
        o.errors.length ? `  errors: ${o.errors.join(" | ")}` : "",
        o.missingPoints.length ? `  missing: ${o.missingPoints.join(" | ")}` : "",
        quotes.length ? `  student said: ${quotes.join(" ; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    { role: "system", content: [{ type: "input_text", text: system }] },
    { role: "user", content: [{ type: "input_text", text: `${header}\n\nPER-QUESTION FINDINGS:\n${perQuestion}` }] },
  ];
}

/** Used when no model narrative can be produced (nothing assessable, or the call failed). */
export function fallbackNarrative(language: Language, final: FinalScore): Narrative {
  const none = final.assessedQuestions === 0 || final.confidence === "none";
  if (language === "he") {
    return {
      summary: none
        ? "לא נקלטו תשובות שניתן להעריך בראיון הזה, ולכן לא חושב ציון אוטומטי. המרצה יעבור על הראיון."
        : `הציון חושב לפי הרובריקה הקבועה מתוך ${final.assessedQuestions} מתוך ${final.plannedQuestions} שאלות. פירוט מילולי לא זמין כרגע.`,
      strengths: none ? ["אין מספיק נתונים."] : ["ראי את פירוט השאלות בדוח."],
      weaknesses: none ? ["לא נקלטו תשובות."] : ["ראי את הנקודות החסרות בכל שאלה."],
      recommendations: ["מומלץ לעבור שוב על העבודה ולהסביר כל רעיון מרכזי במילים שלך.", "אם הייתה תקלה טכנית, פני למרצה."],
    };
  }
  if (language === "ar") {
    return {
      summary: none
        ? "لم تُسجَّل إجابات يمكن تقييمها في هذه المقابلة، لذلك لم تُحسب درجة تلقائية. سيراجع المحاضر المقابلة."
        : `حُسبت الدرجة وفق المعايير الثابتة من ${final.assessedQuestions} من أصل ${final.plannedQuestions} أسئلة. التفصيل النصي غير متاح حالياً.`,
      strengths: none ? ["لا توجد بيانات كافية."] : ["انظر تفاصيل الأسئلة في التقرير."],
      weaknesses: none ? ["لم تُسجَّل إجابات."] : ["انظر النقاط الناقصة في كل سؤال."],
      recommendations: ["راجع العمل واشرح كل فكرة رئيسية بكلماتك.", "إذا حدث خلل تقني، تواصل مع المحاضر."],
    };
  }
  return {
    summary: none
      ? "No assessable answers were captured in this interview, so no automatic grade was computed. A lecturer will review it."
      : `The grade was computed from the fixed rubric over ${final.assessedQuestions} of ${final.plannedQuestions} questions. Written feedback is not available right now.`,
    strengths: none ? ["Not enough data."] : ["See the per-question details in the report."],
    weaknesses: none ? ["No answers were captured."] : ["See the missing points under each question."],
    recommendations: ["Go over the work again and explain each central idea in your own words.", "If there was a technical problem, contact your lecturer."],
  };
}
