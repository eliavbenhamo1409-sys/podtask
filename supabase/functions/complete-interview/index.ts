import { CORS_HEADERS, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { serviceClient, userClient } from "../_shared/supabase.ts";

declare const Deno: {
  serve: (h: (req: Request) => Response | Promise<Response>) => void;
  env: { get(key: string): string | undefined };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return errorResponse("method_not_allowed", 405);

  const auth = await userClient(req);
  if (!auth) return errorResponse("not_authenticated", 401);

  const body = await req.json().catch(() => null);
  const { interviewId, durationSeconds } = body ?? {};
  if (typeof interviewId !== "string") return errorResponse("invalid_interview_id");

  const sb = serviceClient();
  const { data: interview } = await sb
    .from("interviews")
    .select("id, submission_id, student_id, status")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return errorResponse("interview_not_found", 404);
  if (interview.student_id !== auth.userId) return errorResponse("forbidden", 403);

  const wasAlreadyCompleted = interview.status === "completed";

  await sb
    .from("interviews")
    .update({
      status: "completed",
      current_state: "completed",
      completed_at: new Date().toISOString(),
      duration_seconds: typeof durationSeconds === "number" ? durationSeconds : null,
    })
    .eq("id", interviewId);

  await sb
    .from("submissions")
    .update({ status: "interview_completed" })
    .eq("id", interview.submission_id);

  await sb.from("system_events").insert({
    actor_id: auth.userId,
    entity_type: "interview",
    entity_id: interviewId,
    event_type: "interview.completed",
    payload: { duration_seconds: durationSeconds ?? null },
  });

  // Kick off scoring synchronously so the /complete page can render the
  // grade as soon as it loads. We forward the user's Authorization header
  // so generate-report can validate ownership the same way as a normal
  // request. Failures are logged but never block the response.
  let reportTriggered = false;
  if (!wasAlreadyCompleted) {
    try {
      const reportUrl = buildFunctionUrl("generate-report");
      if (reportUrl) {
        const r = await fetch(reportUrl, {
          method: "POST",
          headers: {
            Authorization: req.headers.get("Authorization") ?? "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ interviewId }),
        });
        reportTriggered = r.ok;
        if (!r.ok) {
          const text = await r.text().catch(() => "");
          await sb.from("system_events").insert({
            actor_id: auth.userId,
            entity_type: "interview",
            entity_id: interviewId,
            event_type: "report.invoke_failed",
            payload: {
              severity: "warn",
              status: r.status,
              body: text.slice(0, 400),
            },
          });
        }
      }
    } catch (err) {
      await sb.from("system_events").insert({
        actor_id: auth.userId,
        entity_type: "interview",
        entity_id: interviewId,
        event_type: "report.invoke_failed",
        payload: {
          severity: "warn",
          reason: err instanceof Error ? err.message : "unknown",
        },
      });
    }
  }

  return jsonResponse({ ok: true, reportTriggered });
});

/**
 * Builds the absolute URL to a sibling Edge Function. Edge Functions run
 * inside Supabase and `SUPABASE_URL` always resolves to the project root,
 * so `<SUPABASE_URL>/functions/v1/<name>` is the canonical address.
 */
function buildFunctionUrl(name: string): string | null {
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/functions/v1/${name}`;
}
