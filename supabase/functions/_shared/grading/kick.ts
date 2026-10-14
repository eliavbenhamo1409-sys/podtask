/**
 * Edge-only helpers around the grading queue:
 *
 *   kickGradingWorker  best-effort POST to `grading-worker` for one interview
 *                      right after it was queued (the student should not wait
 *                      for the next cron tick). Uses `EdgeRuntime.waitUntil`
 *                      when the runtime offers it; otherwise awaits with a
 *                      short cap. Never a delivery guarantee: pg_cron is.
 *   requeueGrading     `requeue_grading` RPC + kick (manual re-runs).
 *   isLecturerFor      course-membership check for lecturer-only re-runs.
 */

declare const Deno: { env: { get(key: string): string | undefined } };
declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined;

// deno-lint-ignore no-explicit-any
type Sb = any;

export type KickResult = "wait_until" | "awaited" | "timeout" | "skipped" | "error";

export async function kickGradingWorker(interviewId: string, opts: { capMs?: number } = {}): Promise<KickResult> {
  const base = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) return "skipped";
  const url = `${base.replace(/\/$/, "")}/functions/v1/grading-worker`;
  const ctrl = new AbortController();
  const request = fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ interviewId, mode: "kick" }),
    signal: ctrl.signal,
  }).then((r) => r.text()).catch(() => null);

  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime?.waitUntil === "function") {
    setTimeout(() => ctrl.abort(), 120_000);
    EdgeRuntime.waitUntil(request);
    return "wait_until";
  }
  const cap = opts.capMs ?? 3000;
  const timer = setTimeout(() => ctrl.abort(), cap);
  try {
    const out = await request;
    return out === null ? "error" : "awaited";
  } catch {
    return "timeout";
  } finally {
    clearTimeout(timer);
  }
}

export async function requeueGrading(
  sb: Sb,
  interviewId: string,
  options: Record<string, unknown>,
): Promise<{ ok: boolean; jobId: string | null; status: string | null; kicked: KickResult; error?: string }> {
  const { data, error } = await sb.rpc("requeue_grading", { p_interview_id: interviewId, p_options: options, p_priority: 50 });
  if (error) return { ok: false, jobId: null, status: null, kicked: "skipped", error: error.message };
  const kicked = await kickGradingWorker(interviewId);
  return { ok: true, jobId: (data?.job_id as string) ?? null, status: (data?.status as string) ?? null, kicked };
}

/** True when `userId` lectures (or assists) the course the assignment belongs to, or is an admin. */
export async function isLecturerFor(sb: Sb, userId: string, assignmentId: string): Promise<boolean> {
  const { data: profile } = await sb.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profile?.role === "admin") return true;
  if (profile?.role !== "lecturer") return false;
  const { data: assignment } = await sb.from("assignments").select("course_id").eq("id", assignmentId).maybeSingle();
  if (!assignment?.course_id) return false;
  const { data: membership } = await sb
    .from("course_members")
    .select("id")
    .eq("course_id", assignment.course_id)
    .eq("user_id", userId)
    .in("role", ["lecturer", "ta"])
    .limit(1)
    .maybeSingle();
  return !!membership;
}
