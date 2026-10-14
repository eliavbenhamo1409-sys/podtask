import { test } from "node:test";
import assert from "node:assert/strict";
import { PresenceTracker } from "../../lib/integrity/presence-tracker.ts";
import type { IntegrityClientEvent } from "../../lib/integrity/types.ts";

function tracker(opts: Partial<ConstructorParameters<typeof PresenceTracker>[0]> = {}) {
  const events: IntegrityClientEvent[] = [];
  const tr = new PresenceTracker({
    onEvent: (e) => events.push(e),
    getPlanQuestionId: () => "q2",
    headPose: false,
    ...opts,
  });
  return { tr, events };
}
const STEP = 500;

test("no face: opens after 5 s, closes after the face is back for 800 ms, same eventId", () => {
  const { tr, events } = tracker();
  let t = 10_000;
  for (let i = 0; i < 12; i++) tr.observe({ at: (t += STEP), faces: 0 });
  const opens = events.filter((e) => e.kind === "face_missing");
  assert.equal(opens.length, 1);
  assert.equal(opens[0].endedAt, null);
  assert.equal(opens[0].startedAt, new Date(10_500).toISOString());
  assert.equal(opens[0].planQuestionId, "q2");
  tr.observe({ at: (t += STEP), faces: 1 }); // first positive sample: not yet closed
  tr.observe({ at: (t += STEP), faces: 1 }); // 500 ms present: still open
  assert.equal(events.filter((e) => e.kind === "face_missing").length, 1);
  tr.observe({ at: (t += STEP), faces: 1 }); // 1000 ms present: closes at presentSince
  const all = events.filter((e) => e.kind === "face_missing");
  assert.equal(all.length, 2);
  assert.equal(all[1].eventId, all[0].eventId);
  assert.ok(all[1].endedAt);
  assert.equal(all[1].durationMs, new Date(all[1].endedAt!).getTime() - 10_500);
});

test("momentary loss (lighting, movement) never opens an interval", () => {
  const { tr, events } = tracker();
  let t = 0;
  for (let i = 0; i < 40; i++) tr.observe({ at: (t += STEP), faces: i % 6 === 0 ? 0 : 1 });
  assert.equal(events.length, 0);
});

test("one frame with a face resets the no-face countdown", () => {
  const { tr, events } = tracker();
  let t = 0;
  for (let i = 0; i < 9; i++) tr.observe({ at: (t += STEP), faces: 0 }); // 4.5 s
  tr.observe({ at: (t += STEP), faces: 1 });
  for (let i = 0; i < 9; i++) tr.observe({ at: (t += STEP), faces: 0 });
  assert.equal(events.length, 0);
});

test("multiple faces: opens after 2 s and carries the count; a brief second face is ignored", () => {
  const { tr, events } = tracker();
  let t = 0;
  tr.observe({ at: (t += STEP), faces: 2 });
  tr.observe({ at: (t += STEP), faces: 2 });
  tr.observe({ at: (t += STEP), faces: 1 });
  assert.equal(events.length, 0);
  for (let i = 0; i < 6; i++) tr.observe({ at: (t += STEP), faces: 2 });
  const opens = events.filter((e) => e.kind === "multiple_faces");
  assert.equal(opens.length, 1);
  assert.equal(opens[0].payload?.faces, 2);
  for (let i = 0; i < 5; i++) tr.observe({ at: (t += STEP), faces: 1 });
  const closes = events.filter((e) => e.kind === "multiple_faces" && e.endedAt);
  assert.equal(closes.length, 1);
  assert.equal(closes[0].eventId, opens[0].eventId);
});

test("tracking unavailable closes an open no-face interval and is itself an interval", () => {
  const { tr, events } = tracker();
  let t = 0;
  for (let i = 0; i < 12; i++) tr.observe({ at: (t += STEP), faces: 0 });
  tr.markUnavailable("no_frames", t + 100);
  const closed = events.find((e) => e.kind === "face_missing" && e.endedAt);
  assert.ok(closed);
  assert.equal(closed.payload?.closed_by, "tracking_unavailable");
  const un = events.filter((e) => e.kind === "tracking_unavailable");
  assert.equal(un.length, 1);
  assert.equal(un[0].payload?.reason, "no_frames");
  tr.markUnavailable("no_frames", t + 200); // idempotent while open
  assert.equal(events.filter((e) => e.kind === "tracking_unavailable").length, 1);
  tr.observe({ at: t + 3000, faces: 1 });
  const unClosed = events.filter((e) => e.kind === "tracking_unavailable" && e.endedAt);
  assert.equal(unClosed.length, 1);
  assert.equal(unClosed[0].durationMs, 2900);
});

test("head away is tracked only with exactly one face, and flush closes everything", () => {
  const { tr, events } = tracker({ headPose: true, headAway: { smoothing: 1 } });
  let t = 0;
  for (let i = 0; i < 10; i++) tr.observe({ at: (t += 700), faces: 1, pose: { yawDeg: 45, pitchDeg: 0, rollDeg: 0 } });
  assert.equal(events.filter((e) => e.kind === "head_away").length, 1);
  tr.observe({ at: (t += 700), faces: 2, pose: null });
  const closed = events.filter((e) => e.kind === "head_away" && e.endedAt);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].payload?.closed_by, "face_lost");
  for (let i = 0; i < 6; i++) tr.observe({ at: (t += 700), faces: 2 });
  tr.flush(t + 1);
  const multi = events.filter((e) => e.kind === "multiple_faces");
  assert.equal(multi.length, 2);
  assert.equal(multi[1].payload?.closed_by, "stopped");
});
