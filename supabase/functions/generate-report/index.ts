// Edge Function: generate-report
//
// Since grading engine v2 the report is produced by the grading pipeline
// (`grading-worker`, `_shared/grading/*`): the score is computed by code
// from the per-question evaluations (`score.ts`), and the model only writes
// the narrative that explains it (`prompt.ts` / `buildNarrativeMessages`).
// This function is kept for its callers and now only (re)queues that
// pipeline, with the same rules as `evaluate-answer`:
//
//   - the student (owner) may call it only while no grading run has
//     succeeded yet (recovery after a lost job);
//   - a lecturer of the course (or an admin) may force a NEW run.
//
// The report is written in the interview language; integrity is never part
// of it (`interview_flags` live elsewhere).
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

  const { data: existing } = await sb
    .from("reports")
    .select("id, status, grading_run_id")
    .eq("interview_id", interviewId)
    .maybeSingle();
  if (owner && existing?.status === "ready" && existing.grading_run_id) {
    return jsonResponse({ ok: true, queued: false, reportId: existing.id, alreadyGraded: true });
  }

  const result = await requeueGrading(sb, interviewId, {
    source: "manual:generate-report",
    force: lecturer === true,
    requested_by: auth.userId,
  });
  if (!result.ok) return errorResponse(`requeue_failed:${result.error ?? "unknown"}`, 500);
  return jsonResponse({ ok: true, queued: true, jobId: result.jobId, status: result.status, kicked: result.kicked });
});
