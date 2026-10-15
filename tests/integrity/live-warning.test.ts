import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_WARNING_DEFAULTS,
  LiveWarningMonitor,
  PITCH_DOWN_SIGN,
  YAW_EYE_SAME_SIGN,
  eyeGazeFromBlendshapes,
  formatLiveWarningDebug,
  type EyeGaze,
  type LiveWarningEvent,
  type LiveWarningReason,
} from "../../lib/integrity/live-warning.ts";

const STEP = 700;

interface Frame {
  yaw?: number;
  pitch?: number;
  eyes?: EyeGaze | null;
  faces?: number;
  faceMissing?: boolean;
  multipleFaces?: boolean;
}

/** Drives a monitor at the camera's sampling rate and records what it shows. */
function rig() {
  const m = new LiveWarningMonitor();
  let now = 1_000_000;
  const events: LiveWarningEvent[] = [];
  const shown: (LiveWarningReason | null)[] = [];
  const run = (ms: number, f: Frame = {}) => {
    const end = now + ms;
    while (now < end) {
      now += STEP;
      const faces = f.faces ?? 1;
      const out = m.observe({
        at: now,
        faces,
        pose: faces === 1 ? { yawDeg: f.yaw ?? 0, pitchDeg: f.pitch ?? 0, rollDeg: 0 } : null,
        eyes: faces === 1 ? (f.eyes === undefined ? { h: 0, v: 0, blink: 0.1 } : f.eyes) : null,
        faceMissing: f.faceMissing ?? false,
        multipleFaces: f.multipleFaces ?? false,
      });
      if (out.event) events.push(out.event);
      if (out.changed) shown.push(m.warning?.reason ?? null);
    }
  };
  return { m, run, events, shown };
}

/** Enough frames looking at the screen for the baseline to settle. */
const WARM = LIVE_WARNING_DEFAULTS.baselineMinSamples * STEP + 2000;

test("eye direction comes from the blendshape sums", () => {
  const cats = (o: Record<string, number>) =>
    [
      "eyeLookInLeft",
      "eyeLookInRight",
      "eyeLookOutLeft",
      "eyeLookOutRight",
      "eyeLookDownLeft",
      "eyeLookDownRight",
      "eyeLookUpLeft",
      "eyeLookUpRight",
      "eyeBlinkLeft",
      "eyeBlinkRight",
    ].map((categoryName) => ({ categoryName, score: o[categoryName] ?? 0 }));
  const side = eyeGazeFromBlendshapes(cats({ eyeLookOutLeft: 0.8, eyeLookInRight: 0.6 }));
  assert.ok(side && Math.abs(side.h - 0.7) < 1e-9 && side.v === 0);
  const down = eyeGazeFromBlendshapes(cats({ eyeLookDownLeft: 0.6, eyeLookDownRight: 0.4, eyeBlinkLeft: 0.2, eyeBlinkRight: 0.4 }));
  assert.ok(down && Math.abs(down.v - 0.5) < 1e-9 && Math.abs(down.blink - 0.3) < 1e-9);
  // Converging eyes (both look "in") are not a look to the side.
  const cross = eyeGazeFromBlendshapes(cats({ eyeLookInLeft: 0.5, eyeLookInRight: 0.5 }));
  assert.ok(cross && Math.abs(cross.h) < 1e-9);
  assert.equal(eyeGazeFromBlendshapes([]), null);
  assert.equal(eyeGazeFromBlendshapes([{ categoryName: "eyeLookInLeft", score: 1 }]), null);
});

test("a single glance away never shows a sign", () => {
  const r = rig();
  r.run(WARM);
  r.run(4000, { yaw: 40 });
  r.run(10_000);
  assert.deepEqual(r.shown, []);
  assert.deepEqual(r.events, []);
});

test("a sustained head turn shows a sign, logs one event and clears after the hold", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { yaw: 40 });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.m.warning?.cue, "head");
  assert.equal(r.events.length, 1);
  assert.equal(r.events[0].reason, "look_away");
  assert.equal(r.events[0].cue, "head");
  assert.ok((r.events[0].awayMs ?? 0) >= LIVE_WARNING_DEFAULTS.sustainedMs);
  // Still away: the sign stays and no second event is logged.
  r.run(10_000, { yaw: 40 });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.events.length, 1);
  // Back on the screen: gone after the hold.
  r.run(LIVE_WARNING_DEFAULTS.holdMs + 2 * STEP);
  assert.equal(r.m.warning, null);
  assert.deepEqual(r.shown, ["look_away", null]);
});

test("eyes held down while the head faces the screen show a sign; eyes up do not", () => {
  const down = rig();
  down.run(WARM);
  down.run(8000, { eyes: { h: 0, v: 0.7, blink: 0.3 } });
  assert.equal(down.m.warning?.reason, "look_away");
  assert.equal(down.m.warning?.cue, "eyes");

  const up = rig();
  up.run(WARM);
  up.run(15_000, { eyes: { h: 0, v: -0.8, blink: 0.05 } });
  assert.equal(up.m.warning, null);
});

test("eyes to the side show a sign; a blink in between does not reset the look", () => {
  const r = rig();
  r.run(WARM);
  r.run(3500, { eyes: { h: 0.75, v: 0, blink: 0.1 } });
  r.run(1400, { eyes: { h: 0, v: 0.9, blink: 0.9 } });
  r.run(2800, { eyes: { h: 0.75, v: 0, blink: 0.1 } });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.m.warning?.cue, "eyes");
});

test("repeated looks to the side add up to a glances sign", () => {
  const r = rig();
  r.run(WARM);
  for (let i = 0; i < 4; i++) {
    r.run(4200, { yaw: 38 });
    r.run(3500);
  }
  assert.ok(r.shown.includes("glances"), JSON.stringify(r.shown));
  assert.equal(r.events.filter((e) => e.reason === "glances").length, 1);
  const ev = r.events.find((e) => e.reason === "glances");
  assert.ok(ev && (ev.episodes ?? 0) >= LIVE_WARNING_DEFAULTS.windowEpisodes);
});

test("short natural looks while thinking stay below the glances threshold", () => {
  const r = rig();
  r.run(WARM);
  for (let i = 0; i < 6; i++) {
    r.run(1400, { yaw: 35 });
    r.run(6000);
  }
  assert.deepEqual(r.shown, []);
});

test("a camera mounted to the side becomes the baseline, not a look away", () => {
  const r = rig();
  r.run(60_000, { yaw: 18, pitch: 12 });
  assert.deepEqual(r.shown, []);
  // Turning further away from that baseline still counts.
  r.run(8000, { yaw: 18 + 35, pitch: 12 });
  assert.equal(r.m.warning?.reason, "look_away");
});

test("eyes counter-rotating against a turned head are compensation, not a look away", () => {
  const r = rig();
  r.run(WARM);
  r.run(15_000, { yaw: 22, eyes: { h: -0.6, v: 0, blink: 0.1 } });
  assert.deepEqual(r.shown, []);
});

test("head moderately turned with the eyes further the same way is a look away (both)", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { yaw: 18, eyes: { h: 0.25, v: 0, blink: 0.1 } });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.m.warning?.cue, "both");
  assert.equal(r.events[0]?.cue, "both");
});

test("reading the desk: head nodded 14° with the eyes cast down, neither alone enough", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { pitch: 14, eyes: { h: 0, v: 0.2, blink: 0.35 } });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.m.warning?.cue, "both");
});

test("leaning back (head up, eyes down to keep the screen) is not a look away", () => {
  const r = rig();
  r.run(WARM);
  r.run(15_000, { pitch: -14, eyes: { h: 0, v: 0.35, blink: 0.2 } });
  assert.deepEqual(r.shown, []);
});

test("a drooping upper lid while looking down is still a readable look down", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { eyes: { h: 0, v: 0.5, blink: 0.65 } });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.m.warning?.cue, "eyes");
});

test("a moderate look down crosses the lowered eye threshold", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { eyes: { h: 0, v: 0.34, blink: 0.3 } });
  assert.equal(r.m.warning?.reason, "look_away");
});

test("no look-away sign before the baseline has settled", () => {
  const r = rig();
  r.run(8000, { yaw: 45 });
  assert.equal(r.m.warning, null);
});

test("another person and a missing face show at once, with priority over looks", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { yaw: 40 });
  assert.equal(r.m.warning?.reason, "look_away");
  r.run(STEP, { faces: 2, multipleFaces: true });
  assert.equal(r.m.warning?.reason, "another_person");
  assert.equal(r.m.warning?.cue, null);
  // A lower-priority cause does not replace a higher one while it is shown.
  r.run(STEP, { faces: 0, faceMissing: true });
  assert.equal(r.m.warning?.reason, "another_person");

  const f = rig();
  f.run(WARM);
  f.run(STEP, { faces: 0, faceMissing: true });
  assert.equal(f.m.warning?.reason, "face_missing");
  assert.equal(f.events[0]?.reason, "face_missing");
  assert.equal(f.events[0]?.awayMs, null);
});

test("a second look away soon after logs no second event but shows the sign", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { yaw: 40 });
  r.run(6000);
  assert.equal(r.m.warning, null);
  r.run(8000, { yaw: 40 });
  assert.equal(r.m.warning?.reason, "look_away");
  assert.equal(r.events.length, 1);
  r.run(6000);
  r.run(LIVE_WARNING_DEFAULTS.eventCooldownMs);
  r.run(8000, { yaw: 40 });
  assert.equal(r.events.length, 2);
});

test("reset takes the sign down and forgets the look in progress", () => {
  const r = rig();
  r.run(WARM);
  r.run(8000, { yaw: 40 });
  assert.equal(r.m.reset(), true);
  assert.equal(r.m.warning, null);
  assert.equal(r.m.reset(), false);
  // The look starts over after a reset.
  r.run(4000, { yaw: 40 });
  assert.equal(r.m.warning, null);
});

test("the debug readout formats every field", () => {
  const r = rig();
  r.run(WARM);
  const d = r.m.debug;
  assert.ok(d);
  const text = formatLiveWarningDebug(d);
  assert.match(text, /faces 1/);
  assert.match(text, /yaw 0°/);
  assert.match(text, /gaze down/);
  assert.equal(text.split("\n").length, 5);
});

/*
 * Readings of real photographs run through the app's own landmarker
 * (face_landmarker.task, tasks-vision 1.1.0, IMAGE mode, the production
 * angle formula). They pin the sign conventions the combined rule relies on.
 */
const PHOTOS = {
  headDown: [43.5, 19.1, 34, 40.7],
  headUp: [-30.3, -25.1, -21.9, -8, -3.9],
  headTurnedOwnLeftYaw: [40, 56, 26.8],
  headTurnedOwnRightYaw: [-23.3, -48.9, -20.2],
  eyesOwnLeftH: [0.89, 0.76, 0.91],
  eyesOwnRightH: [-0.79, -0.85, -0.8],
  // eyes cast down, head near level: v and blink rise together
  eyesDown: [
    { pitch: 5.2, v: 0.41, blink: 0.39 },
    { pitch: 30.3, v: 0.54, blink: 0.58 },
    { pitch: 31.8, v: 0.74, blink: 0.73 },
  ],
};

test("sign conventions match real photographs", () => {
  for (const p of PHOTOS.headDown) assert.ok(p * PITCH_DOWN_SIGN > 0);
  for (const p of PHOTOS.headUp) assert.ok(p * PITCH_DOWN_SIGN < 0);
  // A turn to the subject's own left and eyes to the subject's own left share a sign.
  const yawLeft = Math.sign(PHOTOS.headTurnedOwnLeftYaw[0]);
  for (const y of PHOTOS.headTurnedOwnLeftYaw) assert.equal(Math.sign(y), yawLeft);
  for (const y of PHOTOS.headTurnedOwnRightYaw) assert.equal(Math.sign(y), -yawLeft);
  for (const h of PHOTOS.eyesOwnLeftH) assert.equal(Math.sign(h) * YAW_EYE_SAME_SIGN, yawLeft);
  for (const h of PHOTOS.eyesOwnRightH) assert.equal(Math.sign(h) * YAW_EYE_SAME_SIGN, -yawLeft);
});

test("real eyes-down readings are kept even with the lid lowered", () => {
  for (const d of PHOTOS.eyesDown) {
    assert.ok(d.blink < LIVE_WARNING_DEFAULTS.blinkMax, `blink ${d.blink} would be discarded`);
    const r = rig();
    r.run(WARM);
    // The head part of the reading is kept below the head-alone threshold.
    r.run(8000, { pitch: Math.min(d.pitch, 12), eyes: { h: 0, v: d.v, blink: d.blink } });
    assert.equal(r.m.warning?.reason, "look_away", JSON.stringify(d));
  }
});
