import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExamModel, classifyEvent, formatOffset } from "../../lib/lecturer/exam-integrity.ts";
import type { ReportEvent } from "../../lib/lecturer/types.ts";

const T0 = Date.parse("2026-10-16T09:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
let n = 0;
const ev = (kind: string, startMs: number, durationMs: number | null = null, extra: Partial<ReportEvent> = {}): ReportEvent => ({
  id: `e${++n}`,
  kind,
  source: "client",
  planQuestionId: null,
  startedAt: at(startMs),
  endedAt: durationMs === null ? null : at(startMs + durationMs),
  durationMs,
  payload: {},
  ...extra,
});

test("classification: technical vs monitoring vs review", () => {
  assert.equal(classifyEvent(ev("camera_off", 0)), "technical");
  assert.equal(classifyEvent(ev("tracking_unavailable", 0, 4000)), "technical");
  assert.equal(classifyEvent(ev("visibility_hidden", 0, 3000)), "monitoring");
  assert.equal(classifyEvent(ev("visibility_hidden", 0, 30_000)), "review");
  assert.equal(classifyEvent(ev("visibility_hidden", 0)), "review"); // never closed
  assert.equal(classifyEvent(ev("face_missing", 0, 6000)), "monitoring");
  assert.equal(classifyEvent(ev("face_missing", 0, 25_000)), "review");
  assert.equal(classifyEvent(ev("multiple_faces", 0, 2500)), "review");
  assert.equal(classifyEvent(ev("head_away", 0, 5000)), "monitoring");
  assert.equal(classifyEvent(ev("window_blur", 0, 9000)), "monitoring");
  assert.equal(classifyEvent(ev("integrity_warning", 0, null, { payload: { reason: "look_away", cue: "eyes" } })), "review");
});

test("the model aggregates counts, durations, camera state and the exemption", () => {
  const events = [
    ev("camera_exemption", 1000, null, { payload: { reason: "accessibility", note: "screen reader" } }),
    ev("visibility_hidden", 60_000, 12_000, { planQuestionId: "q1" }),
    ev("tab_returned", 72_000, null, { payload: { hidden_event_id: "x" } }),
    ev("visibility_hidden", 200_000, 2000),
    ev("window_blur", 90_000, 4000),
    ev("face_missing", 120_000, 30_000),
    ev("multiple_faces", 150_000, 3000),
    ev("head_away", 160_000, 12_000, { payload: { axis: "yaw" } }),
    ev("camera_off", 180_000),
    ev("tracking_unavailable", 180_000, 10_000),
  ];
  const m = buildExamModel(events, { startedAt: at(0), completedAt: at(300_000) });
  assert.equal(m.summary.tabExits, 2);
  assert.equal(m.summary.tabAwayMs, 14_000);
  assert.equal(m.summary.blurCount, 1);
  assert.equal(m.summary.noFaceCount, 1);
  assert.equal(m.summary.noFaceMs, 30_000);
  assert.equal(m.summary.multiFaceCount, 1);
  assert.equal(m.summary.headAwayCount, 1);
  assert.equal(m.summary.trackingUnavailableMs, 10_000);
  assert.equal(m.summary.cameraOffCount, 1);
  assert.equal(m.summary.technicalCount, 3);
  assert.equal(m.summary.reviewCount, 4); // long hidden, long no-face, multiple faces, long head away
  assert.deepEqual(m.summary.exemption, { reason: "accessibility", note: "screen reader" });
  assert.equal(m.spanMs, 300_000);
  // tab_returned is bookkeeping and not listed; everything else is, in order
  assert.equal(m.items.length, events.length - 1);
  assert.ok(m.items.every((i) => i.kind !== "tab_returned"));
  assert.deepEqual(m.items.map((i) => i.offsetMs), [1000, 60_000, 90_000, 120_000, 150_000, 160_000, 180_000, 180_000, 200_000]);
  assert.equal(m.items[1].lane, "tabs");
  assert.equal(m.items[3].lane, "camera");
  assert.equal(m.items[6].lane, "technical");
  assert.equal(m.items[1].questionId, "q1");
});

test("without a server start time the first event anchors the timeline; the span is never below a minute", () => {
  const m = buildExamModel([ev("offline", 5000)], { startedAt: null, completedAt: null });
  assert.equal(m.startedAtMs, T0 + 5000);
  assert.equal(m.spanMs, 60_000);
  assert.equal(m.items[0].offsetMs, 0);
});

test("formatOffset", () => {
  assert.equal(formatOffset(0), "0:00");
  assert.equal(formatOffset(61_000), "1:01");
  assert.equal(formatOffset(599_400), "9:59");
});
