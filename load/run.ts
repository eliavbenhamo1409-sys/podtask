/**
 * Load-test harness for the interview + grading path.
 *
 *   node load/run.ts --scenario b --users 200 --target mock
 *   node load/run.ts --scenario a --users 200 --target mock --time-scale 60
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node load/run.ts --scenario b --users 50 --target supabase --yes
 *
 * Scenario A: N students connect within `--burst-sec`, each holds a live
 *             session for `--duration-min` minutes and writes a transcript
 *             turn every `--turn-sec` seconds. Measures admission success,
 *             write latency, error rate.
 * Scenario B: N interviews complete within `--burst-sec`; the grading queue
 *             drains them through workers limited by the capacity pools.
 *             Measures backlog over time, completion -> report_ready
 *             latency p50/p95/p99, drain time, model-call counts.
 *
 * `--target mock` runs everything in-process: the REAL pipeline
 * (`gradeInterview`), a queue with the same claim/lease/backoff semantics as
 * the SQL RPCs, a real in-memory capacity gate, and a mock model with a
 * configurable per-call latency. Zero cost, repeatable, and it validates the
 * orchestration maths (how many workers / pool sizes drain 200 interviews in
 * how long). It does NOT prove anything about Supabase, Vercel or OpenAI.
 *
 * `--target supabase` drives the real project with the service-role key:
 * scenario B inserts synthetic completed interviews whose jobs run with the
 * mock provider on the server (no OpenAI spend), scenario A creates
 * throwaway auth users and calls the real edge functions (`--mint` adds the
 * OpenAI secret mint; off by default). Requires `--yes`, cleans up after
 * itself, and needs the grading migration + worker + cron to be deployed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gradeInterview, type ConcurrencyGate, type GradingStore, type NewRun, type PersistArgs, type Pool, type StoredRun } from "../supabase/functions/_shared/grading/pipeline.ts";
import { createMockProvider } from "../supabase/functions/_shared/grading/provider.ts";
import type { InterviewBundle, PlanQuestion, TranscriptRow } from "../supabase/functions/_shared/grading/types.ts";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args.set(a.slice(2), next);
    i += 1;
  } else args.set(a.slice(2), "true");
}
const num = (k: string, d: number) => Number(args.get(k) ?? d);
const scenario = (args.get("scenario") ?? "b").toLowerCase();
const target = args.get("target") ?? "mock";
const users = num("users", 200);
const burstSec = num("burst-sec", 30);
const durationMin = num("duration-min", 12);
const turnSec = num("turn-sec", 20);
const timeScale = num("time-scale", target === "mock" ? 60 : 1);
const mockEvalMs = num("mock-eval-ms", 900);
const workers = num("workers", 8);
const batch = num("batch", 2);
const tickMs = num("tick-ms", 10_000);
const poolsArg = args.get("pools") ?? "realtime=12,evaluate=10,verify=4,narrative=6";
const outDir = resolve(args.get("out") ?? "load/results");
const yes = args.get("yes") === "true";

const pools = new Map<string, number>();
for (const part of poolsArg.split(",")) {
  const [k, v] = part.split("=");
  if (k && v) pools.set(k.trim(), Number(v));
}

function pct(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// In-memory capacity gate (same semantics as acquire_ai_slot)
// ---------------------------------------------------------------------------
class MemoryGate implements ConcurrencyGate {
  leases = new Map<string, Map<string, number>>();
  refusals = 0;
  acquires = 0;
  peak = new Map<string, number>();
  private limits: Map<string, number>;
  constructor(limits: Map<string, number>) {
    this.limits = limits;
  }
  async acquire(pool: Pool | "realtime", holder: string, ttlSeconds: number) {
    const max = this.limits.get(pool);
    if (max === undefined) return { ok: true as const };
    const now = Date.now();
    const m = this.leases.get(pool) ?? new Map<string, number>();
    for (const [h, exp] of m) if (exp < now) m.delete(h);
    if (m.has(holder)) {
      m.set(holder, now + ttlSeconds * 1000);
      return { ok: true as const };
    }
    if (m.size >= max) {
      this.refusals += 1;
      const next = Math.min(...m.values());
      return { ok: false as const, retryAfterSeconds: Math.max(1, Math.min(60, Math.ceil((next - now) / 1000))) };
    }
    m.set(holder, now + ttlSeconds * 1000);
    this.leases.set(pool, m);
    this.acquires += 1;
    this.peak.set(pool, Math.max(this.peak.get(pool) ?? 0, m.size));
    return { ok: true as const };
  }
  async release(pool: Pool | "realtime", holder: string) {
    this.leases.get(pool)?.delete(holder);
  }
  inFlight(pool: string): number {
    return this.leases.get(pool)?.size ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Synthetic interview
// ---------------------------------------------------------------------------
const PLAN: PlanQuestion[] = [
  { id: "q1", index: 0, kind: "opening", topic: "פתיחה", question: "ספרי לי על העבודה.", anchor: "", keyPoints: ["תמחור פחמן", "השוואה בין כלים", "השפעה חלוקתית"], followUps: [] },
  { id: "q2", index: 1, kind: "concept", topic: "מושג", question: "מה ההבדל בין מס פחמן למסחר בפליטות?", anchor: "מס פחמן קובע מחיר קבוע לטון פליטה", keyPoints: ["מחיר קבוע לטון", "תקרת כמות", "המחיר נקבע בשוק"], followUps: [] },
  { id: "q3", index: 2, kind: "evidence", topic: "נתונים", question: "על אילו נתונים התבססת?", anchor: "הלשכה המרכזית לסטטיסטיקה", keyPoints: ["הלשכה המרכזית לסטטיסטיקה", "משרד האנרגיה", "2019 עד 2023"], followUps: [] },
  { id: "q4", index: 3, kind: "counter", topic: "ביקורת", question: "איך היית מגיבה לטענה נגדית?", anchor: "", keyPoints: ["פיצוי משנה את ההשפעה", "ללא פיצוי רגרסיבית"], followUps: [] },
  { id: "q5", index: 4, kind: "reflection", topic: "השתקפות", question: "מה היית משנה?", anchor: "", keyPoints: ["נתונים עדכניים", "כלים נוספים"], followUps: [] },
];
const ANSWERS: Record<string, string> = {
  q1: "העבודה עוסקת בתמחור פחמן ככלי מדיניות ובהשוואה בין כלים שונים ובהשפעה החלוקתית שלהם על משקי בית.",
  q2: "מס פחמן קובע מחיר קבוע לטון פליטה ואילו במסחר יש תקרת כמות והמחיר נקבע בשוק ההיתרים.",
  q3: "התבססתי על נתוני הלשכה המרכזית לסטטיסטיקה ודוחות משרד האנרגיה לשנים 2019 עד 2023.",
  q4: "פיצוי משנה את ההשפעה החלוקתית, אבל ללא פיצוי המערכת רגרסיבית כפי שהראיתי.",
  q5: "הייתי מוסיפה נתונים עדכניים יותר ובוחנת כלים נוספים כמו סובסידיות.",
};

function syntheticBundle(i: number): InterviewBundle {
  const interviewId = `${(i + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const rows: TranscriptRow[] = [];
  let t = Date.parse("2026-10-14T10:00:00Z");
  let n = 0;
  const push = (row: Omit<TranscriptRow, "id" | "created_at">) => {
    t += 20_000;
    n += 1;
    rows.push({ id: `m-${i}-${n}`, created_at: new Date(t).toISOString(), ...row });
  };
  for (const q of PLAN) {
    push({ speaker: "ai_host", message_type: "question", content: q.question, plan_question_id: q.id, metadata: {} });
    push({ speaker: "student", message_type: "answer", content: ANSWERS[q.id], plan_question_id: q.id, metadata: { source: "client" } });
  }
  return {
    interviewId,
    submissionId: `sub-${i}`,
    assignmentId: "load-assignment",
    studentId: `student-${i}`,
    language: "he",
    assignmentTitle: "עבודת עומס",
    analysis: { summary: "השוואה בין מס פחמן למסחר בפליטות.", mainArgument: "", keyConcepts: [], claims: [] },
    plan: PLAN,
    messages: rows,
    chunks: [{ index: 0, content: "מס פחמן קובע מחיר קבוע לטון פליטה. הנתונים נאספו מהלשכה המרכזית לסטטיסטיקה ומדוחות משרד האנרגיה לשנים 2019 עד 2023." }],
    technical: { disconnects: 0, resumes: 0, mintFailures: 0, technicalIssue: false },
  };
}

// ---------------------------------------------------------------------------
// In-memory queue with the SQL semantics (claim / lease / backoff / done)
// ---------------------------------------------------------------------------
interface Job {
  id: string;
  interviewId: string;
  status: "queued" | "running" | "done" | "failed" | "dead";
  attempts: number;
  runAfter: number;
  leaseUntil: number;
  queuedAt: number;
  finishedAt: number | null;
}

class MemoryQueue {
  jobs = new Map<string, Job>();
  enqueue(interviewId: string): void {
    if (this.jobs.has(interviewId)) return;
    this.jobs.set(interviewId, { id: `job-${interviewId}`, interviewId, status: "queued", attempts: 0, runAfter: Date.now(), leaseUntil: 0, queuedAt: Date.now(), finishedAt: null });
  }
  claim(limit: number, interviewId?: string): Job[] {
    const now = Date.now();
    const out: Job[] = [];
    for (const j of this.jobs.values()) {
      if (out.length >= limit) break;
      if (interviewId && j.interviewId !== interviewId) continue;
      const claimable = (j.status === "queued" || j.status === "failed") && j.runAfter <= now || (j.status === "running" && j.leaseUntil < now);
      if (!claimable || j.attempts >= 5) continue;
      j.status = "running";
      j.attempts += 1;
      j.leaseUntil = now + 180_000;
      out.push(j);
    }
    return out;
  }
  done(j: Job): void {
    j.status = "done";
    j.finishedAt = Date.now();
  }
  fail(j: Job, retryAfterSec: number | null): void {
    j.status = j.attempts >= 5 ? "dead" : "failed";
    j.runAfter = Date.now() + (retryAfterSec ?? Math.min(600, 15 * 2 ** (j.attempts - 1))) * 1000;
  }
  backlog(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.status !== "done" && j.status !== "dead") n += 1;
    return n;
  }
}

class LoadStore implements GradingStore {
  private bundles: Map<string, InterviewBundle>;
  constructor(bundles: Map<string, InterviewBundle>) {
    this.bundles = bundles;
  }
  loadBundle(id: string) {
    return Promise.resolve(this.bundles.get(id) ?? null);
  }
  findReusableRun() {
    return Promise.resolve(null as StoredRun | null);
  }
  findResumableRun() {
    return Promise.resolve(null as StoredRun | null);
  }
  createRun(run: NewRun) {
    return Promise.resolve({ id: `run-${run.interviewId}`, runNo: 1 });
  }
  checkpoint() {
    return Promise.resolve();
  }
  persistResult(_a: PersistArgs) {
    return Promise.resolve();
  }
  failRun() {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Scenario B (mock): burst of completions -> queue -> workers
// ---------------------------------------------------------------------------
async function scenarioBMock(): Promise<Record<string, unknown>> {
  const bundles = new Map<string, InterviewBundle>();
  for (let i = 0; i < users; i++) {
    const b = syntheticBundle(i);
    bundles.set(b.interviewId, b);
  }
  const store = new LoadStore(bundles);
  const gate = new MemoryGate(pools);
  const queue = new MemoryQueue();
  const provider = createMockProvider({ delayMs: mockEvalMs });
  const latencies: number[] = [];
  const backlogSamples: Array<{ t: number; backlog: number; evaluate: number }> = [];
  const started = Date.now();
  let calls = 0;
  let failures = 0;
  let busy = 0;

  const runJob = async (j: Job) => {
    busy += 1;
    try {
      await gradeInterview(store, j.interviewId, {
        provider: { name: "mock", call: (req) => (calls += 1, provider.call(req)) },
        gate,
        jobId: j.id,
        params: { qaSampleRate: 0.1 },
        maxSlotWaitMs: 90_000,
      });
      queue.done(j);
      latencies.push(j.finishedAt! - j.queuedAt);
    } catch (err) {
      failures += 1;
      queue.fail(j, err instanceof Error && "retryAfterSeconds" in err ? (err as { retryAfterSeconds: number }).retryAfterSeconds : null);
    } finally {
      busy -= 1;
    }
  };

  // Completions arrive spread over the burst; each one "kicks" a worker invocation (bounded by `workers`).
  const kickQueue: string[] = [];
  const spawnWorker = async (interviewId?: string) => {
    if (busy >= workers * batch) {
      if (interviewId) kickQueue.push(interviewId);
      return;
    }
    const jobs = queue.claim(interviewId ? 1 : batch, interviewId);
    await Promise.all(jobs.map(runJob));
  };
  const arrivals = (async () => {
    for (let i = 0; i < users; i++) {
      const b = syntheticBundle(i);
      queue.enqueue(b.interviewId);
      void spawnWorker(b.interviewId);
      await sleep((burstSec * 1000) / users);
    }
  })();
  const ticker = (async () => {
    while (queue.backlog() > 0 || Date.now() - started < burstSec * 1000) {
      backlogSamples.push({ t: Date.now() - started, backlog: queue.backlog(), evaluate: gate.inFlight("evaluate") });
      const fanout = Math.min(workers, Math.ceil(queue.backlog() / batch));
      for (let i = 0; i < fanout; i++) void spawnWorker();
      await sleep(Math.max(250, tickMs / timeScale));
    }
  })();
  await arrivals;
  await ticker;
  while (busy > 0) await sleep(50);
  const drainMs = Date.now() - started;
  return {
    scenario: "b",
    target: "mock",
    users,
    workers,
    batch,
    pools: Object.fromEntries(pools),
    mockEvalMs,
    reports: latencies.length,
    failures,
    deadJobs: [...queue.jobs.values()].filter((j) => j.status === "dead").length,
    modelCalls: calls,
    slotRefusals: gate.refusals,
    peakInFlight: Object.fromEntries(gate.peak),
    drainSeconds: Math.round(drainMs / 1000),
    completionToReportMs: { p50: Math.round(pct(latencies, 50)), p95: Math.round(pct(latencies, 95)), p99: Math.round(pct(latencies, 99)), max: Math.round(Math.max(...latencies)) },
    throughputPerMin: Math.round((latencies.length / (drainMs / 60_000)) * 10) / 10,
    backlogSamples: backlogSamples.filter((_, i) => i % Math.max(1, Math.floor(backlogSamples.length / 40)) === 0),
  };
}

// ---------------------------------------------------------------------------
// Scenario A (mock): burst of connections + transcript writes under admission control
// ---------------------------------------------------------------------------
async function scenarioAMock(): Promise<Record<string, unknown>> {
  const gate = new MemoryGate(pools);
  const writeLatencies: number[] = [];
  let admitted = 0;
  let refused = 0;
  let writes = 0;
  const simulatedWrite = async () => {
    const t = Date.now();
    await sleep(60 + Math.random() * 120); // measured p50 for save-interview-message was ~0.9 s at 30 rps; scaled
    writeLatencies.push(Date.now() - t);
    writes += 1;
  };
  const started = Date.now();
  const sessions = Array.from({ length: users }, async (_, i) => {
    await sleep((i / users) * burstSec * 1000);
    const slot = await gate.acquire("realtime", `interview:${i}`, (durationMin + 15) * 60);
    if (!slot.ok) {
      refused += 1;
      return;
    }
    admitted += 1;
    const turns = Math.floor((durationMin * 60) / turnSec);
    for (let k = 0; k < turns; k++) {
      await sleep((turnSec * 1000) / timeScale);
      await simulatedWrite();
    }
    await gate.release("realtime", `interview:${i}`);
  });
  await Promise.all(sessions);
  return {
    scenario: "a",
    target: "mock",
    users,
    realtimePool: pools.get("realtime") ?? null,
    admitted,
    refused,
    admissionRate: Math.round((admitted / users) * 1000) / 1000,
    transcriptWrites: writes,
    writeLatencyMs: { p50: Math.round(pct(writeLatencies, 50)), p95: Math.round(pct(writeLatencies, 95)) },
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
    note: "Admission is the realtime pool: with the default 12 (current OpenAI Build tier) most of a 200-user burst is refused with an explicit at_capacity; raise ai_capacity.realtime after upgrading the tier.",
  };
}

// ---------------------------------------------------------------------------
// Supabase targets
// ---------------------------------------------------------------------------
async function supabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --target supabase");
  if (!yes) throw new Error("--target supabase writes to the project; pass --yes to confirm");
  const { createClient } = await import("@supabase/supabase-js");
  return { sb: createClient(url, key, { auth: { persistSession: false } }), url, key };
}

async function scenarioBSupabase(): Promise<Record<string, unknown>> {
  const { sb } = await supabaseClient();
  const tag = `loadtest-${Date.now()}`;
  // One throwaway student + course + assignment; N submissions/interviews.
  const { data: user, error: userErr } = await sb.auth.admin.createUser({ email: `${tag}@podtask.local`, password: `${tag}-Pw!`, email_confirm: true });
  if (userErr || !user.user) throw new Error(`createUser failed: ${userErr?.message}`);
  const studentId = user.user.id;
  const { data: inst } = await sb.from("institutions").insert({ name: tag, slug: tag }).select("id").single();
  const { data: course } = await sb.from("courses").insert({ institution_id: inst!.id, name: tag, code: "LOADTEST" }).select("id").single();
  const { data: assignment } = await sb.from("assignments").insert({ course_id: course!.id, title: tag, status: "published" }).select("id").single();
  const interviewIds: string[] = [];
  const t0 = Date.now();
  for (let i = 0; i < users; i++) {
    const { data: sub } = await sb.from("submissions").insert({ assignment_id: assignment!.id, student_id: studentId, status: "interview_ready" }).select("id").single();
    const { data: iv } = await sb
      .from("interviews")
      .insert({ submission_id: sub!.id, assignment_id: assignment!.id, student_id: studentId, status: "in_progress", language: "he", started_at: new Date().toISOString() })
      .select("id")
      .single();
    const b = syntheticBundle(i);
    await sb.from("interview_plans").insert({ interview_id: iv!.id, model: "loadtest", plan: { questions: PLAN.map((q) => ({ id: q.id, kind: q.kind, topic: q.topic, question: q.question, anchor: q.anchor, key_points: q.keyPoints, follow_ups: [] })) } });
    await sb.from("interview_messages").insert(
      b.messages.map((m) => ({ interview_id: iv!.id, speaker: m.speaker, message_type: m.message_type, content: m.content, plan_question_id: m.plan_question_id, metadata: { source: "loadtest" } })),
    );
    interviewIds.push(iv!.id);
  }
  // Burst of completions: the trigger queues the jobs; mark them mock before any worker claims them.
  const completeAt = new Map<string, number>();
  for (let i = 0; i < interviewIds.length; i++) {
    const id = interviewIds[i];
    await sb.from("grading_jobs").upsert({ interview_id: id, submission_id: (await sb.from("interviews").select("submission_id").eq("id", id).single()).data!.submission_id, status: "queued", options: { provider: "mock", source: "loadtest", mock_delay_ms: mockEvalMs }, run_after: new Date(Date.now() + 3600_000).toISOString() }, { onConflict: "interview_id" });
    await sb.from("interviews").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", id);
    completeAt.set(id, Date.now());
    await sleep((burstSec * 1000) / users);
  }
  await sb.from("grading_jobs").update({ run_after: new Date().toISOString() }).in("interview_id", interviewIds);
  const backlog: Array<{ t: number; pending: number }> = [];
  const deadline = Date.now() + 40 * 60_000;
  for (;;) {
    const { data } = await sb.from("grading_jobs").select("interview_id, status, finished_at").in("interview_id", interviewIds);
    const pending = (data ?? []).filter((j) => j.status !== "done" && j.status !== "dead").length;
    backlog.push({ t: Date.now() - t0, pending });
    if (pending === 0 || Date.now() > deadline) break;
    await sleep(5000);
  }
  const { data: jobs } = await sb.from("grading_jobs").select("interview_id, status, finished_at, attempts").in("interview_id", interviewIds);
  const latencies = (jobs ?? []).filter((j) => j.status === "done" && j.finished_at).map((j) => Date.parse(j.finished_at!) - (completeAt.get(j.interview_id) ?? 0));
  const result = {
    scenario: "b",
    target: "supabase",
    users,
    done: latencies.length,
    dead: (jobs ?? []).filter((j) => j.status === "dead").length,
    retries: (jobs ?? []).reduce((s, j) => s + Math.max(0, j.attempts - 1), 0),
    completionToReportMs: { p50: Math.round(pct(latencies, 50)), p95: Math.round(pct(latencies, 95)), p99: Math.round(pct(latencies, 99)) },
    backlog,
  };
  // Cleanup (cascades from submissions / interviews; the auth user last).
  await sb.from("submissions").delete().eq("assignment_id", assignment!.id);
  await sb.from("assignments").delete().eq("id", assignment!.id);
  await sb.from("courses").delete().eq("id", course!.id);
  await sb.from("institutions").delete().eq("id", inst!.id);
  await sb.auth.admin.deleteUser(studentId);
  return result;
}

async function scenarioASupabase(): Promise<Record<string, unknown>> {
  const { sb, url, key } = await supabaseClient();
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!anon) throw new Error("SUPABASE_ANON_KEY is required for scenario A on supabase");
  const mint = args.get("mint") === "true";
  const tag = `loadtest-${Date.now()}`;
  const { data: inst } = await sb.from("institutions").insert({ name: tag, slug: tag }).select("id").single();
  const { data: course } = await sb.from("courses").insert({ institution_id: inst!.id, name: tag, code: "LOADTEST" }).select("id").single();
  const { data: assignment } = await sb.from("assignments").insert({ course_id: course!.id, title: tag, status: "published", settings: { integrity: { require_consent: false } } }).select("id").single();
  const { createClient } = await import("@supabase/supabase-js");
  const userIds: string[] = [];
  const metrics = { admitted: 0, refused: 0, mintErrors: 0, writes: 0, writeErrors: 0, writeLatency: [] as number[], startErrors: 0 };
  const sessions: Promise<void>[] = [];
  const t0 = Date.now();
  for (let i = 0; i < users; i++) {
    const email = `${tag}-${i}@podtask.local`;
    const password = `${tag}-Pw!${i}`;
    const { data: u } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
    if (!u.user) continue;
    userIds.push(u.user.id);
    await sb.from("course_members").insert({ course_id: course!.id, user_id: u.user.id, role: "student" });
    const { data: sub } = await sb.from("submissions").insert({ assignment_id: assignment!.id, student_id: u.user.id, status: "interview_ready" }).select("id").single();
    const { data: iv } = await sb.from("interviews").insert({ submission_id: sub!.id, assignment_id: assignment!.id, student_id: u.user.id, status: "ready", language: "he" }).select("id").single();
    await sb.from("interview_plans").insert({ interview_id: iv!.id, model: "loadtest", plan: { questions: PLAN.map((q) => ({ id: q.id, kind: q.kind, topic: q.topic, question: q.question, anchor: q.anchor, key_points: q.keyPoints, follow_ups: [] })) } });
    const interviewId = iv!.id;
    sessions.push(
      (async () => {
        await sleep((i / users) * burstSec * 1000);
        const client = createClient(url, anon, { auth: { persistSession: false } });
        const { error: signErr } = await client.auth.signInWithPassword({ email, password });
        if (signErr) {
          metrics.startErrors += 1;
          return;
        }
        const start = await client.functions.invoke("interview-control", { body: { action: "start", interviewId } });
        if (start.error) {
          metrics.startErrors += 1;
          return;
        }
        if (mint) {
          const m = await client.functions.invoke("create-realtime-session", { body: { interviewId } });
          if (m.error) {
            const body = await (m.error as { context?: Response }).context?.clone().json().catch(() => null);
            if (body?.error === "at_capacity") metrics.refused += 1;
            else metrics.mintErrors += 1;
            return;
          }
          metrics.admitted += 1;
        }
        const turns = Math.floor((durationMin * 60) / turnSec);
        for (let k = 0; k < turns; k++) {
          await sleep((turnSec * 1000) / timeScale);
          const q = PLAN[Math.min(PLAN.length - 1, Math.floor((k / turns) * PLAN.length))];
          const t = Date.now();
          const w = await client.functions.invoke("save-interview-message", {
            body: { interviewId, speaker: k % 2 ? "student" : "ai_host", messageType: k % 2 ? "answer" : "question", content: k % 2 ? ANSWERS[q.id] : q.question, planQuestionId: q.id, clientId: `lt-${i}-${k}` },
          });
          metrics.writeLatency.push(Date.now() - t);
          if (w.error) metrics.writeErrors += 1;
          else metrics.writes += 1;
        }
        await client.functions.invoke("complete-interview", { body: { interviewId, durationSeconds: durationMin * 60 } });
      })(),
    );
    // Auth sign-in is rate limited per IP (~150 / 5 min): pace user creation accordingly.
    await sleep(2000 / Math.max(1, timeScale / 10));
  }
  await Promise.all(sessions);
  const result = {
    scenario: "a",
    target: "supabase",
    users: userIds.length,
    mint,
    ...metrics,
    writeLatencyMs: { p50: Math.round(pct(metrics.writeLatency, 50)), p95: Math.round(pct(metrics.writeLatency, 95)) },
    elapsedSeconds: Math.round((Date.now() - t0) / 1000),
  };
  await sb.from("submissions").delete().eq("assignment_id", assignment!.id);
  await sb.from("assignments").delete().eq("id", assignment!.id);
  await sb.from("courses").delete().eq("id", course!.id);
  await sb.from("institutions").delete().eq("id", inst!.id);
  for (const id of userIds) await sb.auth.admin.deleteUser(id);
  return { ...result, writeLatency: undefined };
}

async function main(): Promise<void> {
  let result: Record<string, unknown>;
  if (target === "mock") result = scenario === "a" ? await scenarioAMock() : await scenarioBMock();
  else if (target === "supabase") result = scenario === "a" ? await scenarioASupabase() : await scenarioBSupabase();
  else throw new Error(`unknown target ${target}`);
  mkdirSync(outDir, { recursive: true });
  const file = resolve(outDir, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${scenario}-${target}-${users}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  const { backlogSamples: _b, backlog: _c, ...summary } = result as Record<string, unknown> & { backlogSamples?: unknown; backlog?: unknown };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`written ${file}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
