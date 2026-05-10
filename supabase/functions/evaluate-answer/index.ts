import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { evaluateAnswerMock } from "../_shared/providers.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  const { interviewId, messageId, questionId } = body ?? {};
  if (typeof interviewId !== "string") return errorResponse("invalid_interview_id");

  const sb = serviceClient();
  const { data: interview } = await sb
    .from("interviews")
    .select("student_id")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const evalResult = await evaluateAnswerMock();
  const { data, error } = await sb
    .from("answer_evaluations")
    .insert({
      interview_id: interviewId,
      message_id: messageId ?? null,
      question_id: questionId ?? null,
      model: evalResult.model,
      understanding_level: evalResult.understandingLevel,
      clarity_score: evalResult.clarityScore,
      conceptual_score: evalResult.conceptualScore,
      reasoning_score: evalResult.reasoningScore,
      consistency_score: evalResult.consistencyScore,
      evidence: evalResult.evidence,
      gaps: evalResult.gaps,
      recommended_followup: evalResult.recommendedFollowup,
    })
    .select("id")
    .single();
  if (error || !data) return errorResponse("insert_failed", 500);

  await sb.from("ai_usage_logs").insert({
    user_id: auth.userId,
    entity_type: "interview",
    entity_id: interviewId,
    provider: "mock",
    model: evalResult.model,
    operation: "evaluate_answer",
    estimated_cost_usd: 0,
  });

  return jsonResponse({ ok: true, evaluationId: data.id, evaluation: evalResult });
});
