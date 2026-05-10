import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

const SPEAKERS = new Set(["ai_host", "student", "system"]);
const TYPES = new Set(["question", "answer", "followup", "system", "summary"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  if (!body) return errorResponse("invalid_json", 400);

  const { interviewId, speaker, messageType, content, audioPath, planQuestionId } =
    body;
  if (typeof interviewId !== "string") return errorResponse("invalid_interview_id");
  if (!SPEAKERS.has(speaker)) return errorResponse("invalid_speaker");
  if (!TYPES.has(messageType)) return errorResponse("invalid_message_type");
  if (content !== undefined && typeof content !== "string")
    return errorResponse("invalid_content");
  if (
    planQuestionId !== undefined &&
    planQuestionId !== null &&
    typeof planQuestionId !== "string"
  )
    return errorResponse("invalid_plan_question_id");

  const sb = serviceClient();
  const { data: interview } = await sb
    .from("interviews")
    .select("student_id")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const { data, error } = await sb
    .from("interview_messages")
    .insert({
      interview_id: interviewId,
      speaker,
      message_type: messageType,
      content: content ?? null,
      audio_path: audioPath ?? null,
      plan_question_id:
        typeof planQuestionId === "string" && planQuestionId.length
          ? planQuestionId
          : null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return errorResponse("insert_failed", 500);

  return jsonResponse({ ok: true, messageId: data.id });
});
