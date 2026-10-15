/**
 * End-to-end load test against the REAL project, without the service-role key.
 *
 * Test interviews are provisioned with SQL (see load/README.md) and owned by
 * ONE test user (a guest account). This script signs in as that user and
 * drives the real edge functions concurrently, exactly as N browsers would:
 *
 *   complete  N in-progress interviews (transcripts already stored) call
 *             complete-interview within --burst-sec; each "report page" then
 *             polls `reports` every 1.5 s and `grading_status` every 6 s (the
 *             real score-card cadence) until the report is ready, the job is
 *             dead, or --timeout-sec passes.
 *   session   N ready interviews: interview-control start within --burst-sec,
 *             then host/student transcript turns through save-interview-message
 *             every --turn-sec for --duration-min, then complete-interview and
 *             the same report polling as above.
 *   mint      create-realtime-session for N in-progress interviews within
 *             --burst-sec: counts admissions vs `503 at_capacity`. Minting a
 *             client secret is free; no audio is ever sent.
 *
 *   LOADTEST_EMAIL=... LOADTEST_PASSWORD=... node load/e2e.ts complete --ids load/results/ids.json
 *
 * Credentials come from the environment so they never land in argv, logs or
 * results. Supabase URL + anon key are read from .env.local.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const args = new Map<string, string>();
const mode = process.argv[2] ?? "complete";
for (let i = 3; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(a.slice(2), next);
    i += 1;
  } else args.set(a.slice(2), "true");
}
const num = (k: string, d: number) => Number(args.get(k) ?? d);
const burstSec = num("burst-sec", 30);
const durationMin = num("duration-min", 12);
const turnSec = num("turn-sec", 20);
const timeoutSec = num("timeout-sec", 1200);
const label = args.get("label") ?? mode;
const outDir = resolve(args.get("out") ?? "load/results");

interface IdRow {
  interviewId: string;
  questionIds: string[];
}
const fromStatus = args.get("from-status");
let rows: IdRow[] = [];
if (!fromStatus) {
  const ids: IdRow[] = JSON.parse(readFileSync(resolve(args.get("ids") ?? "load/results/ids.json"), "utf8"));
  rows = ids.slice(0, num("limit", ids.length));
}

/** The test user owns only provisioned test interviews: list them by status. */
async function loadRowsFromDb(sb: SupabaseClient, status: string): Promise<IdRow[]> {
  const { data, error } = await sb.from("interviews").select("id").eq("status", status).order("created_at", { ascending: true }).limit(num("limit", 1000));
  if (error) throw new Error(`listing interviews failed: ${error.message}`);
  return (data ?? []).map((r: { id: string }) => ({ interviewId: r.id, questionIds: ["q1", "q2", "q3", "q4", "q5"] }));
}

function env(): { url: string; anon: string } {
  const text = readFileSync(resolve(".env.local"), "utf8");
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), anon: get("NEXT_PUBLIC_SUPABASE_ANON_KEY") };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function pct(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]);
}
function dist(xs: number[]) {
  return { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: xs.length ? Math.round(Math.max(...xs)) : null };
}

interface Call {
  fn: string;
  ms: number;
  status: number;
  error: string | null;
}
const calls: Call[] = [];

async function invoke(sb: SupabaseClient, fn: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown; error: string | null }> {
  const t = performance.now();
  const { data, error } = await sb.functions.invoke(fn, { body });
  let status = 200;
  let code: string | null = null;
  if (error) {
    const ctx = (error as { context?: Response }).context;
    status = ctx?.status ?? 0;
    try {
      const j = (await ctx?.clone().json()) as { error?: string } | undefined;
      code = j?.error ?? error.message;
    } catch {
      code = error.message;
    }
  }
  calls.push({ fn, ms: performance.now() - t, status, error: code });
  return { status, data, error: code };
}

interface Outcome {
  interviewId: string;
  completeStatus: number | null;
  completedAt: number | null;
  readyAt: number | null;
  jobStatus: string | null;
  attempts: number | null;
  overall: number | null;
  provider: string | null;
}

async function waitForReport(sb: SupabaseClient, o: Outcome, deadline: number): Promise<void> {
  let tick = 0;
  while (Date.now() < deadline) {
    tick += 1;
    const t = performance.now();
    const { data, error } = await sb.from("reports").select("status, rubric_result").eq("interview_id", o.interviewId).maybeSingle();
    calls.push({ fn: "rest:reports", ms: performance.now() - t, status: error ? 500 : 200, error: error?.message ?? null });
    const rr = (data?.rubric_result ?? null) as { engine?: string; overall_score?: number; models?: { evaluate?: string } } | null;
    if (data?.status === "ready" && rr?.engine === "v2") {
      o.readyAt = Date.now();
      o.overall = typeof rr.overall_score === "number" ? rr.overall_score : null;
      o.provider = rr.models?.evaluate ?? null;
      return;
    }
    if (tick % 4 === 1) {
      const t2 = performance.now();
      const { data: st, error: e2 } = await sb.rpc("grading_status", { p_interview_id: o.interviewId });
      calls.push({ fn: "rpc:grading_status", ms: performance.now() - t2, status: e2 ? 500 : 200, error: e2?.message ?? null });
      const job = (st as { job?: { status?: string; attempts?: number } } | null)?.job;
      if (job) {
        o.jobStatus = job.status ?? null;
        o.attempts = job.attempts ?? null;
        if (job.status === "dead") return;
      }
    }
    await sleep(1500);
  }
}

async function complete(sb: SupabaseClient, o: Outcome, durationSeconds: number) {
  const r = await invoke(sb, "complete-interview", { interviewId: o.interviewId, durationSeconds });
  o.completeStatus = r.status;
  o.completedAt = Date.now();
}

async function runComplete(sb: SupabaseClient) {
  const t0 = Date.now();
  const outcomes: Outcome[] = rows.map((r) => ({ interviewId: r.interviewId, completeStatus: null, completedAt: null, readyAt: null, jobStatus: null, attempts: null, overall: null, provider: null }));
  const deadline = t0 + timeoutSec * 1000;
  await Promise.all(
    outcomes.map(async (o, i) => {
      await sleep((i / outcomes.length) * burstSec * 1000);
      await complete(sb, o, durationMin * 60);
      await waitForReport(sb, o, deadline);
    }),
  );
  return { t0, outcomes };
}

async function runSession(sb: SupabaseClient) {
  const t0 = Date.now();
  const outcomes: Outcome[] = rows.map((r) => ({ interviewId: r.interviewId, completeStatus: null, completedAt: null, readyAt: null, jobStatus: null, attempts: null, overall: null, provider: null }));
  const turns = Math.max(2, Math.floor((durationMin * 60) / turnSec));
  const deadline = t0 + (durationMin * 60 + timeoutSec) * 1000;
  await Promise.all(
    rows.map(async (row, i) => {
      const o = outcomes[i];
      await sleep((i / rows.length) * burstSec * 1000);
      const start = await invoke(sb, "interview-control", { action: "start", interviewId: row.interviewId });
      if (start.status !== 200) return;
      for (let k = 0; k < turns; k++) {
        await sleep(turnSec * 1000 * (0.8 + Math.random() * 0.4));
        const q = row.questionIds[Math.min(row.questionIds.length - 1, Math.floor((k / turns) * row.questionIds.length))];
        const host = k % 2 === 0;
        await invoke(sb, "save-interview-message", {
          interviewId: row.interviewId,
          speaker: host ? "ai_host" : "student",
          messageType: host ? "question" : "answer",
          content: host
            ? `אנחנו בשאלה ${Math.floor(k / 2) + 1}. איך היית מסבירה את הרעיון המרכזי בעבודה?`
            : "מס פחמן קובע מחיר קבוע לטון פליטה והכמות נקבעת בשוק, ואילו מערכת מסחר קובעת תקרת כמות והמחיר נקבע בשוק ההיתרים.",
          planQuestionId: q,
          clientId: `lt-${row.interviewId.slice(0, 8)}-${k}`,
        });
      }
      await complete(sb, o, durationMin * 60);
      await waitForReport(sb, o, deadline);
    }),
  );
  return { t0, outcomes };
}

async function runMint(sb: SupabaseClient) {
  const t0 = Date.now();
  const results: Array<{ interviewId: string; status: number; error: string | null }> = [];
  await Promise.all(
    rows.map(async (row, i) => {
      await sleep((i / rows.length) * burstSec * 1000);
      const r = await invoke(sb, "create-realtime-session", { interviewId: row.interviewId });
      results.push({ interviewId: row.interviewId, status: r.status, error: r.error });
    }),
  );
  return { t0, results };
}

async function main() {
  const email = process.env.LOADTEST_EMAIL;
  const password = process.env.LOADTEST_PASSWORD;
  if (!email || !password) throw new Error("LOADTEST_EMAIL and LOADTEST_PASSWORD are required");
  const { url, anon } = env();
  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: true } });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  if (fromStatus) rows = await loadRowsFromDb(sb, fromStatus);
  if (rows.length === 0) throw new Error("no interviews to drive");

  let summary: Record<string, unknown>;
  if (mode === "mint") {
    const { t0, results } = await runMint(sb);
    const by = new Map<string, number>();
    for (const r of results) by.set(`${r.status}:${r.error ?? "ok"}`, (by.get(`${r.status}:${r.error ?? "ok"}`) ?? 0) + 1);
    summary = { mode, label, n: rows.length, burstSec, elapsedSec: Math.round((Date.now() - t0) / 1000), outcomes: Object.fromEntries(by), latencyMs: dist(calls.map((c) => c.ms)) };
  } else {
    const { t0, outcomes } = mode === "session" ? await runSession(sb) : await runComplete(sb);
    const ready = outcomes.filter((o) => o.readyAt && o.completedAt);
    const lat = ready.map((o) => (o.readyAt! - o.completedAt!) / 1000);
    const byFn = new Map<string, Call[]>();
    for (const c of calls) byFn.set(c.fn, [...(byFn.get(c.fn) ?? []), c]);
    summary = {
      mode,
      label,
      n: rows.length,
      burstSec,
      durationMin: mode === "session" ? durationMin : undefined,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      completeOk: outcomes.filter((o) => o.completeStatus === 200).length,
      reportsReady: ready.length,
      dead: outcomes.filter((o) => o.jobStatus === "dead").length,
      notReady: outcomes.filter((o) => !o.readyAt).map((o) => ({ id: o.interviewId, job: o.jobStatus, complete: o.completeStatus })).slice(0, 20),
      completionToReportSec: dist(lat),
      lastReportAtSec: ready.length ? Math.round((Math.max(...ready.map((o) => o.readyAt!)) - t0) / 1000) : null,
      calls: Object.fromEntries(
        [...byFn].map(([fn, cs]) => [
          fn,
          {
            n: cs.length,
            errors: cs.filter((c) => c.status !== 200).length,
            errorCodes: Object.fromEntries([...new Set(cs.filter((c) => c.status !== 200).map((c) => `${c.status}:${c.error}`))].map((k) => [k, cs.filter((c) => `${c.status}:${c.error}` === k).length])),
            latencyMs: dist(cs.map((c) => c.ms)),
          },
        ]),
      ),
      scores: dist(ready.map((o) => o.overall ?? 0)),
    };
  }
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-e2e-${label}-${rows.length}.json`);
  writeFileSync(file, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`written ${file}`);
  await sb.auth.signOut();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
