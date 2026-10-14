import { test } from "node:test";
import assert from "node:assert/strict";

// The queue reads `window` for timers, `navigator.onLine` and sessionStorage.
const store = new Map<string, string>();
const fakeWindow = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 5)),
  clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  addEventListener: () => {},
  removeEventListener: () => {},
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};
Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });

const { IntegrityEventQueue } = await import("../../lib/integrity/event-queue.ts");
type Ev = import("../../lib/integrity/types.ts").IntegrityClientEvent;

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const ev = (kind: Ev["kind"], extra: Partial<Ev> = {}): Ev => ({ kind, startedAt: new Date().toISOString(), ...extra });

test("push assigns ids and sequence numbers and ships one batch for a burst", async () => {
  const sent: Ev[][] = [];
  const q = new IntegrityEventQueue(async (events) => { sent.push(events); return "ok"; }, { intervalMs: 1 });
  q.push(ev("visibility_hidden"));
  q.push(ev("tab_returned"));
  q.push(ev("window_blur"));
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 3);
  assert.ok(sent[0].every((e) => typeof e.eventId === "string" && e.eventId.length === 36));
  assert.deepEqual(sent[0].map((e) => e.seq), [1, 2, 3]);
  assert.equal(q.pending, 0);
  assert.equal(q.syncState, "synced");
  q.dispose();
});

test("a failed send is retried with the same ids, a dropped batch is discarded", async () => {
  const sent: Ev[][] = [];
  let calls = 0;
  const q = new IntegrityEventQueue(async (events) => {
    calls += 1;
    sent.push(events);
    if (calls === 1) throw new Error("network");
    if (calls === 2) return "retry";
    return "ok";
  }, { intervalMs: 1 });
  q.push(ev("face_missing", { eventId: "11111111-1111-4111-8111-111111111111" }));
  await tick(5);
  assert.equal(q.syncState, "retrying");
  await tick(60);
  assert.ok(calls >= 3, `calls=${calls}`);
  assert.ok(sent.every((b) => b[0].eventId === "11111111-1111-4111-8111-111111111111"));
  assert.equal(q.pending, 0);
  q.dispose();

  const q2 = new IntegrityEventQueue(async () => "drop", { intervalMs: 1 });
  q2.push(ev("offline"));
  await tick();
  assert.equal(q2.pending, 0);
  q2.dispose();
});

test("the unsent buffer survives a reload through sessionStorage", async () => {
  store.clear();
  const q = new IntegrityEventQueue(async () => "retry", { intervalMs: 1, storageKey: "k1" });
  q.push(ev("visibility_hidden", { eventId: "22222222-2222-4222-8222-222222222222" }));
  await tick();
  assert.ok(store.get("k1")?.includes("22222222-2222-4222-8222-222222222222"));
  q.dispose(); // simulates the page going away; the buffer stays persisted
  const sent: Ev[][] = [];
  const q2 = new IntegrityEventQueue(async (events) => { sent.push(events); return "ok"; }, { intervalMs: 1, storageKey: "k1" });
  assert.equal(q2.pending, 1);
  await tick(20);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].eventId, "22222222-2222-4222-8222-222222222222");
  assert.equal(store.has("k1"), false);
  q2.dispose();
});

test("open and close copies of one interval are two buffered items that both ship", async () => {
  const sent: Ev[][] = [];
  const q = new IntegrityEventQueue(async (events) => { sent.push(events); return "ok"; }, { intervalMs: 1 });
  const id = "33333333-3333-4333-8333-333333333333";
  q.push(ev("visibility_hidden", { eventId: id, endedAt: null }));
  q.push(ev("visibility_hidden", { eventId: id, endedAt: new Date().toISOString(), durationMs: 1200 }));
  await tick();
  assert.equal(sent[0].length, 2);
  assert.equal(q.pending, 0);
  q.dispose();
});

test("keepalive flush sends at most one batch and keeps it until acknowledged", async () => {
  store.clear();
  const sent: Ev[][] = [];
  const q = new IntegrityEventQueue(async (events, opts) => { sent.push(events); return opts.keepalive ? "ok" : "retry"; }, { intervalMs: 1000, storageKey: "k2" });
  for (let i = 0; i < 60; i++) q.push(ev("window_blur"));
  await q.flush({ keepalive: true });
  await tick();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 50);
  assert.equal(q.pending, 10);
  q.dispose();
});
