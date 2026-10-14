import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_KINDS,
  MAX_EVENTS_PER_BATCH,
  normalizeEventBatch,
  parseCameraExemption,
} from "../../supabase/functions/_shared/integrity-events.ts";

const NOW = Date.parse("2026-10-16T10:00:00.000Z");
let generated = 0;
const ctx = { interviewId: "i1", studentId: "s1", now: NOW, newId: () => `generated-${++generated}` };
const iso = (ms: number) => new Date(NOW + ms).toISOString();

test("the server kind list matches the client kind list", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../lib/integrity/types.ts", import.meta.url), "utf8"));
  for (const k of EVENT_KINDS) assert.ok(src.includes(`"${k}"`), `client is missing ${k}`);
});

test("valid events become rows; unknown kinds and junk are dropped", () => {
  const out = normalizeEventBatch(
    [
      { kind: "visibility_hidden", eventId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", startedAt: iso(-5000), seq: 3, planQuestionId: "q2", payload: { phase: "open" } },
      { kind: "not_a_kind", startedAt: iso(0) },
      null,
      "x",
      { kind: "offline", startedAt: "garbage", confidence: 7 },
    ],
    ctx,
  );
  assert.equal(out.dropped, 3);
  assert.equal(out.inserts.length, 2);
  const [hidden, offline] = out.inserts;
  assert.equal(hidden.event_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(hidden.client_seq, 3);
  assert.equal(hidden.plan_question_id, "q2");
  assert.equal(hidden.ended_at, null);
  assert.equal(hidden.source, "client");
  assert.match(offline.event_id, /^generated-\d+$/);
  assert.equal(offline.started_at, iso(0)); // unparsable -> now
  assert.equal(offline.confidence, 1); // clamped
  assert.equal(out.closes.length, 0);
});

test("an event with an end also produces a close; duration follows the timestamps", () => {
  const out = normalizeEventBatch(
    [{ kind: "face_missing", eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", startedAt: iso(-20_000), endedAt: iso(-5000), durationMs: 99 }],
    ctx,
  );
  assert.equal(out.inserts[0].duration_ms, 15_000);
  assert.deepEqual(out.closes.map((c) => c.event_id), ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
  assert.equal(out.closes[0].duration_ms, 15_000);
});

test("open + close of the same id inside one batch collapse into one complete insert", () => {
  const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const out = normalizeEventBatch(
    [
      { kind: "visibility_hidden", eventId: id, startedAt: iso(-9000), payload: { phase: "open" } },
      { kind: "tab_returned", startedAt: iso(-1000) },
      { kind: "visibility_hidden", eventId: id, startedAt: iso(-9000), endedAt: iso(-1000), payload: { phase: "close" } },
    ],
    ctx,
  );
  assert.equal(out.inserts.length, 2);
  const hidden = out.inserts.find((r) => r.kind === "visibility_hidden")!;
  assert.equal(hidden.ended_at, iso(-1000));
  assert.equal(hidden.duration_ms, 8000);
  assert.deepEqual(hidden.payload, { phase: "close" });
  assert.equal(out.closes.length, 1);
});

test("future timestamps beyond the skew and oversized payloads are neutralised", () => {
  const out = normalizeEventBatch(
    [
      { kind: "window_blur", startedAt: iso(10 * 60_000), endedAt: iso(11 * 60_000), payload: { big: "x".repeat(3000) } },
    ],
    ctx,
  );
  assert.equal(out.inserts[0].started_at, iso(0));
  assert.equal(out.inserts[0].ended_at, null);
  assert.deepEqual(out.inserts[0].payload, { truncated: true });
});

test("batches are capped", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ kind: "window_blur", startedAt: iso(-i * 1000) }));
  const out = normalizeEventBatch(many, ctx);
  assert.equal(out.inserts.length, MAX_EVENTS_PER_BATCH);
});

test("camera exemption parsing", () => {
  assert.equal(parseCameraExemption({ reason: "nope" }), null);
  assert.deepEqual(parseCameraExemption({ reason: "accessibility", note: "  needs   a   reader  " }), { reason: "accessibility", note: "needs a reader" });
  assert.deepEqual(parseCameraExemption({ reason: "no_camera", note: 5 }), { reason: "no_camera", note: null });
  assert.equal(parseCameraExemption({ reason: "other", note: "x".repeat(500) })!.note!.length, 200);
});
