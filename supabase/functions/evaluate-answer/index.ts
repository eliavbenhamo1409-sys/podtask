// Edge Function: evaluate-answer
//
// Since grading engine v2 the per-question evaluation is produced by the
// grading pipeline (`grading-worker`, `_shared/grading/*`): one versioned run
// per interview, evidence-verified, deterministic scoring. This function is
// kept for its callers and now only (re)queues that pipeline:
//
//   - the student (owner) may call it only while no grading run has
//     succeeded yet (recovery after a lost job); it never forces a re-grade;
//   - a lecturer of the course (or an admin) may force a NEW run, which is
//     stored next to the previous ones (never overwrites history).
//
// Knowledge only, never integrity: the pipeline is told nothing about
// telemetry or flags (see `_shared/grading/prompt.ts`).
import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";
import { isLecturerFor, requeueGrading } from "../_shared/grading/kick.ts";

declare const Deno: { serve: (h: (req: Request) => Response | Promise<Response>) => void };

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
    .select("id, assignment_id, student_id, status")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  const owner = interview.student_id === auth.userId;
  const lecturer = owner ? false : await isLecturerFor(sb, auth.userId, interview.assignment_id);
  if (!owner && !lecturer) return errorResponse("forbidden", 403);
  if (interview.status !== "completed") return errorResponse("interview_not_completed", 409);

  const { data: succeeded } = await sb
    .from("grading_runs")
    .select("id")
    .eq("interview_id", interviewId)
    .eq("status", "succeeded")
    .limit(1)
    .maybeSingle();
  if (owner && succeeded) {
    return jsonResponse({ ok: true, queued: false, alreadyGraded: true });
  }

  const result = await requeueGrading(sb, interviewId, {
    source: "manual:evaluate-answer",
    force: lecturer === true,
    requested_by: auth.userId,
  });
  if (!result.ok) return errorResponse(`requeue_failed:${result.error ?? "unknown"}`, 500);
  return jsonResponse({ ok: true, queued: true, jobId: result.jobId, status: result.status, kicked: result.kicked });
});
